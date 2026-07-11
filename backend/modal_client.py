"""Client for the Modal-deployed LoRA training endpoint (modal_app/lora_train.py)."""
import asyncio
import json
import os

import httpx
import modal

from backend.state import CFG, log

MODEL_CACHE_VOLUME_NAME = "lora-train-model-cache"
_OUTPUT_SUBDIR = "_outputs"
_volume = None


def _get_volume():
    global _volume
    if _volume is None:
        _volume = modal.Volume.from_name(MODEL_CACHE_VOLUME_NAME)
    return _volume


class ModalNotConfigured(RuntimeError):
    pass


async def request_checkpoint(job_id: str):
    """Signals the Modal function that's currently training `job_id` to save
    and stream an extra checkpoint right now, via the separate (no-GPU,
    instant) request_checkpoint web endpoint deployed alongside `train` —
    see modal_app/lora_train.py. This call only sets the flag; the actual
    checkpoint bytes arrive later as a normal event on the already-open SSE
    stream from stream_training_job, same as a scheduled checkpoint."""
    url = CFG.get("modal_checkpoint_url") or ""
    secret = CFG.get("modal_shared_secret") or ""
    if not url:
        raise ModalNotConfigured("modal_checkpoint_url is not set in Settings")
    if not secret:
        raise ModalNotConfigured("modal_shared_secret is not set in Settings")
    headers = {"Authorization": f"Bearer {secret}"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(15)) as client:
        resp = await client.post(url, headers=headers, json={"job_id": job_id})
        if resp.status_code != 200:
            log.warning("modal checkpoint request failed: job_id=%s status=%s", job_id, resp.status_code)
            raise RuntimeError(f"Modal checkpoint endpoint returned {resp.status_code}: {resp.text[:300]}")


def _require_deploy_urls():
    urls = {"train": CFG.get("modal_train_url")}
    secret = CFG.get("modal_shared_secret") or ""
    missing = [k for k, v in urls.items() if not v]
    if missing:
        raise ModalNotConfigured(f"Modal endpoint URL(s) not set in Settings: {', '.join(missing)}")
    if not secret:
        raise ModalNotConfigured("modal_shared_secret is not set in Settings")
    return urls, secret


async def ensure_model_cached(name: str, local_path: str, on_progress=None):
    vol = _get_volume()
    size = os.path.getsize(local_path)
    async for entry in vol.iterdir.aio("/", recursive=False):
        if entry.path.lstrip("/") == name and entry.size == size:
            log.info("model cache: name=%s already cached, skipping upload", name)
            return

    log.info("model cache: uploading name=%s size_mb=%s", name, size // (1024 * 1024))
    if on_progress:
        await on_progress(name, 0, size, None)
    started = asyncio.get_event_loop().time()
    async with vol.batch_upload(force=True) as batch:
        batch.put_file(local_path, name)
    elapsed = max(0.001, asyncio.get_event_loop().time() - started)
    log.info("model cache: upload complete name=%s in %.1fs (%.1f MB/s)",
             name, elapsed, (size / (1024 * 1024)) / elapsed)
    if on_progress:
        await on_progress(name, size, size, (size / (1024 * 1024)) / elapsed)


_PROGRESS_PCT_STEP = 0.05
_PROGRESS_MIN_STEP_BYTES = 1024 * 1024


async def download_output(name: str, dest_path: str, on_progress=None):
    vol = _get_volume()
    remote_path = f"{_OUTPUT_SUBDIR}/{name}"
    total = None
    async for entry in vol.iterdir.aio(_OUTPUT_SUBDIR, recursive=False):
        if entry.path.lstrip("/").rsplit("/", 1)[-1] == name:
            total = entry.size
            break
    log.info("model download: starting name=%s", name)
    received = 0
    log_every = max(_PROGRESS_MIN_STEP_BYTES, int(total * _PROGRESS_PCT_STEP)) if total else _PROGRESS_MIN_STEP_BYTES * 10
    next_log_at = log_every
    started = asyncio.get_event_loop().time()
    f = await asyncio.to_thread(open, dest_path, "wb")
    try:
        async for chunk in vol.read_file.aio(remote_path):
            await asyncio.to_thread(f.write, chunk)
            received += len(chunk)
            if received >= next_log_at:
                elapsed = max(0.001, asyncio.get_event_loop().time() - started)
                speed_mb_s = (received / (1024 * 1024)) / elapsed
                log.info("model download: name=%s %d MB received", name, received // (1024 * 1024))
                if on_progress:
                    await on_progress(name, received, total, speed_mb_s)
                next_log_at += log_every
    finally:
        await asyncio.to_thread(f.close)
    await vol.remove_file.aio(remote_path)
    log.info("model download: complete name=%s size_mb=%s", name, received // (1024 * 1024))
    if on_progress:
        await on_progress(name, received, received, None)


async def stream_training_job(config: dict, images_zip: bytes):
    """Async generator yielding parsed SSE event dicts as Modal reports them.
    config must already carry base_checkpoint_name (and clip_name/vae_name
    for Anima) referencing files already uploaded via ensure_model_cached —
    this call itself only ever sends the (comparatively tiny) training
    images zip, never a multi-GB checkpoint."""
    urls, secret = _require_deploy_urls()
    files = {"images": ("images.zip", images_zip, "application/zip")}
    headers = {"Authorization": f"Bearer {secret}"}
    # No fixed timeout — a training run can legitimately take hours; the
    # connection just needs to keep flushing SSE lines to stay alive.
    async with httpx.AsyncClient(timeout=httpx.Timeout(None)) as client:
        async with client.stream(
                "POST", urls["train"], headers=headers,
                data={"config": json.dumps(config)}, files=files) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode("utf-8", "ignore")
                raise RuntimeError(f"Modal endpoint returned {resp.status_code}: {body[:300]}")
            buf = ""
            async for chunk in resp.aiter_text():
                buf += chunk
                while "\n\n" in buf:
                    line, buf = buf.split("\n\n", 1)
                    line = line.strip()
                    if line.startswith("data:"):
                        # The final "done" event carries the entire finished
                        # LoRA file as one base64 string — json.loads on that
                        # (tens of MB of text) is a genuinely slow, fully
                        # synchronous call that blocked this app's single
                        # shared event loop badly enough once already that
                        # the whole app (every other request, not just this
                        # job) froze for minutes and needed a hard restart.
                        # asyncio.to_thread keeps the loop free during it.
                        yield await asyncio.to_thread(json.loads, line[len("data:"):].strip())
