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

from backend import db

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
        "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
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


# Anima is a second, unrelated base-model architecture (ComfyUI has a native
# comfy/ldm/anima module for it) alongside the SDXL/Illustrious-family
# checkpoints this app otherwise assumes everywhere. It loads via UNETLoader
# from models/diffusion_models (not CheckpointLoaderSimple from
# models/checkpoints), pairs with its own dedicated CLIP text encoder and VAE
# rather than bundling them into one checkpoint file, and — per ComfyUI's own
# bundled "Text to Image (Anima)" reference blueprint — is tuned for the
# er_sde sampler / simple scheduler / cfg 4, none of which match the SDXL
# defaults used elsewhere in this file. LoRAs and the reference-image (img2img)
# path aren't wired up for it yet — same incompatibility class as a Flux LoRA
# on an SDXL checkpoint, so an anima-blacklisted LoRA is exactly the failure
# this avoids repeating in the other direction.
ANIMA_CLIP_NAME = "qwen_3_06b_base.safetensors"
ANIMA_VAE_NAME = "qwen_image_vae.safetensors"
ANIMA_DEFAULT_SAMPLER = "er_sde"
ANIMA_DEFAULT_SCHEDULER = "simple"
ANIMA_DEFAULT_CFG = 4.0

ANIMA_WORKFLOW = {
    "44": {
        "class_type": "UNETLoader",
        "inputs": {"unet_name": "__UNET__", "weight_dtype": "default"},
    },
    "45": {
        "class_type": "CLIPLoader",
        # "qwen_image" — not "stable_diffusion" — is the correct CLIPLoader
        # type for this whole Anima setup: the shared VAE/encoder pair
        # (qwen_image_vae.safetensors / qwen_3_06b_base.safetensors) are
        # Qwen-Image architecture under the hood. "stable_diffusion" silently
        # produced NaN tensors (garbage/blank output) for at least one real
        # Anima checkpoint+encoder combo; verified directly against ComfyUI
        # that "qwen_image" fixes that case and still succeeds cleanly for
        # the original animayume.safetensors + qwen_3_06b_base.safetensors
        # pair too, so this is a strict correctness fix, not a behavior change
        # for any currently-working checkpoint.
        "inputs": {"clip_name": ANIMA_CLIP_NAME, "type": "qwen_image"},
    },
    "15": {
        "class_type": "VAELoader",
        "inputs": {"vae_name": ANIMA_VAE_NAME},
    },
    "11": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "__PROMPT__", "clip": ["45", 0]},
    },
    "12": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "__NEGATIVE__", "clip": ["45", 0]},
    },
    "28": {
        "class_type": "EmptyLatentImage",
        "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
    },
    "19": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 0, "steps": 30, "cfg": ANIMA_DEFAULT_CFG,
            "sampler_name": ANIMA_DEFAULT_SAMPLER, "scheduler": ANIMA_DEFAULT_SCHEDULER,
            "denoise": 1.0, "model": ["44", 0], "positive": ["11", 0], "negative": ["12", 0],
            "latent_image": ["28", 0],
        },
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["19", 0], "vae": ["15", 0]},
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
    installed, instead of a hardcoded list going stale.

    A combo field's spec is [options_or_type, metadata_dict], but which of
    those two shapes it is depends on the node: most nodes (CheckpointLoaderSimple,
    LoraLoader, KSampler, ...) still report the options list directly at index
    0 — e.g. ckpt_name: [["a.safetensors", "b.safetensors"], {"tooltip": ...}].
    Nodes ComfyUI has migrated to its newer V3 node-definition schema (seen so
    far: UpscaleModelLoader) instead report the literal string "COMBO" at
    index 0, with the actual options list moved into metadata_dict["options"]
    — e.g. model_name: ["COMBO", {"multiselect": false, "options": [...]}].
    Handling both here (rather than special-casing list_upscalers) means any
    other node ComfyUI migrates the same way later keeps working too."""
    root = (base_url or "").rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{root}/object_info/{class_type}")
        r.raise_for_status()
        info = r.json()[class_type]
        spec = info["input"]["required"][field]
        if isinstance(spec[0], list):
            return spec[0]
        if len(spec) > 1 and isinstance(spec[1], dict) and isinstance(spec[1].get("options"), list):
            return spec[1]["options"]
        return []


# Checkpoints hidden from every picker by admin request — kept on disk (unlike
# the LoRA blacklist, this isn't about incompatibility, just an unwanted
# option) so re-checking the filesystem isn't needed to un-hide one later.
CHECKPOINT_NAME_BLACKLIST_EXACT = {"prefect_illustrous_sdxl.safetensors"}


async def list_checkpoints(base_url: str) -> list[str]:
    names = await list_object_options(base_url, "CheckpointLoaderSimple", "ckpt_name")
    return [n for n in names if n not in CHECKPOINT_NAME_BLACKLIST_EXACT]


async def list_anima_unets(base_url: str) -> list[str]:
    return await list_object_options(base_url, "UNETLoader", "unet_name")


async def list_clip_models(base_url: str) -> list[str]:
    return await list_object_options(base_url, "CLIPLoader", "clip_name")


async def list_vaes(base_url: str) -> list[str]:
    return await list_object_options(base_url, "VAELoader", "vae_name")



# LoRAs whose filename starts with any of these prefixes are trained for a
# different base-model architecture than what's installed here (same
# incompatibility class as a Flux LoRA on an SDXL checkpoint) — they're
# filtered out of every picker rather than left to fail or misbehave at
# generation time. Matched case-insensitively against the bare filename.
LORA_NAME_BLACKLIST_PREFIXES = ("anima",)

# Exact filenames blocked regardless of prefix — e.g. a LoRA whose name merely
# contains "anima" rather than starting with it (so it doesn't match the
# prefix rule above) but has a corrupted/incompatible safetensors file on
# disk: loading it throws a JSONDecodeError deep in ComfyUI's own metadata
# parser, crashing the whole generation instead of just failing to filter it.
LORA_NAME_BLACKLIST_EXACT = {"cute_niji_anime_style_anima.safetensors"}


def _lora_blacklisted(name: str) -> bool:
    n = (name or "").lower()
    return n.startswith(LORA_NAME_BLACKLIST_PREFIXES) or name in LORA_NAME_BLACKLIST_EXACT


async def list_loras(base_url: str) -> list[str]:
    names = await list_object_options(base_url, "LoraLoader", "lora_name")
    return [n for n in names if not _lora_blacklisted(n)]


async def list_upscalers(base_url: str) -> list[str]:
    return await list_object_options(base_url, "UpscaleModelLoader", "model_name")


async def list_samplers(base_url: str) -> dict:
    samplers = await list_object_options(base_url, "KSampler", "sampler_name")
    schedulers = await list_object_options(base_url, "KSampler", "scheduler")
    return {"samplers": samplers, "schedulers": schedulers}


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


def _build_workflow(positive: str, negative: str, checkpoint: str, custom_workflow: str | None,
                    loras: list[dict] | None = None,
                    reference_image_name: str | None = None, denoise: float = 0.6,
                    width: int = 1024, height: int = 1024,
                    sampler: str = "euler", scheduler: str = "normal",
                    steps: int = 20, cfg: float = 7.0) -> dict:
    # Re-check the blacklist here too, not just in list_loras() — a stale
    # client-side selection (picked before a name was blacklisted, or simply
    # never refetched) would otherwise still reach ComfyUI and crash deep in
    # its own safetensors metadata parser instead of failing with a clear
    # message at the API boundary.
    for lo in (loras or []):
        name = lo.get("name") if isinstance(lo, dict) else None
        if name and _lora_blacklisted(name):
            raise ValueError(f"LoRA '{name}' is not available for generation")
    if checkpoint in CHECKPOINT_NAME_BLACKLIST_EXACT:
        raise ValueError(f"Checkpoint '{checkpoint}' is not available for generation")
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
        if reference_image_name:
            _splice_reference_image(wf, reference_image_name, denoise)
        return wf
    wf = json.loads(json.dumps(DEFAULT_WORKFLOW))  # deep copy
    wf["3"]["inputs"]["seed"] = seed
    wf["6"]["inputs"]["text"] = positive
    wf["7"]["inputs"]["text"] = negative
    wf["4"]["inputs"]["ckpt_name"] = checkpoint
    wf["3"]["inputs"]["sampler_name"] = sampler
    wf["3"]["inputs"]["scheduler"] = scheduler
    wf["3"]["inputs"]["steps"] = steps
    wf["3"]["inputs"]["cfg"] = cfg
    wf["5"]["inputs"]["width"] = width
    wf["5"]["inputs"]["height"] = height
    if loras:
        _splice_loras(wf, loras)
    if reference_image_name:
        _splice_reference_image(wf, reference_image_name, denoise)
    return wf


def _splice_loras(wf: dict, loras: list[dict]):
    """Chains multiple LoraLoader nodes between the checkpoint and everything
    that consumes its model/clip outputs (KSampler + both CLIPTextEncodes) —
    each LoRA in the list stacks on top of the previous one's output, the same
    way ComfyUI's own UI chains multiple LoraLoader nodes visually. Only
    applies to the built-in default workflow (the only shape simple enough to
    splice generically); a custom admin-supplied workflow is left as-is."""
    model_src, clip_src = ["4", 0], ["4", 1]
    next_id = max((int(k) for k in wf if k.isdigit()), default=0) + 1
    for entry in loras:
        name = (entry.get("name") or "").strip()
        if not name:
            continue
        strength = entry.get("strength", 0.8)
        node_id = str(next_id); next_id += 1
        wf[node_id] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": name, "strength_model": strength, "strength_clip": strength,
                "model": model_src, "clip": clip_src,
            },
        }
        model_src, clip_src = [node_id, 0], [node_id, 1]
    if model_src != ["4", 0]:  # at least one LoRA actually got spliced in
        wf["3"]["inputs"]["model"] = model_src
        wf["6"]["inputs"]["clip"] = clip_src
        wf["7"]["inputs"]["clip"] = clip_src


def _splice_reference_image(wf: dict, image_name: str, denoise: float):
    """img2img: replace whatever feeds KSampler's latent_image with a LoadImage
    -> VAEEncode of the reference, and lower denoise so the output stays
    visually anchored to it instead of starting from pure noise. Finds the
    KSampler and its VAE source generically so this works on both the default
    template and an admin-supplied custom workflow, not just one graph shape."""
    ksamplers = [n for n in wf.values() if n.get("class_type") == "KSampler"]
    if not ksamplers:
        return
    ks = ksamplers[0]
    # Find a VAE source to reuse — a bundled checkpoint exposes one on output
    # slot 2; Anima (and anything else with a standalone VAELoader, since its
    # only output IS the VAE) exposes it on slot 0.
    vae_source = None
    for node in wf.values():
        if node.get("class_type") in ("CheckpointLoaderSimple", "CheckpointLoader"):
            vae_source = [next(k for k, v in wf.items() if v is node), 2]
            break
        if node.get("class_type") == "VAELoader":
            vae_source = [next(k for k, v in wf.items() if v is node), 0]
            break
    if vae_source is None:
        return  # no VAE to encode with — leave txt2img as-is rather than build a broken graph
    new_ids = {int(k) for k in wf if k.isdigit()}
    load_id = str(max(new_ids, default=0) + 1)
    encode_id = str(int(load_id) + 1)
    wf[load_id] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
    wf[encode_id] = {"class_type": "VAEEncode", "inputs": {"pixels": [load_id, 0], "vae": vae_source}}
    ks["inputs"]["latent_image"] = [encode_id, 0]
    ks["inputs"]["denoise"] = denoise


def _splice_loras_anima(wf: dict, loras: list[dict]):
    """Same chaining approach as _splice_loras (each LoRA stacks on the
    previous one's output, same as ComfyUI's own UI), adapted for Anima's
    graph shape: the model source is UNETLoader (node 44, a single MODEL
    output) and the clip source is a separate CLIPLoader (node 45, a single
    CLIP output) rather than one CheckpointLoaderSimple bundling both —
    LoraLoader doesn't care where its model/clip inputs came from, so the
    same node works here as on the SDXL path."""
    model_src, clip_src = ["44", 0], ["45", 0]
    next_id = max((int(k) for k in wf if k.isdigit()), default=0) + 1
    for entry in loras:
        name = (entry.get("name") or "").strip()
        if not name:
            continue
        strength = entry.get("strength", 0.8)
        node_id = str(next_id); next_id += 1
        wf[node_id] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": name, "strength_model": strength, "strength_clip": strength,
                "model": model_src, "clip": clip_src,
            },
        }
        model_src, clip_src = [node_id, 0], [node_id, 1]
    if model_src != ["44", 0]:  # at least one LoRA actually got spliced in
        wf["19"]["inputs"]["model"] = model_src
        wf["11"]["inputs"]["clip"] = clip_src
        wf["12"]["inputs"]["clip"] = clip_src


def _build_anima_workflow(positive: str, negative: str, unet_name: str,
                          width: int = 1024, height: int = 1024,
                          sampler: str = ANIMA_DEFAULT_SAMPLER, scheduler: str = ANIMA_DEFAULT_SCHEDULER,
                          steps: int = 30, cfg: float = ANIMA_DEFAULT_CFG,
                          reference_image_name: str | None = None, denoise: float = 0.6,
                          clip_name: str | None = None, vae_name: str | None = None,
                          loras: list[dict] | None = None) -> dict:
    """Anima's graph (UNETLoader + its own CLIP/VAE) — see the ANIMA_WORKFLOW
    comment for why this can't share _build_workflow's SDXL-shaped template.
    LoRA support via _splice_loras_anima (fixed — this used to be rejected
    before reaching here). reference_image_name switches this to img2img
    via the same _splice_reference_image used for the SDXL path (it already
    recognizes a standalone VAELoader, which is what Anima uses).
    clip_name/vae_name let a caller override the per-checkpoint text-encoder
    and VAE (different Anima checkpoints can require different ones); left
    unset, this falls back to the shared ANIMA_CLIP_NAME/ANIMA_VAE_NAME pair."""
    wf = json.loads(json.dumps(ANIMA_WORKFLOW))  # deep copy
    wf["19"]["inputs"]["seed"] = random.randint(0, 2**32 - 1)
    wf["11"]["inputs"]["text"] = positive
    wf["12"]["inputs"]["text"] = negative
    wf["44"]["inputs"]["unet_name"] = unet_name
    wf["45"]["inputs"]["clip_name"] = clip_name or ANIMA_CLIP_NAME
    wf["15"]["inputs"]["vae_name"] = vae_name or ANIMA_VAE_NAME
    wf["19"]["inputs"]["sampler_name"] = sampler
    wf["19"]["inputs"]["scheduler"] = scheduler
    wf["19"]["inputs"]["steps"] = steps
    wf["19"]["inputs"]["cfg"] = cfg
    wf["28"]["inputs"]["width"] = width
    wf["28"]["inputs"]["height"] = height
    if loras:
        _splice_loras_anima(wf, loras)
    if reference_image_name:
        _splice_reference_image(wf, reference_image_name, denoise)
    return wf


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
        clip_name, vae_name = await db.get_checkpoint_anima_overrides(checkpoint)
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


def _build_upscale_workflow(image_name: str, upscaler_name: str) -> dict:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": upscaler_name}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "SaveImage", "inputs": {"filename_prefix": "personae_upscale", "images": ["3", 0]}},
    }


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
        clip_name, vae_name = await db.get_checkpoint_anima_overrides(checkpoint)
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
