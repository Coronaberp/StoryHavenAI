import asyncio
import json
import os
import re
import shutil
import tempfile
import time
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, UploadFile, File, Form

from backend import db
from backend.repositories import notifications as notification_repo
from backend.repositories import lora_training as lora_training_repo
from backend.repositories import checkpoints as checkpoint_repo, loras as lora_repo
from backend import modal_client
from backend import modal_provision
from backend.auth import get_admin
from backend.feature_flags import require_feature_enabled
from backend.imagegen import ANIMA_CLIP_NAME, ANIMA_VAE_NAME
from backend.state import (api, log, LORA_OUTPUT_DIR, CHECKPOINTS_DIR, DIFFUSION_MODELS_DIR,
                            TEXT_ENCODERS_DIR, VAE_DIR, COMFYUI_OWNER_UID)
from backend.schemas import LoraTrainingJobIn

os.makedirs(LORA_OUTPUT_DIR, exist_ok=True)

_CKPT_EXTS = (".safetensors", ".ckpt", ".pt", ".pth")

def _lora_filename_slug(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", name.strip()).strip("_")
    return slug or "lora"

def _iso8601_compact() -> str:

    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

@api.get("/admin/lora-training/jobs")
async def list_lora_training_jobs(current_user: dict = Depends(get_admin)):
    return await lora_training_repo.list_jobs()

@api.get("/admin/lora-training/checkpoints")
async def list_local_checkpoints(current_user: dict = Depends(get_admin)):
    try:
        names = sorted(n for n in os.listdir(CHECKPOINTS_DIR) if n.lower().endswith(_CKPT_EXTS))
    except OSError as e:
        log.warning("lora_training: could not list checkpoints dir=%s: %s", CHECKPOINTS_DIR, e)
        names = []
    return {"checkpoints": names}

@api.delete("/admin/lora-training/jobs/{jid}")
async def delete_lora_training_job(jid: str, current_user: dict = Depends(get_admin)):
    job = await lora_training_repo.get_job(jid)
    if not job:
        raise HTTPException(404, "not found")
    if job.get("output_file"):
        out_path = os.path.join(LORA_OUTPUT_DIR, os.path.basename(job["output_file"]))
        try:
            os.remove(out_path)
        except OSError as e:
            log.warning("lora_training: could not delete output file path=%s: %s", out_path, e)
    for ckpt in await lora_training_repo.list_checkpoints(jid):
        ckpt_path = os.path.join(LORA_OUTPUT_DIR, os.path.basename(ckpt["filename"]))
        try:
            os.remove(ckpt_path)
        except OSError as e:
            log.warning("lora_training: could not delete checkpoint file path=%s: %s", ckpt_path, e)
        await lora_training_repo.delete_checkpoint(ckpt["id"])
    await lora_training_repo.delete_job(jid)
    log.info("lora_training: job deleted by=%s job=%s", current_user["username"], jid)
    return {"deleted": True}

@api.get("/admin/lora-training/jobs/{jid}/checkpoints")
async def list_job_checkpoints(jid: str, current_user: dict = Depends(get_admin)):
    return await lora_training_repo.list_checkpoints(jid)

@api.delete("/admin/lora-training/checkpoints/{cid}")
async def delete_job_checkpoint(cid: str, current_user: dict = Depends(get_admin)):
    ckpt = await lora_training_repo.delete_checkpoint(cid)
    if not ckpt:
        raise HTTPException(404, "not found")
    ckpt_path = os.path.join(LORA_OUTPUT_DIR, os.path.basename(ckpt["filename"]))
    try:
        os.remove(ckpt_path)
    except OSError as e:
        log.warning("lora_training: could not delete checkpoint file path=%s: %s", ckpt_path, e)
    log.info("lora_training: checkpoint deleted by=%s checkpoint=%s", current_user["username"], cid)
    return {"deleted": True}

@api.post("/admin/lora-training/jobs/{jid}/checkpoint")
async def request_lora_checkpoint(jid: str, current_user: dict = Depends(get_admin)):
    job = await lora_training_repo.get_job(jid)
    if not job:
        raise HTTPException(404, "not found")
    if job["status"] != "training":
        raise HTTPException(400, "job is not currently training")
    try:
        await modal_client.request_checkpoint(jid)
    except modal_client.ModalNotConfigured as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"could not reach Modal: {e}")
    log.info("lora_training: checkpoint requested by=%s job=%s", current_user["username"], jid)
    return {"requested": True}

