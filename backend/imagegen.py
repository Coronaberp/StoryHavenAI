"""ComfyUI client: submit a txt2img workflow, poll for completion, fetch the image.

Mirrors llm.py's plain-httpx client style. ComfyUI's REST API is workflow-graph
based (nodes keyed by string id) rather than a simple text-to-image endpoint, so
callers pass a prompt string and this module fills it into either the built-in
default workflow template or an admin-supplied custom workflow (exported from
the ComfyUI UI via "Save (API Format)").

Workflow graph templates/builders live in imagegen_workflows.py; checkpoint/
LoRA/sampler/scheduler/upscaler option listing lives in imagegen_options.py —
both are re-exported here so every existing `imagegen.X` call site (routers,
modal_client) keeps working unchanged.
"""
import asyncio
import json
import struct
import uuid

import httpx
import websockets

from backend.repositories import checkpoints as checkpoint_repo
from backend.state import log
from backend.imagegen_workflows import (  # noqa: F401
    DEFAULT_WORKFLOW, ANIMA_WORKFLOW,
    ANIMA_CLIP_NAME, ANIMA_VAE_NAME, ANIMA_DEFAULT_SAMPLER, ANIMA_DEFAULT_SCHEDULER, ANIMA_DEFAULT_CFG,
    _build_workflow, _build_anima_workflow, _build_upscale_workflow, _build_inpaint_workflow,
    _build_anima_inpaint_workflow, _build_wan_video_workflow,
    _splice_loras, _splice_loras_anima, _splice_reference_image,
)
from backend.imagegen_options import (  # noqa: F401
    list_object_options, list_checkpoints, list_anima_unets, list_clip_models,
    list_vaes, list_loras, list_upscalers, list_samplers,
    list_wan_unets, list_wan_clip_models,
    CHECKPOINT_NAME_BLACKLIST_EXACT, LORA_NAME_BLACKLIST_PREFIXES, LORA_NAME_BLACKLIST_EXACT,
    _lora_blacklisted,
)

# ComfyUI's BinaryEventTypes.PREVIEW_IMAGE — the event-type tag on binary WS frames
# that carry a live in-progress denoising preview instead of JSON status.
_WS_PREVIEW_IMAGE = 1


async def _submit_prompt(client: httpx.AsyncClient, root: str, workflow: dict, client_id: str) -> str:
    """POST a workflow graph to ComfyUI's /prompt and return the prompt_id.
    A plain r.raise_for_status() here only ever surfaced a generic "400 Bad
    Request" with no indication of which node/input was actually invalid,
    which cost real debugging time tracing a missing SaveVideo field and a
    wrong CLIP output shape — both would have been obvious immediately from
    ComfyUI's own node_errors body."""
    r = await client.post(f"{root}/prompt", json={"prompt": workflow, "client_id": client_id})
    if r.status_code >= 400:
        detail = r.text
        try:
            body = r.json()
            detail = body.get("node_errors") or body.get("error") or body
        except ValueError:
            pass
        log.error("comfyui: /prompt rejected status=%s detail=%s", r.status_code, detail)
        raise RuntimeError(f"ComfyUI rejected the workflow: {detail}")
    return r.json()["prompt_id"]


async def interrupt(base_url: str):
    """Ask ComfyUI to stop the prompt it's currently executing via its /interrupt
    endpoint (no body — it aborts whatever the worker is running right now). Used
    when the client cancels an in-progress generation, so the GPU work stops
    instead of finishing in the background after the stream is abandoned."""
    root = (base_url or "").rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{root}/interrupt")
        r.raise_for_status()


