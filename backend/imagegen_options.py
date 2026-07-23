"""ComfyUI option listing — checkpoints/LoRAs/samplers/schedulers/upscalers/
VAEs/Anima UNets/CLIP models, queried live from ComfyUI's /object_info so the
picker UI stays in sync with whatever's actually installed rather than a
hardcoded list going stale. There is no local model registry; ComfyUI is the
source of truth.
"""
import httpx


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
    names = await list_object_options(base_url, "UNETLoader", "unet_name")
    return [n for n in names if not _is_wan_named(n)]


async def list_clip_models(base_url: str) -> list[str]:
    names = await list_object_options(base_url, "CLIPLoader", "clip_name")
    return [n for n in names if not _is_wan_named(n)]


async def list_vaes(base_url: str) -> list[str]:
    return await list_object_options(base_url, "VAELoader", "vae_name")


# Wan and Anima both load through the same generic UNETLoader/CLIPLoader
# nodes, so ComfyUI's /object_info reports every file from both architectures
# in one shared list — without filtering, an Anima checkpoint/CLIP file shows
# up under "Vidgen" (and vice versa) with nothing distinguishing them. Matched
# case-insensitively against the bare filename, same heuristic already used by
# LORA_NAME_BLACKLIST_PREFIXES below for the equivalent Anima/SDXL LoRA mixup.
# "umt5"/"t5xxl"/"t5-xxl" are needed alongside "wan" itself because ComfyUI's
# own repackaged Wan text encoder (Comfy-Org/Wan_2.1_ComfyUI_repackaged) is
# named "umt5_xxl_fp8_e4m3fn_scaled.safetensors" — no "wan" substring at all —
# so a "wan"-only filter would hide the exact file this app recommends using.
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
