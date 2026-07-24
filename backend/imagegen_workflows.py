import json
import random

from backend.imagegen_options import CHECKPOINT_NAME_BLACKLIST_EXACT, _lora_blacklisted

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

    for lo in (loras or []):
        name = lo.get("name") if isinstance(lo, dict) else None
        if name and _lora_blacklisted(name):
            raise ValueError(f"LoRA '{name}' is not available for generation")
    if checkpoint in CHECKPOINT_NAME_BLACKLIST_EXACT:
        raise ValueError(f"Checkpoint '{checkpoint}' is not available for generation")

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

            encoders = [n for n in wf.values() if n.get("class_type") == "CLIPTextEncode"]
            if not pos_found and len(encoders) >= 1:
                encoders[0]["inputs"]["text"] = positive
            if not neg_found and len(encoders) >= 2:
                encoders[1]["inputs"]["text"] = negative
        if reference_image_name:
            _splice_reference_image(wf, reference_image_name, denoise)
        return wf
    wf = json.loads(json.dumps(DEFAULT_WORKFLOW))
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
    if model_src != ["4", 0]:
        wf["3"]["inputs"]["model"] = model_src
        wf["6"]["inputs"]["clip"] = clip_src
        wf["7"]["inputs"]["clip"] = clip_src

def _splice_reference_image(wf: dict, image_name: str, denoise: float):
    ksamplers = [n for n in wf.values() if n.get("class_type") == "KSampler"]
    if not ksamplers:
        return
    ks = ksamplers[0]

    vae_source = None
    for node in wf.values():
        if node.get("class_type") in ("CheckpointLoaderSimple", "CheckpointLoader"):
            vae_source = [next(k for k, v in wf.items() if v is node), 2]
            break
        if node.get("class_type") == "VAELoader":
            vae_source = [next(k for k, v in wf.items() if v is node), 0]
            break
    if vae_source is None:
        return
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
    if model_src != ["44", 0]:
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
    wf = json.loads(json.dumps(ANIMA_WORKFLOW))
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