async def upload_reference_image(base_url: str, image_bytes: bytes, filename: str = "reference.png") -> str:
    """Uploads a reference image into ComfyUI's own input folder via its
    /upload/image endpoint, returning the filename ComfyUI stored it under
    (needed to reference it from a LoadImage node in the workflow graph).
    The stored filename is namespaced with a per-call uuid so two concurrent
    requests (from the same or different users) never overwrite each other's
    source image before ComfyUI's own job queue gets around to running the
    workflow that references it — a real bug that silently substituted one
    user's uploaded image with another's."""
    root = (base_url or "").rstrip("/")
    unique_filename = f"{uuid.uuid4().hex[:12]}_{filename}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{root}/upload/image",
                              files={"image": (unique_filename, image_bytes, "image/png")},
                              data={"overwrite": "true"})
        r.raise_for_status()
        return r.json()["name"]


async def upload_mask_image(base_url: str, mask_bytes: bytes, filename: str = "mask.png") -> str:
    """Uploads an inpaint mask into ComfyUI's input folder the same way
    upload_reference_image does for a reference image — returns the filename
    ComfyUI stored it under for a LoadImageMask node to reference. Namespaced
    per-call for the same reason upload_reference_image is."""
    root = (base_url or "").rstrip("/")
    unique_filename = f"{uuid.uuid4().hex[:12]}_{filename}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{root}/upload/image",
                              files={"image": (unique_filename, mask_bytes, "image/png")},
                              data={"overwrite": "true"})
        r.raise_for_status()
        return r.json()["name"]


async def generate_image(positive: str, negative: str, base_url: str, checkpoint: str,
                         custom_workflow: str | None = None,
                         loras: list[dict] | None = None,
                         reference_image: bytes | None = None, denoise: float = 0.6,
                         width: int = 1024, height: int = 1024,
                         sampler: str = "euler", scheduler: str = "normal",
                         steps: int = 20, cfg: float = 7.0, architecture: str = "sdxl",
                         timeout_s: float = 120.0) -> bytes:
    """Submit prompt to ComfyUI, poll until done, return the resulting image bytes.
    loras is a list of {"name": str, "strength": float} dicts, applied as a chain
    (each stacks on the previous one's output), same as ComfyUI's own UI.
    reference_image (raw PNG/JPEG bytes), when given, switches this from txt2img
    to img2img — the output stays visually anchored to it (composition, colors,
    pose) at a strength controlled by denoise (lower = closer to the reference,
    higher = more freedom for the prompt to diverge from it).
    architecture="anima" switches to the unrelated Anima graph (checkpoint is
    then the UNet filename) — LoRAs and reference images (img2img) both work
    there now (see _splice_loras_anima)."""
    root = (base_url or "").rstrip("/")
    if architecture == "anima":
        clip_name, vae_name = await checkpoint_repo.get_anima_overrides(checkpoint)
        ref_name = await upload_reference_image(root, reference_image) if reference_image else None
        workflow = _build_anima_workflow(positive, negative, checkpoint,
                                         width=width, height=height, sampler=sampler,
                                         scheduler=scheduler, steps=steps, cfg=cfg,
                                         reference_image_name=ref_name, denoise=denoise,
                                         clip_name=clip_name, vae_name=vae_name, loras=loras)
    else:
        ref_name = await upload_reference_image(root, reference_image) if reference_image else None
        workflow = _build_workflow(positive, negative, checkpoint, custom_workflow, loras,
                                   reference_image_name=ref_name, denoise=denoise,
                                   width=width, height=height, sampler=sampler, scheduler=scheduler,
                                   steps=steps, cfg=cfg)
    client_id = uuid.uuid4().hex

    async with httpx.AsyncClient(timeout=30) as client:
        prompt_id = await _submit_prompt(client, root, workflow, client_id)

        elapsed = 0.0
        interval = 1.0
        history = None
        while elapsed < timeout_s:
            await asyncio.sleep(interval)
            elapsed += interval
            hr = await client.get(f"{root}/history/{prompt_id}")
            hr.raise_for_status()
            data = hr.json()
            if prompt_id in data:
                history = data[prompt_id]
                break
        if history is None:
            raise TimeoutError("ComfyUI did not finish generating within the timeout")

        status = history.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(f"ComfyUI generation failed: {status}")

        outputs = history.get("outputs", {})
        image_info = None
        for node_out in outputs.values():
            imgs = node_out.get("images") or []
            if imgs:
                image_info = imgs[0]
                break
        if not image_info:
            raise RuntimeError("ComfyUI finished but produced no image output")

        vr = await client.get(f"{root}/view", params={
            "filename": image_info["filename"],
            "subfolder": image_info.get("subfolder", ""),
            "type": image_info.get("type", "output"),
        })
        vr.raise_for_status()
        return vr.content