_aborted_jobs: set[str] = set()

MAX_AUTO_RETRIES = 3
_UNRECOVERABLE_RE = re.compile(r"not found in Modal's model cache|checkpoint not found|CLIP/VAE not found")

class _JobAborted(Exception):
    pass

_running_jobs: set[asyncio.Task] = set()
_running_job_tasks: dict[str, asyncio.Task] = {}

_training_queue: list[str] = []
_queue_lock = asyncio.Lock()

async def _queue_join(job_id: str):
    async with _queue_lock:
        _training_queue.append(job_id)

async def _queue_leave(job_id: str):
    async with _queue_lock:
        if job_id in _training_queue:
            _training_queue.remove(job_id)

async def _queue_status(job_id: str) -> tuple[bool, int]:
    async with _queue_lock:
        if job_id not in _training_queue:
            return False, 0
        idx = _training_queue.index(job_id)
        return idx == 0, idx

@api.post("/admin/lora-training/jobs/{jid}/abort")
async def abort_lora_training_job(jid: str, current_user: dict = Depends(get_admin)):
    job = await lora_training_repo.get_job(jid)
    if not job:
        raise HTTPException(404, "not found")
    _aborted_jobs.add(jid)
    await _queue_leave(jid)
    task = _running_job_tasks.get(jid)
    if task and not task.done():
        task.cancel()
    await lora_training_repo.update_job(jid, status="failed", error="Aborted by admin.")
    log.info("lora_training: aborted by=%s job=%s", current_user["username"], jid)
    return {"status": "failed"}

def _chown(path: str):
    try:
        os.chown(path, COMFYUI_OWNER_UID, COMFYUI_OWNER_UID)
    except OSError:
        pass

