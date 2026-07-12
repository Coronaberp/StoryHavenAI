"""Modal app: trains an image LoRA on a Modal GPU using the real,
architecture-specific trainers from kohya-ss/sd-scripts (vendored at
modal_app/sd_scripts/ — see that directory for how it was pulled in), instead
of hand-rolling a diffusers training loop. This app used to run its own loop
against StableDiffusionPipeline.from_single_file, which only understands
classic SD1.x single-file checkpoints — it silently produced a broken LoRA
(or an outright load error) for both this app's real base models: SDXL/
Illustrious checkpoints, and Anima (a bespoke Cosmos-Predict2 DiT + Qwen3-0.6B
text encoder + Qwen-Image VAE architecture — see imagegen.py's ANIMA_*
comment). sd-scripts ships a dedicated trainer for each:
sdxl_train_network.py and anima_train_network.py.

Normally you never run `modal deploy` by hand — backend/modal_provision.py
does it automatically the first time an admin starts a Train LoRA job (and
re-deploys if the app is ever missing), using MODAL_TOKEN_ID/MODAL_TOKEN_SECRET
env vars on the story-game container for auth and generating its own
LORA_TRAIN_SHARED_SECRET, then caching the resulting train/request_checkpoint
URLs and secret straight into this app's global settings (CFG) — nothing to
paste anywhere. Deploying by hand is only for local debugging:

    LORA_TRAIN_SHARED_SECRET=<anything> modal deploy modal_app/lora_train.py

The endpoint is a single streaming request: the caller POSTs a zip of training
images + a JSON config (+ a base checkpoint file, and for Anima, its separate
CLIP/VAE files too) and keeps the connection open for the whole training run.
Progress/loss/preview lines from sd-scripts' own subprocess are parsed and
re-streamed as SSE `data: {...}` lines. Finished files (periodic checkpoints,
the final .safetensors) are never embedded inline — base64-encoding a
multi-MB file into one JSON line bloats it ~33% and forces a synchronous
encode/decode large enough to stall an event loop. Instead they're copied
onto the same model-cache Volume under a job-scoped name (_publish_output)
and the SSE event just carries that name; the caller fetches the actual
bytes afterward via the separate download_output endpoint, a plain chunked
binary transfer.

Text-encoder LoRA is never trained here (--network_train_unet_only), so the
output file needs no ComfyUI-format conversion (see sd-scripts'
networks/convert_anima_lora_to_comfy.py docstring — conversion is only
needed for a trained Qwen3 LoRA, not a DiT-only one) and loads straight into
ComfyUI's LoraLoader for both architectures.
"""
import asyncio
import glob
import hmac
import json
import os
import re
import shutil
import tempfile
import time

import modal
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

app = modal.App("storyhaven-lora-train")

SD_SCRIPTS_DIR = "/root/sd-scripts"
# add_local_dir's local_path is resolved relative to whatever the deploying
# `modal deploy` process's cwd happens to be (backend/modal_provision.py runs
# it with cwd=repo root, so a bare "sd_scripts" resolved to
# <repo root>/sd_scripts — one level too high; the vendored copy actually
# lives alongside this file at modal_app/sd_scripts/) — anchor it to this
# file's own directory instead so it's correct regardless of caller cwd.
_LOCAL_SD_SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sd_scripts")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    # fastapi is required by any @modal.fastapi_endpoint function's own image
    # as of recent modal client versions — it's no longer auto-added. Modal's
    # own error for this recommends the [standard] extra specifically (plain
    # "fastapi" alone wasn't enough — still errored the same way).
    .pip_install("fastapi[standard]")
    .pip_install(
        "torch==2.6.0", "torchvision==0.21.0",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .add_local_dir(_LOCAL_SD_SCRIPTS_DIR, remote_path=SD_SCRIPTS_DIR, copy=True)
    # requirements.txt ends with "-e ." (editable self-install) — that only
    # resolves correctly with SD_SCRIPTS_DIR as the actual cwd, not wherever
    # RUN's default cwd is; running the -r install from outside it fails with
    # "does not appear to be a Python project: neither 'setup.py' nor
    # 'pyproject.toml' found" since "." pointed at the wrong directory.
    .run_commands(f"cd {SD_SCRIPTS_DIR} && pip install --no-cache-dir -r requirements.txt")
)