async def upscale_image(image_bytes: bytes, base_url: str, upscaler_name: str, timeout_s: float = 120.0) -> bytes:
    """Runs a single ComfyUI upscale pass (LoadImage -> UpscaleModelLoader ->
    ImageUpscaleWithModel -> SaveImage) over an already-generated image the
    caller uploads directly — no checkpoint/sampler graph involved, just a
    dedicated upscale model applied to existing pixels. Mirrors generate_image's
    submit/poll/fetch pattern."""
    root = (base_url or "").rstrip("/")
    image_name = await upload_reference_image(root, image_bytes, filename="upscale_src.png")
    workflow = _build_upscale_workflow(image_name, upscaler_name)
    client_id = uuid.uuid4().hex

    async with httpx.AsyncClient(timeout=30) as client:
        prompt_id = await _submit_prompt(client, root, workflow, client_id)

        elapsed = 0.0
        interval = 1.0
        history = None
        while elapsed < timeout_s:
            await asyncio.sleep(interval)
            elapsed += interval
            hr = await client.get(f"{root}/history/{prompt_id}")
            hr.raise_for_status()
            data = hr.json()
            if prompt_id in data:
                history = data[prompt_id]
                break
        if history is None:
            raise TimeoutError("ComfyUI did not finish upscaling within the timeout")

        status = history.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(f"ComfyUI upscale failed: {status}")

        outputs = history.get("outputs", {})
        image_info = None
        for node_out in outputs.values():
            imgs = node_out.get("images") or []
            if imgs:
                image_info = imgs[0]
                break
        if not image_info:
            raise RuntimeError("ComfyUI finished but produced no image output")

        vr = await client.get(f"{root}/view", params={
            "filename": image_info["filename"],
            "subfolder": image_info.get("subfolder", ""),
            "type": image_info.get("type", "output"),
        })
        vr.raise_for_status()
        return vr.content


async def upscale_image_stream(image_bytes: bytes, base_url: str, upscaler_name: str,
                               timeout_s: float = 120.0):
    """Live-preview counterpart to upscale_image, same websocket-before-submit
    pattern as generate_image_stream. A plain ImageUpscaleWithModel node has
    no iterative denoising steps of its own, so there's no guarantee of any
    "preview" frame ever arriving here the way there is for a KSampler graph —
    but connecting to the websocket instead of blind-polling /history means
    the "done" event fires the instant ComfyUI actually finishes, not up to
    1s later, and forwards any preview/progress ComfyUI does happen to emit
    (some upscale-model implementations process in tiles and report as they
    go) instead of silently discarding it."""
    try:
        import websockets
    except ImportError:
        raise RuntimeError(
            "The 'websockets' package isn't installed — live preview streaming needs it "
            "(pip install websockets in the app's venv). Non-streaming upscaling still works.")
    root = (base_url or "").rstrip("/")
    ws_scheme_root = root.replace("http://", "ws://").replace("https://", "wss://")
    image_name = await upload_reference_image(root, image_bytes, filename="upscale_src.png")
    workflow = _build_upscale_workflow(image_name, upscaler_name)
    client_id = uuid.uuid4().hex

    async with websockets.connect(f"{ws_scheme_root}/ws?clientId={client_id}", max_size=None) as ws:
        async with httpx.AsyncClient(timeout=30) as client:
            prompt_id = await _submit_prompt(client, root, workflow, client_id)

            finished = False
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    if len(raw) < 8:
                        continue
                    event_type = struct.unpack(">I", raw[:4])[0]
                    if event_type == _WS_PREVIEW_IMAGE:
                        yield ("preview", bytes(raw[8:]))
                    continue
                try:
                    msg = json.loads(raw)
                except Exception as e:
                    log.warning("comfyui: skipping malformed websocket message error=%s", e)
                    continue
                if msg.get("type") == "executing":
                    data = msg.get("data", {})
                    if data.get("prompt_id") == prompt_id and data.get("node") is None:
                        finished = True
                        break

            if not finished:
                raise TimeoutError("ComfyUI connection closed before upscaling finished")

        async with httpx.AsyncClient(timeout=30) as client:
            hr = await client.get(f"{root}/history/{prompt_id}")
            hr.raise_for_status()
            history = hr.json().get(prompt_id, {})
            status = history.get("status", {})
            if status.get("status_str") == "error":
                log.error("comfyui upscale failed: %s", status)
                raise RuntimeError(f"ComfyUI upscale failed: {status}")
            outputs = history.get("outputs", {})
            image_info = None
            for node_out in outputs.values():
                imgs = node_out.get("images") or []
                if imgs:
                    image_info = imgs[0]
                    break
            if not image_info:
                raise RuntimeError("ComfyUI finished but produced no image output")
            vr = await client.get(f"{root}/view", params={
                "filename": image_info["filename"],
                "subfolder": image_info.get("subfolder", ""),
                "type": image_info.get("type", "output"),
            })
            vr.raise_for_status()
            yield ("done", vr.content)


