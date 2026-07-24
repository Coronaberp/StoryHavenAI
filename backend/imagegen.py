import asyncio
import json
import struct
import uuid

import httpx
import websockets

from backend.repositories import checkpoints as checkpoint_repo
from backend.state import log
from backend.imagegen_workflows import (
    DEFAULT_WORKFLOW, ANIMA_WORKFLOW,
    ANIMA_CLIP_NAME, ANIMA_VAE_NAME, ANIMA_DEFAULT_SAMPLER, ANIMA_DEFAULT_SCHEDULER, ANIMA_DEFAULT_CFG,
    _build_workflow, _build_anima_workflow, _build_upscale_workflow, _build_inpaint_workflow,
    _build_anima_inpaint_workflow, _build_wan_video_workflow,
    _splice_loras, _splice_loras_anima, _splice_reference_image,
)
from backend.imagegen_options import (
    list_object_options, list_checkpoints, list_anima_unets, list_clip_models,
    list_vaes, list_loras, list_upscalers, list_samplers,
    list_wan_unets, list_wan_clip_models,
    CHECKPOINT_NAME_BLACKLIST_EXACT, LORA_NAME_BLACKLIST_PREFIXES, LORA_NAME_BLACKLIST_EXACT,
    _lora_blacklisted,
)

_WS_PREVIEW_IMAGE = 1

async def _submit_prompt(client: httpx.AsyncClient, root: str, workflow: dict, client_id: str) -> str:
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
    root = (base_url or "").rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{root}/interrupt")
        r.raise_for_status()

async def upload_reference_image(base_url: str, image_bytes: bytes, filename: str = "reference.png") -> str:
    root = (base_url or "").rstrip("/")
    unique_filename = f"{uuid.uuid4().hex[:12]}_{filename}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{root}/upload/image",
                              files={"image": (unique_filename, image_bytes, "image/png")},
                              data={"overwrite": "true"})
        r.raise_for_status()
        return r.json()["name"]

async def upload_mask_image(base_url: str, mask_bytes: bytes, filename: str = "mask.png") -> str:
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