# Baked in at deploy time from whatever the deploying process's own
# LORA_TRAIN_SHARED_SECRET env var holds (see backend/modal_provision.py) —
# this is this app's own bearer check on top of the two web endpoints below,
# not a Modal auth concept. Using from_dict here (a literal value captured at
# deploy time) means deploying never depends on a separately pre-created
# named Modal Secret.
secret = modal.Secret.from_dict({"value": os.environ.get("LORA_TRAIN_SHARED_SECRET", "")})

# Base checkpoints are huge (SDXL/Illustrious ~7GB, Anima's UNet ~4GB) — the
# very first version of this endpoint took one of these as part of every
# single training request's multipart body, buffered fully in memory on both
# ends. That's what was timing out/disconnecting mid-transfer (see
# backend/routers/lora_training.py's git history for the ClientDisconnect
# this caused). Now the backend uploads a given checkpoint file to this
# Volume once (streamed, not buffered — see upload_model below) and every
# later job that reuses the same base model just references it by name.
model_volume = modal.Volume.from_name("lora-train-model-cache", create_if_missing=True)
MODEL_CACHE_DIR = "/vol/models"

# Cross-function shared state: request_checkpoint (a separate, instant
# endpoint) sets checkpoint_requests[job_id] = True; the GPU-bound train()
# function polls it periodically and, when set, streams whatever checkpoint
# sd-scripts has most recently saved to disk (sd-scripts has no "save right
# now" hook mid-step the way the old hand-rolled loop did, so this is
# best-effort — it's whatever the last save-every-N-steps boundary produced,
# not a fresh snapshot of the exact current step).
checkpoint_requests = modal.Dict.from_name("lora-train-checkpoint-requests", create_if_missing=True)

_STEP_RE = re.compile(r"steps:\s*\d+%\|.*?\|\s*(\d+)/(\d+)")
_LOSS_RE = re.compile(r"avr_loss=([\d.]+)")
# tqdm's own bracket: "[02:15<01:22,  1.34it/s, ...]" — elapsed<remaining,rate.
_TQDM_BRACKET_RE = re.compile(r"\[[\d:]+<([\d:]+),\s*([\d.]+)(it/s|s/it)")
_EPOCH_RE = re.compile(r"epoch:\s*(\d+)")
_TOTAL_EPOCHS_RE = re.compile(r"num epochs.*?:\s*(\d+)")


def _auth(headers) -> bool:
    expected = os.environ.get("value", "")
    got = headers.get("authorization", "").removeprefix("Bearer ").strip()
    return bool(expected) and hmac.compare_digest(got, expected)


def _sse(payload: dict) -> str:
    return "data: " + json.dumps(payload) + "\n\n"


OUTPUT_DIR = os.path.join(MODEL_CACHE_DIR, "_outputs")


async def _publish_output(path: str, name: str) -> str:
    """Copies a finished LoRA/checkpoint file onto the same Volume used for
    cached base checkpoints, under a job-scoped name, instead of the old
    design of base64-embedding the whole file inline in one SSE JSON line
    (~33% larger on the wire, and a synchronous encode/decode of tens of MB
    of text that once froze the backend's single event loop). The backend
    downloads it right after via download_output, then this file is deleted."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    dest = os.path.join(OUTPUT_DIR, name)
    await asyncio.to_thread(shutil.copyfile, path, dest)
    await model_volume.commit.aio()
    return name


def _write_dataset(workdir: str, images_dir: str, trigger_word: str, resolution: int, batch_size: int) -> str:
    # images_dir already holds one img_NNNN.{ext} + img_NNNN.txt caption pair
    # per image — uploaded straight to this Volume path by
    # backend/modal_client.upload_dataset_images, not extracted from a zip
    # here — sd-scripts just needs a dataset config pointing at it.
    toml_path = os.path.join(workdir, "dataset.toml")
    with open(toml_path, "w") as f:
        f.write(f"""[general]