async def generate_image_stream(positive: str, negative: str, base_url: str, checkpoint: str,
                                loras: list[dict] | None = None,
                                reference_image: bytes | None = None, denoise: float = 0.6,
                                width: int = 1024, height: int = 1024,
                                sampler: str = "euler", scheduler: str = "normal",
                                steps: int = 20, cfg: float = 7.0, architecture: str = "sdxl",
                                timeout_s: float = 120.0):
    """Like generate_image, but a live generator for the standalone image-gen page:
    connects to ComfyUI's websocket *before* submitting the prompt so no preview
    frames are missed, and yields ("preview", jpeg_bytes) as each denoising step's
    in-progress preview arrives, then ("done", png_bytes) once the final image is
    ready. Nothing is written to disk here — the caller decides whether to keep it.
    reference_image switches this to img2img — see generate_image's docstring.
    architecture="anima" switches to the unrelated Anima graph — see generate_image."""
    root = (base_url or "").rstrip("/")
    ws_scheme_root = root.replace("http://", "ws://").replace("https://", "wss://")
    if architecture == "anima":
        clip_name, vae_name = await checkpoint_repo.get_anima_overrides(checkpoint)
        ref_name = await upload_reference_image(root, reference_image) if reference_image else None
        workflow = _build_anima_workflow(positive, negative, checkpoint,
                                         width=width, height=height, sampler=sampler,
                                         scheduler=scheduler, steps=steps, cfg=cfg,
                                         reference_image_name=ref_name, denoise=denoise,
                                         clip_name=clip_name, vae_name=vae_name, loras=loras)
    else:
        ref_name = await upload_reference_image(root, reference_image) if reference_image else None
        workflow = _build_workflow(positive, negative, checkpoint, None, loras,
                                   reference_image_name=ref_name, denoise=denoise,
                                   width=width, height=height, sampler=sampler, scheduler=scheduler,
                                   steps=steps, cfg=cfg)
    client_id = uuid.uuid4().hex

    async with websockets.connect(f"{ws_scheme_root}/ws?clientId={client_id}", max_size=None) as ws:
        async with httpx.AsyncClient(timeout=30) as client:
            prompt_id = await _submit_prompt(client, root, workflow, client_id)

            finished = False
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    if len(raw) < 8:
                        continue
                    event_type = struct.unpack(">I", raw[:4])[0]
                    if event_type == _WS_PREVIEW_IMAGE:
                        yield ("preview", bytes(raw[8:]))
                    continue
                try:
                    msg = json.loads(raw)
                except Exception as e:
                    log.warning("comfyui: skipping malformed websocket message error=%s", e)
                    continue
                if msg.get("type") == "executing":
                    data = msg.get("data", {})
                    if data.get("prompt_id") == prompt_id and data.get("node") is None:
                        finished = True
                        break

            if not finished:
                raise TimeoutError("ComfyUI connection closed before generation finished")

        async with httpx.AsyncClient(timeout=30) as client:
            hr = await client.get(f"{root}/history/{prompt_id}")
            hr.raise_for_status()
            history = hr.json().get(prompt_id, {})
            status = history.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI generation failed: {status}")
            outputs = history.get("outputs", {})
            image_info = None
            for node_out in outputs.values():
                imgs = node_out.get("images") or []
                if imgs:
                    image_info = imgs[0]
                    break
            if not image_info:
                raise RuntimeError("ComfyUI finished but produced no image output")
            vr = await client.get(f"{root}/view", params={
                "filename": image_info["filename"],
                "subfolder": image_info.get("subfolder", ""),
                "type": image_info.get("type", "output"),
            })
            vr.raise_for_status()
            yield ("done", vr.content)


