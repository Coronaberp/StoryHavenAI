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

from backend.repositories import checkpoints as checkpoint_repo
from backend.state import log
from backend.imagegen_workflows import (  # noqa: F401
    DEFAULT_WORKFLOW, ANIMA_WORKFLOW,
    ANIMA_CLIP_NAME, ANIMA_VAE_NAME, ANIMA_DEFAULT_SAMPLER, ANIMA_DEFAULT_SCHEDULER, ANIMA_DEFAULT_CFG,
    _build_workflow, _build_anima_workflow, _build_upscale_workflow,
    _splice_loras, _splice_loras_anima, _splice_reference_image,
)
from backend.imagegen_options import (  # noqa: F401
    list_object_options, list_checkpoints, list_anima_unets, list_clip_models,
    list_vaes, list_loras, list_upscalers, list_samplers,
    CHECKPOINT_NAME_BLACKLIST_EXACT, LORA_NAME_BLACKLIST_PREFIXES, LORA_NAME_BLACKLIST_EXACT,
    _lora_blacklisted,
)

# ComfyUI's BinaryEventTypes.PREVIEW_IMAGE — the event-type tag on binary WS frames
# that carry a live in-progress denoising preview instead of JSON status.
_WS_PREVIEW_IMAGE = 1


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
    (needed to reference it from a LoadImage node in the workflow graph)."""
    root = (base_url or "").rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{root}/upload/image",
                              files={"image": (filename, image_bytes, "image/png")},
                              data={"overwrite": "true"})
        r.raise_for_status()
        return r.json()["name"]


async def generate_image(positive: str, negative: str, base_url: str, checkpoint: str,
                         custom_workflow: str | None = None,
                         loras: list[dict] | None = None,
                         reference_image: bytes | None = None, denoise: float = 0.6,
                         width: int = 1024, height: int = 1024,
                         sampler: str = "euler", scheduler: str = "normal",
                         steps: int = 20, architecture: str = "sdxl",
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
                                         scheduler=scheduler, steps=steps,
                                         reference_image_name=ref_name, denoise=denoise,
                                         clip_name=clip_name, vae_name=vae_name, loras=loras)
    else:
        ref_name = await upload_reference_image(root, reference_image) if reference_image else None
        workflow = _build_workflow(positive, negative, checkpoint, custom_workflow, loras,
                                   reference_image_name=ref_name, denoise=denoise,
                                   width=width, height=height, sampler=sampler, scheduler=scheduler,
                                   steps=steps)
    client_id = uuid.uuid4().hex

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{root}/prompt", json={"prompt": workflow, "client_id": client_id})
        r.raise_for_status()
        prompt_id = r.json()["prompt_id"]

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
        r = await client.post(f"{root}/prompt", json={"prompt": workflow, "client_id": client_id})
        r.raise_for_status()
        prompt_id = r.json()["prompt_id"]

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
            r = await client.post(f"{root}/prompt", json={"prompt": workflow, "client_id": client_id})
            r.raise_for_status()
            prompt_id = r.json()["prompt_id"]

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
    try:
        import websockets
    except ImportError:
        raise RuntimeError(
            "The 'websockets' package isn't installed — live preview streaming needs it "
            "(pip install websockets in the app's venv). Non-streaming generation still works.")
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
            r = await client.post(f"{root}/prompt", json={"prompt": workflow, "client_id": client_id})
            r.raise_for_status()
            prompt_id = r.json()["prompt_id"]

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