shuffle_caption = true
caption_extension = ".txt"
keep_tokens = 1
enable_bucket = true
bucket_reso_steps = 64
bucket_no_upscale = false
min_bucket_reso = 256
max_bucket_reso = {resolution * 2}

[[datasets]]
resolution = {resolution}
batch_size = {batch_size}

  [[datasets.subsets]]
  image_dir = "{images_dir}"
  num_repeats = 1
""")
    return toml_path


async def _gpu_mem_gb() -> float | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await proc.communicate()
        return round(int(out.decode().strip().splitlines()[0]) / 1024, 1)
    except Exception:
        return None


_STALL_LIMIT_SETUP = 1200
_STALL_LIMIT_MID_TRAINING = 600


async def _stream_subprocess(cmd: list[str], job_id: str, total_steps: int, out_dir: str, out_name: str,
                             batch_size: int, learning_rate: float):
    """Runs an sd-scripts trainer as a subprocess, parsing its tqdm/log output
    into a clean one-line-per-update summary (epoch, step, loss, speed, ETA,
    GPU memory) instead of passing its raw rich-console text through — that
    raw text is wrapped/boxed console formatting meant for a terminal, not a
    single log line in a web UI. Also watches out_dir for checkpoint files
    sd-scripts saves on its own schedule and streams each new one as it
    appears."""
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        cwd=SD_SCRIPTS_DIR)
    seen_checkpoints: set[str] = set()
    last_progress = 0.0
    last_step, last_epoch, last_total_epochs = 0, 0, 0
    last_loss, last_speed, last_eta = None, None, ""
    last_gpu_mem = None
    silence_started = time.time()
    last_heartbeat_sent = 0.0
    last_gpu_check = 0.0

    def _format_line():
        parts = [f"epoch {last_epoch}/{last_total_epochs or '?'}", f"step {last_step}/{total_steps}"]
        if last_loss is not None:
            parts.append(f"loss={last_loss:.4f}")
        parts.append(f"lr={learning_rate:.1e}")
        if last_speed is not None:
            parts.append(f"{last_speed:.1f}img/s")
        if last_eta:
            parts.append(f"eta {last_eta}")
        if last_gpu_mem is not None:
            parts.append(f"gpu {last_gpu_mem:.1f}GB")
        return " · ".join(parts)

    try:
        while True:
            line_task = asyncio.ensure_future(proc.stdout.readline())
            done, _ = await asyncio.wait({line_task}, timeout=2.0)
            if line_task not in done:
                line_task.cancel()
                line = b""
            else:
                line = line_task.result()
                if not line:
                    if proc.returncode is not None:
                        break
                    continue
            text = line.decode("utf-8", "ignore").strip("\r\n") if line else ""
            if text:
                silence_started = time.time()
                m = _STEP_RE.search(text)
                if m:
                    last_step, total = int(m.group(1)), int(m.group(2))
                    last_progress = last_step / max(1, total)
                loss_m = _LOSS_RE.search(text)
                if loss_m:
                    last_loss = float(loss_m.group(1))
                bracket_m = _TQDM_BRACKET_RE.search(text)
                if bracket_m:
                    last_eta, rate, unit = bracket_m.group(1), float(bracket_m.group(2)), bracket_m.group(3)
                    last_speed = batch_size * rate if unit == "it/s" else batch_size / rate
                epoch_m = _EPOCH_RE.search(text)
                if epoch_m:
                    last_epoch = int(epoch_m.group(1))
                total_epochs_m = _TOTAL_EPOCHS_RE.search(text)
                if total_epochs_m:
                    last_total_epochs = int(total_epochs_m.group(1))
                now = time.time()
                if now - last_gpu_check >= 5:
                    last_gpu_check = now
                    last_gpu_mem = await _gpu_mem_gb()
                fields = {"type": "progress", "status": "training", "progress": last_progress,
                         "log": _format_line()}
                if loss_m:
                    fields["loss_history"] = [{"step": last_step, "loss": last_loss, "epoch": last_epoch,
                                              "speed_img_s": last_speed, "eta_text": last_eta,
                                              "gpu_mem_gb": last_gpu_mem, "total_epochs": last_total_epochs}]
                yield _sse(fields)
            else:
                now = time.time()
                silent_for = now - silence_started
                stall_limit = _STALL_LIMIT_MID_TRAINING if last_step > 0 else _STALL_LIMIT_SETUP
                if silent_for >= stall_limit:
                    proc.kill()
                    await proc.wait()
                    yield _sse({"type": "error",
                               "message": f"Training subprocess produced no output for {int(silent_for)}s — "
                                         f"killed as a stall instead of running to the full timeout."})
                    return
                if now - last_heartbeat_sent >= 5:
                    last_heartbeat_sent = now
                    yield _sse({"type": "progress", "status": "training", "progress": last_progress,
                               "log": f"{_format_line()} (idle {int(silent_for)}s)"})

            # Stream any checkpoint sd-scripts has saved since we last looked,
            # and — if an admin hit "Request checkpoint now" — re-stream
            # whatever's most recent even if we've already sent it once.
            manual = bool(await checkpoint_requests.pop.aio(job_id, None))
            candidates = sorted(glob.glob(os.path.join(out_dir, f"{out_name}-*.safetensors")))
            new_ones = [c for c in candidates if c not in seen_checkpoints]
            to_send = new_ones or ([candidates[-1]] if manual and candidates else [])
            for ckpt_path in to_send:
                seen_checkpoints.add(ckpt_path)
                ckpt_name = f"{job_id}_{os.path.basename(ckpt_path)}"
                await _publish_output(ckpt_path, ckpt_name)
                yield _sse({"type": "progress", "status": "training", "progress": last_progress,
                           "log": f"checkpoint saved: {os.path.basename(ckpt_path)}",
                           "checkpoint_name": ckpt_name,
                           "manual_checkpoint": manual and ckpt_path not in new_ones})

            if proc.returncode is not None:
                break
        await proc.wait()
        if proc.returncode != 0:
            yield _sse({"type": "error", "message": f"training process exited with code {proc.returncode}"})
            return
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()


async def _run_training(config: dict):
    architecture = config.get("architecture", "sdxl")
    job_id = config.get("job_id") or ""
    resolution = int(config.get("resolution", 512))
    rank = int(config.get("rank", 16))
    alpha = int(config.get("alpha", rank))
    lr = float(config.get("learning_rate", 1e-4))
    steps = int(config.get("steps", 1000))
    batch_size = int(config.get("batch_size", 1))
    trigger_word = (config.get("trigger_word") or "sks").strip()
    noise_offset = float(config.get("noise_offset") or 0.0)
    network_dropout = float(config.get("network_dropout") or 0.0)
    if job_id:
        await checkpoint_requests.pop.aio(job_id, None)

    yield _sse({"type": "progress", "status": "loading_base_model", "progress": 0.0})

    await model_volume.reload.aio()  # see checkpoints/dataset uploaded by other containers/since our own cold start
    cached_ckpt_path = os.path.join(MODEL_CACHE_DIR, config["base_checkpoint_name"])
    if not os.path.isfile(cached_ckpt_path):
        yield _sse({"type": "error", "message": f"checkpoint not found in Modal's model cache: "
                                                f"{config['base_checkpoint_name']} (upload it first)"})
        return

    images_dir = os.path.join(MODEL_CACHE_DIR, "_datasets", job_id)
    if not job_id or not os.path.isdir(images_dir) or not os.listdir(images_dir):
        yield _sse({"type": "error", "message": f"training dataset not found in Modal's Volume for job "
                                                f"{job_id!r} (upload it first)"})
        return

    workdir = tempfile.mkdtemp(prefix="lora_train_")
    out_dir = os.path.join(workdir, "out")
    os.makedirs(out_dir, exist_ok=True)
    out_name = "lora"
    try:
        dataset_toml = _write_dataset(workdir, images_dir, trigger_word, resolution, batch_size)
        checkpoint_every = max(50, steps // 4)

        if architecture == "anima":
            # nova_anime_am_anima.safetensors (and possibly other ComfyUI-exported
            # Anima checkpoints) store weights under a "model.diffusion_model."
            # prefix — ComfyUI's own full-checkpoint convention — but
            # anima_train_network.py only auto-strips a "net." prefix. Write the
            # stripped copy into workdir rather than mutating the shared cached
            # file on the Volume (other jobs may read it concurrently).
            from safetensors.torch import load_file, save_file
            sd = load_file(cached_ckpt_path)
            prefix = "model.diffusion_model."
            if any(k.startswith(prefix) for k in sd):
                sd = {(k[len(prefix):] if k.startswith(prefix) else k): v for k, v in sd.items()}
            ckpt_path = os.path.join(workdir, "base_checkpoint.safetensors")
            save_file(sd, ckpt_path)
            del sd

            clip_path = os.path.join(MODEL_CACHE_DIR, config["clip_name"])
            vae_path = os.path.join(MODEL_CACHE_DIR, config["vae_name"])
            if not os.path.isfile(clip_path) or not os.path.isfile(vae_path):
                yield _sse({"type": "error", "message": "Anima CLIP/VAE not found in Modal's model cache "
                                                        "(upload them first)"})
                return

            cmd = ["python3", "anima_train_network.py",
                  f"--pretrained_model_name_or_path={ckpt_path}", f"--qwen3={clip_path}", f"--vae={vae_path}",
                  f"--dataset_config={dataset_toml}", f"--output_dir={out_dir}", f"--output_name={out_name}",
                  "--save_model_as=safetensors", "--network_module=networks.lora_anima",
                  f"--network_dim={rank}", f"--network_alpha={alpha}", "--network_train_unet_only",
                  f"--learning_rate={lr}", "--optimizer_type=AdamW", "--lr_scheduler=constant",
                  "--timestep_sampling=sigmoid", f"--max_train_steps={steps}",
                  f"--save_every_n_steps={checkpoint_every}", "--mixed_precision=bf16",
                  "--gradient_checkpointing", "--cache_latents", "--cache_text_encoder_outputs",
                  "--max_data_loader_n_workers=0", "--min_snr_gamma=5.0"]
            if config.get("resume_from_lora_name"):
                cmd.append(f"--network_weights={os.path.join(MODEL_CACHE_DIR, config['resume_from_lora_name'])}")
            if noise_offset > 0:
                cmd.append(f"--noise_offset={noise_offset}")
            if network_dropout > 0:
                cmd.append(f"--network_dropout={network_dropout}")
        else:
            # No prefix-stripping needed for SDXL/Illustrious — reference the
            # cached file on the Volume directly (read-only), no reason to
            # copy a ~7GB checkpoint into workdir first.
            cmd = ["python3", "sdxl_train_network.py",
                  f"--pretrained_model_name_or_path={cached_ckpt_path}",
                  f"--dataset_config={dataset_toml}", f"--output_dir={out_dir}", f"--output_name={out_name}",
                  "--save_model_as=safetensors", "--network_module=networks.lora",
                  f"--network_dim={rank}", f"--network_alpha={alpha}",
                  f"--learning_rate={lr}", "--optimizer_type=AdamW", "--lr_scheduler=constant",
                  f"--max_train_steps={steps}", f"--save_every_n_steps={checkpoint_every}",
                  "--mixed_precision=bf16", "--gradient_checkpointing", "--cache_latents", "--no_half_vae",
                  "--max_data_loader_n_workers=0", "--min_snr_gamma=5.0"]
            if config.get("resume_from_lora_name"):
                cmd.append(f"--network_weights={os.path.join(MODEL_CACHE_DIR, config['resume_from_lora_name'])}")
            if noise_offset > 0:
                cmd.append(f"--noise_offset={noise_offset}")
            if network_dropout > 0:
                cmd.append(f"--network_dropout={network_dropout}")

        yield _sse({"type": "progress", "status": "training", "progress": 0.0, "loss_history": []})
        async for event in _stream_subprocess(cmd, job_id, steps, out_dir, out_name, batch_size, lr):
            yield event

        final_path = os.path.join(out_dir, f"{out_name}.safetensors")
        if not os.path.isfile(final_path):
            yield _sse({"type": "error", "message": "training finished but no output file was produced"})
            return
        yield _sse({"type": "progress", "status": "saving", "progress": 0.99})
        output_name = f"{job_id}_final.safetensors"
        await _publish_output(final_path, output_name)
        yield _sse({"type": "done", "progress": 1.0, "elapsed_seconds": 0, "output_name": output_name})
    except Exception as e:
        yield _sse({"type": "error", "message": str(e)})
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        if job_id:
            await checkpoint_requests.pop.aio(job_id, None)


# Modal only offers datacenter GPUs (T4/L4/A10G/A100/L40S/H100/H200/B200) —
# no consumer RTX cards, so "RTX4090" (this app's original diffusers-based
# trainer picked it, presumably against an older/different Modal API) isn't
# valid and fails deploy outright. L4 is the cheapest option that still
# actually works for this: 24GB VRAM and real Ada-generation bf16 tensor
# cores (this trainer always runs --mixed_precision=bf16) — T4 is cheaper
# per-hour but Turing-generation with weak bf16 support and only 16GB, likely
# too slow/tight for SDXL/Anima LoRA training at this app's resolutions.
@app.function(image=image, gpu="L4", timeout=60 * 60 * 3, secrets=[secret],
             volumes={MODEL_CACHE_DIR: model_volume})
@modal.fastapi_endpoint(method="POST")
async def train(req: Request):
    # Modal's fastapi_endpoint wraps this in a real FastAPI route — an
    # untyped bare "request" parameter (this file's original form) gets
    # treated as a JSON request body to validate against, not the special
    # Request object, and rejects any real (multipart) request with 422
    # Unprocessable Entity before this function body ever runs. A real,
    # module-level-resolvable "Request" annotation is what tells FastAPI to
    # hand over the raw request instead.
    if not _auth(req.headers):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    form = await req.form()
    config = json.loads(form["config"])
    return StreamingResponse(_run_training(config), media_type="text/event-stream")


lightweight_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]")


@app.function(image=lightweight_image, secrets=[secret], volumes={MODEL_CACHE_DIR: model_volume})
@modal.fastapi_endpoint(method="POST")
async def check_model_cached(req: Request):
    """Cheap (no-GPU) precheck so the backend only ever uploads a base
    checkpoint/CLIP/VAE once — it compares against the exact byte size of the
    local file it's about to (maybe) upload, not just presence by name, so a
    changed/re-exported file with the same name gets re-cached correctly."""
    if not _auth(req.headers):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await req.json()
    name = (body.get("name") or "").strip()
    size = int(body.get("size") or 0)
    if not name:
        return JSONResponse({"error": "name required"}, status_code=400)
    await model_volume.reload.aio()
    path = os.path.join(MODEL_CACHE_DIR, name)
    cached = os.path.isfile(path) and os.path.getsize(path) == size
    return JSONResponse({"cached": cached})


_UPLOAD_COMMIT_EVERY = 200 * 1024 * 1024  # periodic Volume commits during a
# long upload — without this, a dropped connection loses everything written
# so far (uncommitted Volume writes don't survive this container going away),
# making the resume_from support below pointless.


@app.function(image=lightweight_image, secrets=[secret], volumes={MODEL_CACHE_DIR: model_volume},
             timeout=60 * 30)
@modal.fastapi_endpoint(method="POST")
async def upload_model(req: Request):
    """Streams the request body straight to a file on the Volume — never
    buffers the whole (multi-GB) checkpoint in memory the way the old
    per-job upload used to. name comes as a query param (?name=...) rather
    than form data specifically so the body can be read as a raw byte stream
    instead of going through multipart form parsing.

    ?query_progress=1 (no body) reports how many bytes of an in-progress
    upload are actually committed to the Volume so far, without touching the
    file — used by backend/modal_client.py's retry-with-resume after a
    dropped connection. ?resume_from=<n> continues an upload from byte n of
    the .tmp file instead of starting over, truncating anything already
    written past that point first so a partial/corrupted tail from the
    dropped attempt can't linger."""
    if not _auth(req.headers):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    name = (req.query_params.get("name") or "").strip()
    if not name or "/" in name or ".." in name:
        return JSONResponse({"error": "invalid name"}, status_code=400)
    tmp_path = os.path.join(MODEL_CACHE_DIR, f".tmp_{name}")
    final_path = os.path.join(MODEL_CACHE_DIR, name)

    if req.query_params.get("query_progress"):
        await model_volume.reload.aio()
        size = os.path.getsize(tmp_path) if os.path.isfile(tmp_path) else 0
        return JSONResponse({"bytes_received": size})

    os.makedirs(MODEL_CACHE_DIR, exist_ok=True)
    resume_from = int(req.query_params.get("resume_from") or 0)
    if resume_from:
        await model_volume.reload.aio()
    mode = "r+b" if resume_from and os.path.isfile(tmp_path) else "wb"
    written_since_commit = 0
    with open(tmp_path, mode) as f:
        if mode == "r+b":
            f.truncate(resume_from)
            f.seek(resume_from)
        async for chunk in req.stream():
            # Blocking write inside an async function stalls the whole event
            # loop for the write's duration on every chunk of a multi-GB
            # file — asyncio.to_thread keeps this container responsive
            # between chunks instead (same fix applied to the sending side
            # in backend/modal_client.py's _file_chunks).
            await asyncio.to_thread(f.write, chunk)
            written_since_commit += len(chunk)
            if written_since_commit >= _UPLOAD_COMMIT_EVERY:
                await asyncio.to_thread(f.flush)
                await model_volume.commit.aio()
                written_since_commit = 0
    os.replace(tmp_path, final_path)
    await model_volume.commit.aio()
    return JSONResponse({"uploaded": True})


