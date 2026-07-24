import httpx

async def list_object_options(base_url: str, class_type: str, field: str) -> list[str]:
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

CHECKPOINT_NAME_BLACKLIST_EXACT = {"prefect_illustrous_sdxl.safetensors"}

async def list_checkpoints(base_url: str) -> list[str]:
    names = await list_object_options(base_url, "CheckpointLoaderSimple", "ckpt_name")
    return [n for n in names if n not in CHECKPOINT_NAME_BLACKLIST_EXACT]

async def list_anima_unets(base_url: str) -> list[str]:
    names = await list_object_options(base_url, "UNETLoader", "unet_name")
    return [n for n in names if not _is_wan_named(n)]

async def list_clip_models(base_url: str) -> list[str]:
    names = await list_object_options(base_url, "CLIPLoader", "clip_name")
    return [n for n in names if not _is_wan_named(n)]

async def list_vaes(base_url: str) -> list[str]:
    return await list_object_options(base_url, "VAELoader", "vae_name")

WAN_NAME_HINTS = ("wan", "umt5", "t5xxl", "t5-xxl")

def _is_wan_named(path: str) -> bool:
    name = path.rsplit("/", 1)[-1].lower()
    return any(hint in name for hint in WAN_NAME_HINTS)

async def list_wan_unets(base_url: str) -> list[str]:
    names = await list_object_options(base_url, "UNETLoader", "unet_name")
    return [n for n in names if _is_wan_named(n)]

async def list_wan_clip_models(base_url: str) -> list[str]:
    names = await list_object_options(base_url, "CLIPLoader", "clip_name")
    return [n for n in names if _is_wan_named(n)]

LORA_NAME_BLACKLIST_PREFIXES = ("anima",)

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