@api.post("/admin/lora-training/jobs")
async def create_and_stream_lora_training_job(
        name: str = Form(...), trigger_word: str = Form("sks"),
        local_checkpoint: str = Form(...), architecture: str = Form("sdxl"),
        resolution: int = Form(512), rank: int = Form(16), alpha: int = Form(16),
        learning_rate: float = Form(0.0001), steps: int = Form(1000), batch_size: int = Form(1),
        resume_from_lora: str | None = Form(None),
        captions: str = Form("[]"),
        noise_offset: float = Form(0.0), network_dropout: float = Form(0.0),
        images: list[UploadFile] = File(...),
        current_user: dict = Depends(get_admin),
        _feature_ok: None = Depends(require_feature_enabled("lora_training"))):
    body = LoraTrainingJobIn(name=name, trigger_word=trigger_word, base_checkpoint=local_checkpoint,
                             resolution=resolution, rank=rank, alpha=alpha,
                             learning_rate=learning_rate, steps=steps, batch_size=batch_size,
                             noise_offset=noise_offset, network_dropout=network_dropout)

    if not name.strip():
        raise HTTPException(400, "name is required")
    if not trigger_word.strip() or " " in trigger_word.strip():
        raise HTTPException(400, "trigger_word must be a single non-empty word")
    if not images:
        raise HTTPException(400, "at least one training image is required")
    if len(images) < 5:
        raise HTTPException(400, "at least 5 training images are required")
    if resolution < 256 or resolution > 1024 or resolution % 64 != 0:
        raise HTTPException(400, "resolution must be a multiple of 64 between 256 and 1024")
    if batch_size < 1 or batch_size > 8:
        raise HTTPException(400, "batch_size must be between 1 and 8")
    if rank < 1 or rank > 128:
        raise HTTPException(400, "rank must be between 1 and 128")
    if alpha < 1 or alpha > 128:
        raise HTTPException(400, "alpha must be between 1 and 128")
    if learning_rate <= 0 or learning_rate > 0.01:
        raise HTTPException(400, "learning_rate must be a positive number no greater than 0.01")
    if noise_offset < 0 or noise_offset > 1:
        raise HTTPException(400, "noise_offset must be between 0 and 1")
    if network_dropout < 0 or network_dropout >= 1:
        raise HTTPException(400, "network_dropout must be between 0 and 1")
    if steps < 50 or steps > 20000:
        raise HTTPException(400, "steps must be between 50 and 20000")
    if architecture not in ("sdxl", "anima"):
        raise HTTPException(400, "architecture must be 'sdxl' or 'anima'")

    clip_name = vae_name = None
    if architecture == "anima":
        ckpt_path = os.path.join(DIFFUSION_MODELS_DIR, os.path.basename(local_checkpoint))
        if not os.path.isfile(ckpt_path):
            raise HTTPException(400, f"checkpoint not found: {local_checkpoint}")
        clip_override, vae_override = await checkpoint_repo.get_anima_overrides(local_checkpoint)
        clip_name = clip_override or ANIMA_CLIP_NAME
        vae_name = vae_override or ANIMA_VAE_NAME
        clip_path = os.path.join(TEXT_ENCODERS_DIR, clip_name)
        vae_path = os.path.join(VAE_DIR, vae_name)
        if not os.path.isfile(clip_path):
            raise HTTPException(400, f"Anima text encoder not found: {clip_name}")
        if not os.path.isfile(vae_path):
            raise HTTPException(400, f"Anima VAE not found: {vae_name}")
    else:
        ckpt_path = os.path.join(CHECKPOINTS_DIR, os.path.basename(local_checkpoint))
        if not os.path.isfile(ckpt_path):
            raise HTTPException(400, f"checkpoint not found: {local_checkpoint}")
    ckpt_name = os.path.basename(ckpt_path)

    resume_lora_name = resume_lora_path = None
    if resume_from_lora:
        resume_lora_path = os.path.join(LORA_OUTPUT_DIR, os.path.basename(resume_from_lora))
        if not os.path.isfile(resume_lora_path):
            raise HTTPException(400, f"resume_from_lora not found: {resume_from_lora}")
        resume_lora_name = os.path.basename(resume_lora_path)

    try:
        parsed_captions = json.loads(captions)
        if not isinstance(parsed_captions, list) or len(parsed_captions) != len(images):
            parsed_captions = None
    except (json.JSONDecodeError, TypeError):
        parsed_captions = None
    if parsed_captions is None:
        log.warning("lora_training: captions field missing/malformed, falling back to trigger word only")
        parsed_captions = [""] * len(images)

    job = await lora_training_repo.create_job(
        current_user["id"], body.name, body.trigger_word,
        local_checkpoint or body.base_checkpoint,
        body.resolution, body.rank, body.alpha, body.learning_rate,
        body.steps, body.batch_size, len(images), resume_lora_name)

    dataset_dir = tempfile.mkdtemp(prefix=f"lora_dataset_{job['id']}_")
    for i, img in enumerate(images):
        data = await img.read()
        ext = os.path.splitext(img.filename or "")[1].lower() or ".png"
        if ext not in (".png", ".jpg", ".jpeg", ".webp"):
            raise HTTPException(400, f"unsupported image type: {img.filename}")
        with open(os.path.join(dataset_dir, f"img_{i:04d}{ext}"), "wb") as f:
            f.write(data)
        extra = str(parsed_captions[i] or "").strip()
        caption = f"{body.trigger_word}, {extra}" if extra else body.trigger_word
        with open(os.path.join(dataset_dir, f"img_{i:04d}.txt"), "w") as f:
            f.write(caption)

    config = {"job_id": job["id"], "architecture": architecture, "base_checkpoint": body.base_checkpoint,
             "base_checkpoint_name": ckpt_name, "clip_name": clip_name, "vae_name": vae_name,
             "resolution": body.resolution, "rank": body.rank, "alpha": body.alpha,
             "learning_rate": body.learning_rate, "steps": body.steps, "batch_size": body.batch_size,
             "trigger_word": body.trigger_word, "resume_from_lora_name": resume_lora_name,
             "noise_offset": body.noise_offset, "network_dropout": body.network_dropout}

    log.info("lora_training: queued by=%s job=%s name=%s architecture=%s steps=%s",
             current_user["username"], job["id"], job["name"], architecture, body.steps)
    task = asyncio.create_task(_execute_training_job(
        job, config, dataset_dir, current_user, architecture,
        ckpt_name, ckpt_path, clip_name, vae_name,
        clip_path if architecture == "anima" else None,
        vae_path if architecture == "anima" else None,
        resume_lora_name, resume_lora_path))
    _running_jobs.add(task)
    _running_job_tasks[job["id"]] = task
    task.add_done_callback(_running_jobs.discard)
    task.add_done_callback(lambda t, jid=job["id"]: _running_job_tasks.pop(jid, None))
    return {"job_id": job["id"]}