@app.function(image=lightweight_image, secrets=[secret], volumes={MODEL_CACHE_DIR: model_volume},
             timeout=60 * 30)
@modal.fastapi_endpoint(method="POST")
async def download_output(req: Request):
    """Streams a finished LoRA/checkpoint back as raw bytes — the download
    counterpart to upload_model's upload, replacing the old design where the
    file was base64-embedded inline in the training SSE stream. Deletes the
    file from the Volume once served since these are job-scoped one-shot
    handoffs, not reusable cached inputs like the base checkpoints."""
    if not _auth(req.headers):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await req.json()
    name = (body.get("name") or "").strip()
    if not name or "/" in name or ".." in name:
        return JSONResponse({"error": "invalid name"}, status_code=400)
    await model_volume.reload.aio()
    path = os.path.join(OUTPUT_DIR, name)
    if not os.path.isfile(path):
        return JSONResponse({"error": "not found"}, status_code=404)

    async def _chunks():
        f = await asyncio.to_thread(open, path, "rb")
        try:
            while True:
                chunk = await asyncio.to_thread(f.read, 1024 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            f.close()
        os.remove(path)
        await model_volume.commit.aio()

    return StreamingResponse(_chunks(), media_type="application/octet-stream")


# No GPU, no training image — this just flips a flag in the shared Dict that
# the actual GPU-bound train() function above polls periodically, so it
# responds instantly regardless of how busy/queued the training container is.
# Still needs its own fastapi[standard]-equipped image, same as train() —
# @modal.fastapi_endpoint doesn't get that for free on Modal's own bare
# default image any more than it does on a custom one.
@app.function(image=lightweight_image, secrets=[secret])
@modal.fastapi_endpoint(method="POST")
async def request_checkpoint(req: Request):
    if not _auth(req.headers):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await req.json()
    job_id = (body.get("job_id") or "").strip()
    if not job_id:
        return JSONResponse({"error": "job_id required"}, status_code=400)
    await checkpoint_requests.put.aio(job_id, True)
    return JSONResponse({"requested": True})