async def generate_inpaint_image_stream(positive: str, negative: str, base_url: str, checkpoint: str,
                                        image_bytes: bytes, mask_bytes: bytes, denoise: float = 1.0,
                                        sampler: str = "euler", scheduler: str = "normal",
                                        steps: int = 20, cfg: float = 7.0, architecture: str = "sdxl"):
    """Live-preview inpaint generation for the standalone image-gen page —
    same websocket/preview/done shape as generate_image_stream, but builds
    the masked-inpaint graph instead of a plain txt2img/img2img one.
    architecture="anima" switches to _build_anima_inpaint_workflow (checkpoint
    is then the UNet filename, same convention as generate_image) — this was
    previously unsupported, so an Anima model picked here reached ComfyUI as
    an invalid CheckpointLoaderSimple ckpt_name and was rejected outright."""
    root = (base_url or "").rstrip("/")
    ws_scheme_root = root.replace("http://", "ws://").replace("https://", "wss://")
    image_name = await upload_reference_image(root, image_bytes, filename="inpaint_source.png")
    mask_name = await upload_mask_image(root, mask_bytes)
    if architecture == "anima":
        clip_name, vae_name = await checkpoint_repo.get_anima_overrides(checkpoint)
        workflow = _build_anima_inpaint_workflow(positive, negative, checkpoint, image_name, mask_name,
                                                 denoise=denoise, sampler=sampler, scheduler=scheduler,
                                                 steps=steps, cfg=cfg, clip_name=clip_name, vae_name=vae_name)
    else:
        workflow = _build_inpaint_workflow(positive, negative, checkpoint, image_name, mask_name,
                                           denoise=denoise, sampler=sampler, scheduler=scheduler,
                                           steps=steps, cfg=cfg)
    client_id = uuid.uuid4().hex

    async with websockets.connect(f"{ws_scheme_root}/ws?clientId={client_id}", max_size=None) as ws:
        async with httpx.AsyncClient(timeout=30) as client:
            prompt_id = await _submit_prompt(client, root, workflow, client_id)

            finished = False
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    if len(raw) < 8:
                        continue
                    event_type = struct.unpack(">I", raw[:4])[0]
                    if event_type == _WS_PREVIEW_IMAGE:
                        yield ("preview", bytes(raw[8:]))
                    continue
                try:
                    msg = json.loads(raw)
                except Exception as e:
                    log.warning("comfyui: skipping malformed websocket message error=%s", e)
                    continue
                if msg.get("type") == "executing":
                    data = msg.get("data", {})
                    if data.get("prompt_id") == prompt_id and data.get("node") is None:
                        finished = True
                        break

            if not finished:
                raise TimeoutError("ComfyUI connection closed before generation finished")

        async with httpx.AsyncClient(timeout=30) as client:
            hr = await client.get(f"{root}/history/{prompt_id}")
            hr.raise_for_status()
            history = hr.json().get(prompt_id, {})
            status = history.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI generation failed: {status}")
            outputs = history.get("outputs", {})
            image_info = None
            for node_out in outputs.values():
                imgs = node_out.get("images") or []
                if imgs:
                    image_info = imgs[0]
                    break
            if not image_info:
                raise RuntimeError("ComfyUI finished but produced no image output")
            vr = await client.get(f"{root}/view", params={
                "filename": image_info["filename"],
                "subfolder": image_info.get("subfolder", ""),
                "type": image_info.get("type", "output"),
            })
            vr.raise_for_status()
            yield ("done", vr.content)


