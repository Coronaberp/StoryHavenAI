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
    await ensure_models_cached([(name, local_path)], on_progress=on_progress)

async def ensure_models_cached(items: list[tuple[str, str]], on_progress=None):
    vol = _get_volume()
    cached_sizes = {}
    async for entry in vol.iterdir.aio("/", recursive=False):
        cached_sizes[entry.path.lstrip("/")] = entry.size

    to_upload = [(name, path) for name, path in items
                if cached_sizes.get(name) != os.path.getsize(path)]
    for name, path in items:
        if (name, path) not in to_upload:
            log.info("model cache: name=%s already cached, skipping upload", name)
    if not to_upload:
        return

    sizes = {name: os.path.getsize(path) for name, path in to_upload}
    total_size = sum(sizes.values())
    log.info("model cache: uploading %d file(s) concurrently size_mb=%s",
             len(to_upload), total_size // (1024 * 1024))
    if on_progress:
        for name, path in to_upload:
            await on_progress(name, 0, sizes[name], None)
    started = asyncio.get_event_loop().time()
    async with vol.batch_upload(force=True) as batch:
        for name, path in to_upload:
            batch.put_file(path, name)
    elapsed = max(0.001, asyncio.get_event_loop().time() - started)
    speed = (total_size / (1024 * 1024)) / elapsed
    log.info("model cache: batch upload complete files=%d in %.1fs (%.1f MB/s aggregate)",
             len(to_upload), elapsed, speed)
    if on_progress:
        for name, path in to_upload:
            await on_progress(name, sizes[name], sizes[name], speed)

_DATASET_SUBDIR = "_datasets"

async def upload_dataset_images(job_id: str, local_dir: str, on_progress=None):
    vol = _get_volume()
    filenames = sorted(os.listdir(local_dir))
    sizes = {name: os.path.getsize(os.path.join(local_dir, name)) for name in filenames}
    total_size = sum(sizes.values())
    log.info("dataset upload: job=%s files=%d size_mb=%s", job_id, len(filenames), total_size // (1024 * 1024))
    if on_progress:
        await on_progress(f"dataset ({len(filenames)} files)", 0, total_size, None)
    started = asyncio.get_event_loop().time()
    async with vol.batch_upload(force=True) as batch:
        for name in filenames:
            batch.put_file(os.path.join(local_dir, name), f"{_DATASET_SUBDIR}/{job_id}/{name}")
    elapsed = max(0.001, asyncio.get_event_loop().time() - started)
    speed = (total_size / (1024 * 1024)) / elapsed
    log.info("dataset upload: job=%s complete in %.1fs (%.1f MB/s aggregate)", job_id, elapsed, speed)
    if on_progress:
        await on_progress(f"dataset ({len(filenames)} files)", total_size, total_size, speed)

async def remove_dataset_images(job_id: str):
    vol = _get_volume()
    prefix = f"{_DATASET_SUBDIR}/{job_id}"
    async for entry in vol.iterdir.aio(prefix, recursive=False):
        await vol.remove_file.aio(entry.path.lstrip("/"))
    log.info("dataset upload: job=%s remote files removed", job_id)

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

async def stream_training_job(config: dict):
    urls, secret = _require_deploy_urls()
    headers = {"Authorization": f"Bearer {secret}"}

    async with httpx.AsyncClient(timeout=httpx.Timeout(None)) as client:
        async with client.stream(
                "POST", urls["train"], headers=headers,
                data={"config": json.dumps(config)}) as resp:
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

                        yield await asyncio.to_thread(json.loads, line[len("data:"):].strip())
