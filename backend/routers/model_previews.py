"""Model-metadata administration: read-only ComfyUI option listings plus
admin-curated preview images/descriptions for checkpoints, LoRAs, samplers,
schedulers, and upscalers. Distinct from imagegen.py, which actually drives
ComfyUI generation."""
import os
import time
import hashlib

from fastapi import HTTPException, Depends, UploadFile, File

from backend.repositories import checkpoints, loras, samplers, schedulers, upscalers
from backend import imagegen
from backend.state import api, CFG, IMG_EXTS, log, CHECKPOINTS_DIR, LORA_OUTPUT_DIR, UPSCALE_MODELS_DIR
from backend.auth import get_current_user, get_admin
from backend.media import _delete_media_file, _save_uploaded_image
from backend.schemas import ModelMetaIn, LoraPublishIn


@api.get("/imagegen/checkpoints")
async def get_imagegen_checkpoints(current_user: dict = Depends(get_current_user)):
    try:
        return await imagegen.list_checkpoints(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/anima-unets")
async def get_imagegen_anima_unets(current_user: dict = Depends(get_current_user)):
    """Anima is a second, unrelated architecture (see imagegen.ANIMA_WORKFLOW) —
    its models live in ComfyUI's UNETLoader list, not CheckpointLoaderSimple's,
    so they need their own listing endpoint rather than being merged into
    /imagegen/checkpoints and silently sent through the wrong graph."""
    try:
        return await imagegen.list_anima_unets(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/clip-models")
async def get_imagegen_clip_models(current_user: dict = Depends(get_current_user)):
    """CLIP text-encoder files ComfyUI can see — used to populate the
    per-checkpoint Anima CLIP override picker in the admin meta editor."""
    try:
        return await imagegen.list_clip_models(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/vaes")
async def get_imagegen_vaes(current_user: dict = Depends(get_current_user)):
    """VAE files ComfyUI can see — used to populate the per-checkpoint Anima
    VAE override picker in the admin meta editor."""
    try:
        return await imagegen.list_vaes(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/checkpoint-previews")
async def get_checkpoint_previews(current_user: dict = Depends(get_current_user)):
    """{checkpoint_name: {image, display_name, description}} — admin-curated
    metadata used by the Images page model grid in place of the raw filename
    and the letter-avatar fallback."""
    return await checkpoints.list_previews()


def _preview_basename(prefix: str, name: str) -> str:
    return f"{prefix}_" + hashlib.sha1(name.encode("utf-8")).hexdigest()[:16]


async def _set_preview_image(name: str, file: UploadFile, prefix: str,
                             get_old, set_new) -> str:
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in IMG_EXTS:
        ext = ".png"
    data = await file.read()
    basename = _preview_basename(prefix, name)
    old = await get_old(name)
    ext = await _save_uploaded_image(data, basename, ext, allow_animated=False)
    url = f"/media/{basename}{ext}"
    if old and old.split("?")[0] != url:
        _delete_media_file(old.split("?")[0])
    url = f"{url}?v={int(time.time())}"
    await set_new(name, url)
    return url


# The /meta routes must be registered before the {name:path} upload/delete
# routes below — {name:path} is greedy and would otherwise swallow the
# "/meta" suffix as part of the checkpoint name, since Starlette matches
# route patterns in registration order.
MODEL_CATEGORIES = ("flux_v2", "anima", "sdxl", "il", "pony")


@api.put("/admin/checkpoint-previews/{name:path}/meta")
async def set_checkpoint_meta_route(name: str, body: ModelMetaIn,
                                    current_user: dict = Depends(get_admin)):
    # model_category is LoRA-only now (see set_lora_meta_route below) —
    # checkpoints classify architecture via the free-text Type field only.
    await checkpoints.set_meta(name, body.display_name, body.description, body.model_type,
                                   body.default_steps, body.anima_clip_name, body.anima_vae_name)
    log.info("admin: checkpoint meta set by=%s checkpoint=%s", current_user["username"], name)
    return {"checkpoint_name": name, "display_name": body.display_name,
            "description": body.description, "model_type": body.model_type,
            "anima_clip_name": body.anima_clip_name, "anima_vae_name": body.anima_vae_name}


@api.put("/admin/checkpoint-previews/{name:path}")
async def set_checkpoint_preview(name: str, file: UploadFile = File(...),
                                 current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "ckptprev",
                                   checkpoints.get_preview, checkpoints.set_preview)
    log.info("admin: checkpoint preview set by=%s checkpoint=%s", current_user["username"], name)
    return {"checkpoint_name": name, "image": url}


@api.delete("/admin/checkpoint-previews/{name:path}")
async def clear_checkpoint_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await checkpoints.get_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await checkpoints.delete_preview(name)
    log.info("admin: checkpoint preview cleared by=%s checkpoint=%s", current_user["username"], name)
    return {"cleared": True}


@api.get("/imagegen/loras")
async def get_imagegen_loras(current_user: dict = Depends(get_current_user)):
    try:
        names = await imagegen.list_loras(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")
    if current_user.get("is_admin"):
        return names
    # LoRAs this app itself trained stay hidden from regular users until an
    # admin explicitly publishes them (see loras.gate_visibility) — a name
    # with no row in lora_visibility (every pre-existing LoRA) is unaffected.
    hidden = await loras.list_unpublished_names()
    return [n for n in names if n not in hidden]


@api.get("/imagegen/samplers")
async def get_imagegen_samplers(current_user: dict = Depends(get_current_user)):
    try:
        return await imagegen.list_samplers(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/lora-previews")
async def get_lora_previews(current_user: dict = Depends(get_current_user)):
    """{lora_name: {image, display_name, description}} — same shape and purpose
    as /imagegen/checkpoint-previews, for LoRAs. Admins additionally get an
    is_published bool on gated (self-trained, unpublished) entries so the
    Model previews panel can show the Publish action."""
    out = await loras.list_previews()
    if not current_user.get("is_admin"):
        hidden = await loras.list_unpublished_names()
        return {name: meta for name, meta in out.items() if name not in hidden}
    visibility = await loras.list_all_visibility()
    for name, is_published in visibility.items():
        out.setdefault(name, {})["is_published"] = is_published
    return out


@api.put("/admin/lora-previews/{name:path}/meta")
async def set_lora_meta_route(name: str, body: ModelMetaIn,
                              current_user: dict = Depends(get_admin)):
    if body.model_category and any(c not in MODEL_CATEGORIES for c in body.model_category):
        raise HTTPException(400, f"model_category entries must be one of {MODEL_CATEGORIES}")
    await loras.set_meta(name, body.display_name, body.description, body.model_category, body.keywords)
    log.info("admin: lora meta set by=%s lora=%s", current_user["username"], name)
    return {"lora_name": name, "display_name": body.display_name, "description": body.description,
            "model_category": body.model_category, "keywords": body.keywords}


@api.put("/admin/lora-previews/{name:path}/publish")
async def publish_lora_route(name: str, body: LoraPublishIn, current_user: dict = Depends(get_admin)):
    if not await loras.get_visibility(name):
        raise HTTPException(404, "this LoRA isn't gated (only self-trained LoRAs need publishing)")
    await loras.set_published(name, body.published)
    log.info("admin: lora %s by=%s lora=%s", "published" if body.published else "unpublished",
             current_user["username"], name)
    return {"lora_name": name, "is_published": body.published}


@api.put("/admin/lora-previews/{name:path}")
async def set_lora_preview(name: str, file: UploadFile = File(...),
                           current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "lorapreview",
                                   loras.get_preview, loras.set_preview)
    log.info("admin: lora preview set by=%s lora=%s", current_user["username"], name)
    return {"lora_name": name, "image": url}


@api.delete("/admin/lora-previews/{name:path}")
async def clear_lora_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await loras.get_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await loras.delete_preview(name)
    log.info("admin: lora preview cleared by=%s lora=%s", current_user["username"], name)
    return {"cleared": True}


_DELETABLE_MODEL_DIRS = {"ckpt": CHECKPOINTS_DIR, "lora": LORA_OUTPUT_DIR, "upsc": UPSCALE_MODELS_DIR}


@api.delete("/admin/models/{kind}/{name:path}")
async def delete_model_file(kind: str, name: str, current_user: dict = Depends(get_admin)):
    """Permanently deletes the actual model file from ComfyUI's models volume
    — irreversible, unlike clear_*_preview above which only removes the admin-
    curated preview image/metadata. Also cleans up any preview/visibility rows
    for the deleted name so the admin UI doesn't keep a dangling entry."""
    base_dir = _DELETABLE_MODEL_DIRS.get(kind)
    if not base_dir:
        raise HTTPException(400, f"deleting {kind} files isn't supported")
    path = os.path.join(base_dir, os.path.basename(name))
    if not os.path.isfile(path):
        raise HTTPException(404, "file not found")
    os.remove(path)
    if kind == "ckpt":
        await checkpoints.delete_preview(name)
    elif kind == "lora":
        await loras.delete_preview(name)
        await loras.delete_visibility(name)
    elif kind == "upsc":
        await upscalers.delete_preview(name)
    log.info("admin: deleted %s file by=%s name=%s", kind, current_user["username"], name)
    return {"deleted": True}


@api.get("/imagegen/sampler-previews")
async def get_sampler_previews(current_user: dict = Depends(get_current_user)):
    """{sampler_name: {image, display_name, description}} — same shape and purpose
    as /imagegen/checkpoint-previews, for KSampler samplers."""
    return await samplers.list_previews()


@api.put("/admin/sampler-previews/{name:path}/meta")
async def set_sampler_meta_route(name: str, body: ModelMetaIn,
                                 current_user: dict = Depends(get_admin)):
    await samplers.set_meta(name, body.display_name, body.description)
    log.info("admin: sampler meta set by=%s sampler=%s", current_user["username"], name)
    return {"sampler_name": name, "display_name": body.display_name, "description": body.description}


@api.put("/admin/sampler-previews/{name:path}")
async def set_sampler_preview(name: str, file: UploadFile = File(...),
                              current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "sampprev",
                                   samplers.get_preview, samplers.set_preview)
    log.info("admin: sampler preview set by=%s sampler=%s", current_user["username"], name)
    return {"sampler_name": name, "image": url}


@api.delete("/admin/sampler-previews/{name:path}")
async def clear_sampler_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await samplers.get_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await samplers.delete_preview(name)
    log.info("admin: sampler preview cleared by=%s sampler=%s", current_user["username"], name)
    return {"cleared": True}


@api.get("/imagegen/scheduler-previews")
async def get_scheduler_previews(current_user: dict = Depends(get_current_user)):
    """{scheduler_name: {image, display_name, description}} — same shape and purpose
    as /imagegen/checkpoint-previews, for KSampler schedulers."""
    return await schedulers.list_previews()


@api.put("/admin/scheduler-previews/{name:path}/meta")
async def set_scheduler_meta_route(name: str, body: ModelMetaIn,
                                   current_user: dict = Depends(get_admin)):
    await schedulers.set_meta(name, body.display_name, body.description)
    log.info("admin: scheduler meta set by=%s scheduler=%s", current_user["username"], name)
    return {"scheduler_name": name, "display_name": body.display_name, "description": body.description}


@api.put("/admin/scheduler-previews/{name:path}")
async def set_scheduler_preview(name: str, file: UploadFile = File(...),
                                current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "schedprev",
                                   schedulers.get_preview, schedulers.set_preview)
    log.info("admin: scheduler preview set by=%s scheduler=%s", current_user["username"], name)
    return {"scheduler_name": name, "image": url}


@api.delete("/admin/scheduler-previews/{name:path}")
async def clear_scheduler_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await schedulers.get_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await schedulers.delete_preview(name)
    log.info("admin: scheduler preview cleared by=%s scheduler=%s", current_user["username"], name)
    return {"cleared": True}


@api.get("/imagegen/upscalers")
async def get_imagegen_upscalers(current_user: dict = Depends(get_current_user)):
    try:
        return await imagegen.list_upscalers(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/upscaler-previews")
async def get_upscaler_previews(current_user: dict = Depends(get_current_user)):
    """{upscaler_name: {image, display_name, description}} — same shape and
    purpose as /imagegen/checkpoint-previews, for upscale models."""
    return await upscalers.list_previews()


@api.put("/admin/upscaler-previews/{name:path}/meta")
async def set_upscaler_meta_route(name: str, body: ModelMetaIn,
                                  current_user: dict = Depends(get_admin)):
    await upscalers.set_meta(name, body.display_name, body.description)
    log.info("admin: upscaler meta set by=%s upscaler=%s", current_user["username"], name)
    return {"upscaler_name": name, "display_name": body.display_name, "description": body.description}


@api.put("/admin/upscaler-previews/{name:path}")
async def set_upscaler_preview(name: str, file: UploadFile = File(...),
                               current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "upscprev",
                                   upscalers.get_preview, upscalers.set_preview)
    log.info("admin: upscaler preview set by=%s upscaler=%s", current_user["username"], name)
    return {"upscaler_name": name, "image": url}


@api.delete("/admin/upscaler-previews/{name:path}")
async def clear_upscaler_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await upscalers.get_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await upscalers.delete_preview(name)
    log.info("admin: upscaler preview cleared by=%s upscaler=%s", current_user["username"], name)
    return {"cleared": True}
