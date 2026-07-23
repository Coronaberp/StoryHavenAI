"""ComfyUI workflow graph templates and builders — pure, no I/O.

Node-graph construction for both supported architectures (SDXL/Illustrious via
the default template or an admin-supplied custom workflow, and Anima) plus the
shared LoRA-chain/reference-image splicing helpers used by both.
"""
import json
import random

from backend.imagegen_options import CHECKPOINT_NAME_BLACKLIST_EXACT, _lora_blacklisted

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
        "inputs": {"filename_prefix": "storyhavenai", "images": ["8", 0]},
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
        "inputs": {"filename_prefix": "storyhavenai", "images": ["8", 0]},
    },
}


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


def _build_inpaint_workflow(positive: str, negative: str, checkpoint: str,
                            image_name: str, mask_name: str, denoise: float = 1.0,
                            sampler: str = "euler", scheduler: str = "normal",
                            steps: int = 20, cfg: float = 7.0) -> dict:
    if checkpoint in CHECKPOINT_NAME_BLACKLIST_EXACT:
        raise ValueError(f"Checkpoint '{checkpoint}' is not available for generation")
    seed = random.randint(0, 2**32 - 1)
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "2": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "3": {"class_type": "LoadImageMask", "inputs": {"image": mask_name, "channel": "red"}},
        "4": {"class_type": "VAEEncodeForInpaint",
              "inputs": {"pixels": ["2", 0], "mask": ["3", 0], "vae": ["1", 2], "grow_mask_by": 6}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["1", 1]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["1", 1]}},
        "7": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler,
            "scheduler": scheduler, "denoise": denoise,
            "model": ["1", 0], "positive": ["5", 0], "negative": ["6", 0],
            "latent_image": ["4", 0],
        }},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["1", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "storyhavenai_inpaint", "images": ["8", 0]}},
    }


def _build_anima_inpaint_workflow(positive: str, negative: str, unet_name: str,
                                  image_name: str, mask_name: str, denoise: float = 1.0,
                                  sampler: str = ANIMA_DEFAULT_SAMPLER, scheduler: str = ANIMA_DEFAULT_SCHEDULER,
                                  steps: int = 30, cfg: float = ANIMA_DEFAULT_CFG,
                                  clip_name: str | None = None, vae_name: str | None = None) -> dict:
    """Anima equivalent of _build_inpaint_workflow — same UNETLoader/CLIPLoader/
    VAELoader graph as _build_anima_workflow, with VAEEncodeForInpaint (fed by
    the standalone VAELoader's single output, slot 0) replacing EmptyLatentImage
    as the KSampler's latent source. This didn't exist before — an Anima
    checkpoint picked on the Masks/Inpaint page previously reached ComfyUI as a
    CheckpointLoaderSimple ckpt_name, which ComfyUI rejects outright since an
    Anima UNET-only file was never a valid checkpoint value in the first place."""
    seed = random.randint(0, 2**32 - 1)
    return {
        "44": {"class_type": "UNETLoader", "inputs": {"unet_name": unet_name, "weight_dtype": "default"}},
        "45": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": clip_name or ANIMA_CLIP_NAME, "type": "qwen_image"}},
        "15": {"class_type": "VAELoader", "inputs": {"vae_name": vae_name or ANIMA_VAE_NAME}},
        "2": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "3": {"class_type": "LoadImageMask", "inputs": {"image": mask_name, "channel": "red"}},
        "4": {"class_type": "VAEEncodeForInpaint",
              "inputs": {"pixels": ["2", 0], "mask": ["3", 0], "vae": ["15", 0], "grow_mask_by": 6}},
        "11": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["45", 0]}},
        "12": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["45", 0]}},
        "19": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler,
            "scheduler": scheduler, "denoise": denoise,
            "model": ["44", 0], "positive": ["11", 0], "negative": ["12", 0],
            "latent_image": ["4", 0],
        }},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["19", 0], "vae": ["15", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "storyhavenai_inpaint", "images": ["8", 0]}},
    }


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


def _build_upscale_workflow(image_name: str, upscaler_name: str) -> dict:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": upscaler_name}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "SaveImage", "inputs": {"filename_prefix": "storyhavenai_upscale", "images": ["3", 0]}},
    }


def _build_wan_video_workflow(positive: str, negative: str, unet_name: str, clip_name: str,
                              vae_name: str, fps: int = 16, num_frames: int = 33,
                              width: int = 832, height: int = 480,
                              steps: int = 20, cfg: float = 6.0) -> dict:
    seed = random.randint(0, 2**32 - 1)
    wf = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet_name, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": clip_name, "type": "wan"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": vae_name}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["2", 0]}},
        "7": {"class_type": "EmptyHunyuanLatentVideo", "inputs": {
            "width": width, "height": height, "length": num_frames, "batch_size": 1}},
    }
    positive_out, negative_out, latent_out = ["4", 0], ["5", 0], ["7", 0]
    wf["8"] = {"class_type": "KSampler", "inputs": {
        "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler",
        "scheduler": "simple", "denoise": 1.0,
        "model": ["1", 0], "positive": positive_out, "negative": negative_out,
        "latent_image": latent_out,
    }}
    wf["9"] = {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}}
    wf["10"] = {"class_type": "CreateVideo", "inputs": {"images": ["9", 0], "fps": fps}}
    wf["11"] = {"class_type": "SaveVideo", "inputs": {
        "video": ["10", 0], "filename_prefix": "storyhavenai_video",
        "format": "mp4", "codec": "h264"}}
    return wf