async def generate_video_stream(positive: str, negative: str, base_url: str,
                                unet_name: str, clip_name: str, vae_name: str,
                                fps: int = 16, num_frames: int = 33, width: int = 832, height: int = 480,
                                steps: int = 20, cfg: float = 6.0):
    """Wan2.1 text-to-video generation over ComfyUI's websocket/HTTP API.
    Yields ("status", str) phase/progress markers, then ("done", mp4_bytes)."""
    root = (base_url or "").rstrip("/")
    ws_scheme_root = root.replace("http://", "ws://").replace("https://", "wss://")
    workflow = _build_wan_video_workflow(positive, negative, unet_name, clip_name, vae_name,
                                         fps=fps, num_frames=num_frames,
                                         width=width, height=height, steps=steps, cfg=cfg)
    client_id = uuid.uuid4().hex
    log.info("comfyui: video submit client_id=%s frames=%s fps=%s", client_id, num_frames, fps)
    yield ("status", "submitted")

    async with websockets.connect(f"{ws_scheme_root}/ws?clientId={client_id}", max_size=None) as ws:
        async with httpx.AsyncClient(timeout=30) as client:
            prompt_id = await _submit_prompt(client, root, workflow, client_id)

            finished = False
            last_step_logged = -1
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    if len(raw) < 8:
                        continue
                    event_type = struct.unpack(">I", raw[:4])[0]
                    if event_type == _WS_PREVIEW_IMAGE:
                        yield ("preview", bytes(raw[8:]))
                    continue
                try:
                    msg = json.loads(raw)
                except Exception as e:
                    log.warning("comfyui: skipping malformed websocket message error=%s", e)
                    continue
                if msg.get("type") == "progress":
                    data = msg.get("data", {})
                    step, total = data.get("value"), data.get("max")
                    if step is not None and step != last_step_logged:
                        last_step_logged = step
                        log.info("comfyui: video sampling step=%s/%s prompt_id=%s", step, total, prompt_id)
                        yield ("status", f"sampling {step}/{total}")
                if msg.get("type") == "executing":
                    data = msg.get("data", {})
                    if data.get("prompt_id") == prompt_id and data.get("node") is None:
                        finished = True
                        break

            if not finished:
                raise TimeoutError("ComfyUI connection closed before video generation finished")

        yield ("status", "saving")
        async with httpx.AsyncClient(timeout=30) as client:
            hr = await client.get(f"{root}/history/{prompt_id}")
            hr.raise_for_status()
            history = hr.json().get(prompt_id, {})
            status = history.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI video generation failed: {status}")
            outputs = history.get("outputs", {})
            video_info = None
            for node_out in outputs.values():
                # SaveVideo's UI output reuses the "images" key from the
                # existing gallery convention (older AnimateDiff-style save
                # nodes used "gifs") — neither is video-specific, so both
                # must be checked or a successful run reports no output.
                vids = node_out.get("videos") or node_out.get("gifs") or node_out.get("images") or []
                if vids:
                    video_info = vids[0]
                    break
            if not video_info:
                raise RuntimeError("ComfyUI finished but produced no video output")
            vr = await client.get(f"{root}/view", params={
                "filename": video_info["filename"],
                "subfolder": video_info.get("subfolder", ""),
                "type": video_info.get("type", "output"),
            })
            vr.raise_for_status()
            log.info("comfyui: video done prompt_id=%s bytes=%s", prompt_id, len(vr.content))
            yield ("done", vr.content)