async def _persist_transfer_progress(jid: str, phase: str, name: str, sent: int, total: int | None, speed_mb_s: float | None):
    pct = f" ({sent * 100 // total}%)" if total else ""
    speed_txt = f" — {speed_mb_s:.1f} MB/s" if speed_mb_s else ""
    verb = "Uploading" if phase == "upload" else "Downloading"
    await lora_training_repo.update_job(
        jid,
        transfer_progress=json.dumps({
            "phase": phase, "name": name, "bytes": sent, "total_bytes": total,
            "speed_mb_s": speed_mb_s, "t": time.time()}),
        log=f"{verb} {name}: {sent // (1024 * 1024)}"
            f"{f'/{total // (1024 * 1024)}' if total else ''} MB{pct}{speed_txt}")

async def _execute_training_job(job: dict, config: dict, dataset_dir: str, current_user: dict, architecture: str,
                                ckpt_name: str, ckpt_path: str, clip_name: str | None, vae_name: str | None,
                                clip_path: str | None, vae_path: str | None,
                                resume_lora_name: str | None = None, resume_lora_path: str | None = None):
    await _queue_join(job["id"])
    reached_training = False
    try:
        await lora_training_repo.update_job(job["id"], status="queued")
        while True:
            if job["id"] in _aborted_jobs:
                return
            is_active, position = await _queue_status(job["id"])
            if is_active:
                break
            await lora_training_repo.update_job(
                job["id"], status="queued",
                log=f"Waiting for {position} training job{'s' if position != 1 else ''} ahead of this one to finish…")
            await asyncio.sleep(2)

        await lora_training_repo.update_job(job["id"], status="provisioning", log="Checking Modal deployment…",
                                             billing_started=time.time())

        log_queue: asyncio.Queue = asyncio.Queue()
        deploy_task = asyncio.create_task(
            modal_provision.ensure_deployed(on_log=lambda line: log_queue.put(line)))
        while not deploy_task.done():
            try:
                deploy_line = await asyncio.wait_for(log_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            await lora_training_repo.update_job(job["id"], log=deploy_line)
        while not log_queue.empty():
            await lora_training_repo.update_job(job["id"], log=log_queue.get_nowait())
        await deploy_task

        to_cache = [("base checkpoint", ckpt_name, ckpt_path)]
        if architecture == "anima":
            to_cache += [("Anima CLIP", clip_name, clip_path), ("Anima VAE", vae_name, vae_path)]
        if resume_lora_name:
            to_cache.append(("resume LoRA", resume_lora_name, resume_lora_path))
        labels = ", ".join(f"{label} ({cache_name})" for label, cache_name, _ in to_cache)
        await lora_training_repo.update_job(job["id"], log=f"Checking Modal's model cache for: {labels}…")
        await modal_client.ensure_models_cached(
            [(cache_name, cache_path) for _, cache_name, cache_path in to_cache],
            on_progress=lambda n, sent, total, speed, jid=job["id"]: _persist_transfer_progress(
                jid, "upload", n, sent, total, speed))
        await lora_training_repo.update_job(job["id"], log="Uploading training images to Modal…")
        await modal_client.upload_dataset_images(
            job["id"], dataset_dir,
            on_progress=lambda n, sent, total, speed, jid=job["id"]: _persist_transfer_progress(
                jid, "upload", n, sent, total, speed))
        reached_training = True
    except modal_provision.ModalProvisionError as e:
        log.warning("lora_training: provisioning failed job=%s: %s", job["id"], e)
        await lora_training_repo.update_job(job["id"], status="failed", error=str(e))
        await notification_repo.notify_admins("admin_lora_training", f"LoRA training failed: {job['name']}",
                               str(e), "/images/training", related_id=job["id"])
        return
    except (modal_client.ModalNotConfigured, RuntimeError) as e:
        log.warning("lora_training: setup failed job=%s: %s", job["id"], e)
        await lora_training_repo.update_job(job["id"], status="failed", error=str(e))
        await notification_repo.notify_admins("admin_lora_training", f"LoRA training failed: {job['name']}",
                               str(e), "/images/training", related_id=job["id"])
        return
    except Exception as e:
        log.error("lora_training: provisioning crashed job=%s: %s: %s", job["id"], type(e).__name__, e)
        await lora_training_repo.update_job(job["id"], status="failed", error=f"{type(e).__name__}: {e}")
        await notification_repo.notify_admins("admin_lora_training", f"LoRA training failed: {job['name']}",
                               f"{type(e).__name__}: {e}", "/images/training", related_id=job["id"])
        return
    finally:

        if not reached_training:
            await _queue_leave(job["id"])
            shutil.rmtree(dataset_dir, ignore_errors=True)
            try:
                await modal_client.remove_dataset_images(job["id"])
            except Exception as e:
                log.warning("lora_training: could not clean up remote dataset job=%s: %s", job["id"], e)

    try:
        attempt = 0
        while True:
            modal_events = modal_client.stream_training_job(config)
            recoverable_error = None
            try:
                recoverable_error = await _stream_one_attempt(
                    job, modal_events, config, current_user)
                if recoverable_error is None:
                    return
            except modal_client.ModalNotConfigured as e:
                await lora_training_repo.update_job(job["id"], status="failed", error=str(e))
                await notification_repo.notify_admins("admin_lora_training", f"LoRA training failed: {job['name']}",
                                       str(e), "/images/training", related_id=job["id"])
                return
            except _JobAborted:
                return
            except Exception as e:
                recoverable_error = f"{type(e).__name__}: {e}"

            attempt += 1
            if attempt > MAX_AUTO_RETRIES or _UNRECOVERABLE_RE.search(recoverable_error or ""):
                log.error("lora_training: giving up job=%s after attempt=%s: %s",
                          job["id"], attempt, recoverable_error)
                await lora_training_repo.update_job(job["id"], status="failed", error=recoverable_error)
                await notification_repo.notify_admins("admin_lora_training", f"LoRA training failed: {job['name']}",
                                       recoverable_error, "/images/training", related_id=job["id"])
                return

            latest = await lora_training_repo.get_job(job["id"])
            resume_name = latest.get("output_file") if latest else None
            resume_path = os.path.join(LORA_OUTPUT_DIR, resume_name) if resume_name else None
            if resume_path and os.path.isfile(resume_path):
                await modal_client.ensure_model_cached(resume_name, resume_path)
                config["resume_from_lora_name"] = resume_name
            log.warning("lora_training: transient failure job=%s attempt=%s/%s resume=%s: %s",
                       job["id"], attempt, MAX_AUTO_RETRIES, resume_name, recoverable_error)
            await lora_training_repo.update_job(job["id"], status="queued",
                log=f"Transient failure (attempt {attempt}/{MAX_AUTO_RETRIES}): {recoverable_error} — retrying"
                    f"{' from last saved checkpoint' if resume_name else ' from scratch'}…")
            await asyncio.sleep(5)
    finally:
        _aborted_jobs.discard(job["id"])
        await _queue_leave(job["id"])
        shutil.rmtree(dataset_dir, ignore_errors=True)
        try:
            await modal_client.remove_dataset_images(job["id"])
        except Exception as e:
            log.warning("lora_training: could not clean up remote dataset job=%s: %s", job["id"], e)

async def _stream_one_attempt(job, modal_events, config, current_user) -> str | None:
    await lora_training_repo.update_job(job["id"], status="training")
    async for event in modal_events:
        if job["id"] in _aborted_jobs:
            await modal_events.aclose()
            await lora_training_repo.update_job(job["id"], status="failed", error="Aborted by admin.")
            raise _JobAborted()
        etype = event.get("type")
        if etype == "error":
            return event.get("message", "")
        if etype == "progress":
            fields = {"status": event.get("status", "training"), "progress": float(event.get("progress") or 0)}

            if event.get("log"):
                fields["log"] = event["log"]
            if event.get("loss_history"):
                for point in event["loss_history"]:
                    await lora_training_repo.append_metric(job["id"], {
                        "step": point.get("step"), "loss": point.get("loss"),
                        "epoch": point.get("epoch"), "total_epochs": point.get("total_epochs"),
                        "speed_img_s": point.get("speed_img_s"), "eta_text": point.get("eta_text"),
                        "gpu_mem_gb": point.get("gpu_mem_gb"),
                        "progress": fields["progress"], "t": time.time()})
            ckpt_name = event.pop("checkpoint_name", None)
            if ckpt_name and event.pop("manual_checkpoint", False):

                out_name = f"{_lora_filename_slug(job['name'])}_{_iso8601_compact()}.safetensors"
                out_path = os.path.join(LORA_OUTPUT_DIR, out_name)
                await lora_training_repo.update_job(job["id"], log=f"Downloading requested checkpoint {out_name}…")
                await modal_client.download_output(ckpt_name, out_path,
                    on_progress=lambda n, recv, total, speed, jid=job["id"]: _persist_transfer_progress(
                        jid, "download", n, recv, total, speed))
                await asyncio.get_running_loop().run_in_executor(None, _chown, out_path)
                await lora_repo.gate_visibility(out_name, current_user["id"])
                await lora_training_repo.create_checkpoint(job["id"], out_name)
            elif ckpt_name:

                out_name = f"{job['id']}.safetensors"
                out_path = os.path.join(LORA_OUTPUT_DIR, out_name)
                await lora_training_repo.update_job(job["id"], log=f"Downloading checkpoint {out_name}…")
                await modal_client.download_output(ckpt_name, out_path,
                    on_progress=lambda n, recv, total, speed, jid=job["id"]: _persist_transfer_progress(
                        jid, "download", n, recv, total, speed))
                await asyncio.get_running_loop().run_in_executor(None, _chown, out_path)
                fields["output_file"] = out_name
                await lora_repo.gate_visibility(out_name, current_user["id"])
            await lora_training_repo.update_job(job["id"], **fields)
            continue
        if etype == "done":
            out_name = f"{job['id']}.safetensors"
            out_path = os.path.join(LORA_OUTPUT_DIR, out_name)
            await lora_training_repo.update_job(job["id"], status="saving",
                                              log="Downloading trained LoRA from Modal…")
            await modal_client.download_output(event["output_name"], out_path,
                on_progress=lambda n, recv, total, speed, jid=job["id"]: _persist_transfer_progress(
                    jid, "download", n, recv, total, speed))
            await asyncio.get_running_loop().run_in_executor(None, _chown, out_path)
            await lora_training_repo.update_job(job["id"], status="done", progress=1.0, output_file=out_name,
                                              log="Download complete — LoRA saved.")

            await lora_repo.gate_visibility(out_name, current_user["id"])
            log.info("lora_training: done by=%s job=%s file=%s",
                     current_user["username"], job["id"], out_name)
            await notification_repo.notify_admins("admin_lora_training", f"LoRA training complete: {job['name']}",
                                   f"{out_name} is ready to test/publish.", "/images/training",
                                   related_id=job["id"])
            return None

    log.warning("lora_training: stream ended without terminal event job=%s", job["id"])
    return ("Training stream ended without a final result — check the Modal dashboard's App Logs "
            "for this deploy to see whether it actually finished or crashed.")
