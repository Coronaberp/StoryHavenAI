"""ComfyUI client: submit a txt2img workflow, poll for completion, fetch the image.

Mirrors llm.py's plain-httpx client style. ComfyUI's REST API is workflow-graph
based (nodes keyed by string id) rather than a simple text-to-image endpoint, so
callers pass a prompt string and this module fills it into either the built-in
default workflow template or an admin-supplied custom workflow (exported from
the ComfyUI UI via "Save (API Format)").
"""
import asyncio
import json
import random
import struct
import uuid

import httpx

# ComfyUI's BinaryEventTypes.PREVIEW_IMAGE — the event-type tag on binary WS frames
# that carry a live in-progress denoising preview instead of JSON status.
_WS_PREVIEW_IMAGE = 1

# Built-in default: a standard SD1.5-style txt2img graph. Node ids match what
# ComfyUI's own "Save (API Format)" export produces for the default workflow.
DEFAULT_WORKFLOW = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 0, "steps": 20, "cfg": 7.0, "sampler_name": "euler",
            "scheduler": "normal", "denoise": 1.0,
            "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
    },
    "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "__CHECKPOINT__"},
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {"width": 512, "height": 768, "batch_size": 1},
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "__PROMPT__", "clip": ["4", 1]},
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "__NEGATIVE__", "clip": ["4", 1]},
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": "personae", "images": ["8", 0]},
    },
}


async def list_object_options(base_url: str, class_type: str, field: str) -> list[str]:
    """Query ComfyUI's /object_info for the live list of values a node's combo
    widget accepts — e.g. every checkpoint or LoRA file ComfyUI can see on disk.
    This is how the model/LoRA picker stays in sync with whatever's actually
    installed, instead of a hardcoded list going stale."""
    root = (base_url or "").rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{root}/object_info/{class_type}")
        r.raise_for_status()
        info = r.json()[class_type]
        return info["input"]["required"][field][0]


async def list_checkpoints(base_url: str) -> list[str]:
    return await list_object_options(base_url, "CheckpointLoaderSimple", "ckpt_name")


async def list_loras(base_url: str) -> list[str]:
    return await list_object_options(base_url, "LoraLoader", "lora_name")


def _build_workflow(positive: str, negative: str, checkpoint: str, custom_workflow: str | None,
                    lora: str | None = None, lora_strength: float = 0.8) -> dict:
    # A fixed seed (this template's original default) means every generation with the
    # same prompt/checkpoint is bit-for-bit deterministic — worse, ComfyUI treats
    # unchanged inputs as a cache hit and returns the exact same file without even
    # re-sampling, which is exactly what made "regenerate" look broken.
    seed = random.randint(0, 2**32 - 1)
    if custom_workflow and custom_workflow.strip():
        wf = json.loads(custom_workflow)
        pos_found = neg_found = False
        for node in wf.values():
            if node.get("class_type") == "KSampler" and "seed" in node.get("inputs", {}):
                node["inputs"]["seed"] = seed
            if node.get("class_type") != "CLIPTextEncode":
                continue
            text = json.dumps(node.get("inputs", {}))
            if "__PROMPT__" in text:
                node["inputs"]["text"] = positive
                pos_found = True
            elif "__NEGATIVE__" in text:
                node["inputs"]["text"] = negative
                neg_found = True
        if not pos_found or not neg_found:
            # No __PROMPT__/__NEGATIVE__ markers — best-effort: first CLIPTextEncode
            # found is positive, second is negative.
            encoders = [n for n in wf.values() if n.get("class_type") == "CLIPTextEncode"]
            if not pos_found and len(encoders) >= 1:
                encoders[0]["inputs"]["text"] = positive
            if not neg_found and len(encoders) >= 2:
                encoders[1]["inputs"]["text"] = negative
        return wf
    wf = json.loads(json.dumps(DEFAULT_WORKFLOW))  # deep copy
    wf["3"]["inputs"]["seed"] = seed
    wf["6"]["inputs"]["text"] = positive
    wf["7"]["inputs"]["text"] = negative
    wf["4"]["inputs"]["ckpt_name"] = checkpoint
    if lora:
        # Splice a LoraLoader between the checkpoint and everything that
        # consumes its model/clip outputs (KSampler's model, both CLIPTextEncodes).
        wf["10"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": lora, "strength_model": lora_strength, "strength_clip": lora_strength,
                "model": ["4", 0], "clip": ["4", 1],
            },
        }
        wf["3"]["inputs"]["model"] = ["10", 0]
        wf["6"]["inputs"]["clip"] = ["10", 1]
        wf["7"]["inputs"]["clip"] = ["10", 1]
    return wf


async def generate_image(positive: str, negative: str, base_url: str, checkpoint: str,
                         custom_workflow: str | None = None,
                         lora: str | None = None, lora_strength: float = 0.8,
                         timeout_s: float = 120.0) -> bytes:
    """Submit prompt to ComfyUI, poll until done, return the resulting image bytes."""
    root = (base_url or "").rstrip("/")
    workflow = _build_workflow(positive, negative, checkpoint, custom_workflow, lora, lora_strength)
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


async def generate_image_stream(positive: str, negative: str, base_url: str, checkpoint: str,
                                lora: str | None = None, lora_strength: float = 0.8,
                                timeout_s: float = 120.0):
    """Like generate_image, but a live generator for the standalone image-gen page:
    connects to ComfyUI's websocket *before* submitting the prompt so no preview
    frames are missed, and yields ("preview", jpeg_bytes) as each denoising step's
    in-progress preview arrives, then ("done", png_bytes) once the final image is
    ready. Nothing is written to disk here — the caller decides whether to keep it."""
    try:
        import websockets
    except ImportError:
        raise RuntimeError(
            "The 'websockets' package isn't installed — live preview streaming needs it "
            "(pip install websockets in the app's venv). Non-streaming generation still works.")
    root = (base_url or "").rstrip("/")
    ws_scheme_root = root.replace("http://", "ws://").replace("https://", "wss://")
    workflow = _build_workflow(positive, negative, checkpoint, None, lora, lora_strength)
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
                except Exception:
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
