"""Memory, session, message, in-chat image generation, and chat/regenerate/
roll/continue routes."""
import os
import json
import uuid
import base64

import hashlib
import time
from urllib.parse import urlparse

from fastapi import HTTPException, Depends, UploadFile, File
from fastapi.responses import StreamingResponse

from backend import db
from backend import vectors
from backend import llm
from backend import imagegen
from backend.state import api, CFG, MEDIA_DIR, MAX_UPLOAD_BYTES, IMG_EXTS, log
from backend.auth import get_current_user, get_admin
from backend.media import _delete_media_file, _write_file, _save_uploaded_image, validate_image
from backend.chat_service import (_own_session, _endpoints, _eff_cfg, _ui_language,
                          _chat_language, _localize_texts, _generate_image_prompt, _run,
                          classify_image_background)
from backend.prompt import macro, roll_dice, format_roll, resolve_inline_rolls
from backend.ratelimit import SlidingWindow, InFlight

# One image generation per user at a time — these all hit a single shared GPU, and
# a user with a request already rendering cannot usefully start another. Simple
# in-flight tracking is more robust here than a per-minute window: it naturally
# bounds GPU contention regardless of how long a render takes.
_IMAGEGEN_INFLIGHT = InFlight(
    "You already have an image generating — please wait for it to finish")
_IMAGE_REPORT_LIMIT = SlidingWindow(
    20, 60, "Too many reports — please slow down and try again shortly")
from backend.schemas import (SessionIn, RenameIn, StyleIn, GlossaryIn, LanguageIn,
                     AuthorNoteIn, MessageEdit, RollIn, ChatIn,
                     ImageGenIn, ImageGenStandaloneIn, ImageGenSaveIn, ImageGenUpscaleIn, ImageShareIn,
                     ModelRequestIn, ModelMetaIn, ImageRatingReportIn)

@api.get("/sessions/{sid}/memory")
async def get_memory(sid: str, q: str | None = None, k: int = 30,
                     current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    user_overrides = await db.get_user_settings(current_user["id"])
    ep = await _endpoints(user_overrides, current_user["id"], current_user.get("is_admin", False))

    if q:
        # embed model/dim stay global (vectors share one index), but the endpoint
        # serving that model may be the user's own (see _endpoints)
        vec = await llm.embed(q, CFG["embed_model"],
                              base_url=ep["embed_base"], api_key=ep["embed_key"])
        items = await vectors.search_memory_scored(sid, vec, k)
    else:
        items = await vectors.list_memory(sid, k)

    return items


@api.delete("/sessions/{sid}/memory")
async def clear_memory(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    # translations in the localization cache are keyed by content hash and shared;
    # they stay behind harmlessly (and get reused if the same note ever recurs)
    await vectors.delete_by_tag(vectors.MEM_INDEX, "session", sid)
    return {"cleared": True}


@api.delete("/sessions/{sid}/memory/{mid}")
async def delete_memory_entry(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await vectors.delete_memory(mid)
    return {"deleted": True}


MILESTONES = [10, 50, 100, 500, 1000]


async def _maybe_notify_milestone(char: dict):
    """First public session-count crossing of each threshold notifies the owner
    exactly once (deduped by a related_id of '{cid}:{threshold}')."""
    owner_id = char.get("owner_id")
    if not owner_id or not char.get("is_public"):
        return
    count = await db.count_char_sessions(char["id"])
    for threshold in MILESTONES:
        if count < threshold:
            break
        related_id = f"{char['id']}:{threshold}"
        if await db.notification_exists(owner_id, "milestone", related_id):
            continue
        await db.create_notification(
            owner_id, "milestone",
            f"{char['name']} reached {threshold} chats",
            f"Your character {char['name']} has been started in {threshold} chats.",
            f"/c/{char['id']}", related_id=related_id)


@api.post("/characters/{cid}/sessions")
async def new_session(cid: str, body: SessionIn,
                      current_user: dict = Depends(get_current_user)):
    char = await db.get_character(cid)
    if not char:
        raise HTTPException(404, "character not found")
    persona = await db.get_persona(body.persona_id) if body.persona_id else await db.default_persona(current_user["id"])
    user_name = persona["name"] if persona else "You"
    sid = await db.create_session(cid, persona["id"] if persona else None,
                                  char["name"], user_name, user_id=current_user["id"])
    greeting = macro(char.get("greeting", ""), char["name"], user_name)
    if greeting:
        # A brand-new session has no talk language yet, so this resolves to the
        # user's interface language (or the instance default). The greeting is
        # character-authored text, localized for display via the same persistent
        # cache as scenarios/personas (see /api/localize) — a pure cache lookup,
        # not a live LLM call.
        user_overrides = await db.get_user_settings(current_user["id"])
        language = _ui_language(user_overrides)
        try:
            [greeting_disp] = await _localize_texts([greeting], language)
        except Exception:
            log.warning("greeting localization failed: session=%s", sid)
            greeting_disp = greeting
        await db.add_message(sid, "assistant", greeting_disp, lang=language)
    await _maybe_notify_milestone(char)
    return await db.get_session(sid)


@api.get("/sessions")
async def list_sessions(limit: int = 40, char_id: str | None = None,
                        current_user: dict = Depends(get_current_user)):
    return await db.list_sessions(limit, user_id=current_user["id"], char_id=char_id)


@api.get("/sessions/{sid}")
async def get_session(sid: str, current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    return s


@api.patch("/sessions/{sid}")
async def rename_session(sid: str, body: RenameIn,
                         current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await db.rename_session(sid, body.title)
    return {"ok": True}


@api.put("/sessions/{sid}/style")
async def set_session_style(sid: str, body: StyleIn,
                            current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await db.set_session_style(sid, body.key, body.prompt or None)
    return {"ok": True}


@api.put("/sessions/{sid}/glossary")
async def set_session_glossary(sid: str, body: GlossaryIn,
                               current_user: dict = Depends(get_current_user)):
    """Per-session terminology pins: {source term: exact rendering}. Injected into
    every translation prompt for this session so class names, spells, ranks etc.
    are always rendered exactly as the player wants — the vocabulary counterpart
    of known_names."""
    await _own_session(sid, current_user)
    gl = {k.strip(): v.strip() for k, v in (body.glossary or {}).items()
          if k.strip() and v.strip()}
    if len(gl) > 200:
        raise HTTPException(400, "glossary too large")
    await db.set_session_glossary(sid, json.dumps(gl, ensure_ascii=False))
    return {"ok": True, "glossary": gl}


@api.put("/sessions/{sid}/language")
async def set_session_language(sid: str, body: LanguageIn,
                               current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    lang = (body.language or "").strip() or None
    await db.set_session_language(sid, lang)
    return {"ok": True, "language": lang}


@api.put("/sessions/{sid}/note")
async def set_session_author_note(sid: str, body: AuthorNoteIn,
                                  current_user: dict = Depends(get_current_user)):
    """Persistent Author's Note: re-injected as the last message before every
    generation (see the author_note block in _run) so it survives long
    conversations instead of scrolling out of the history window."""
    await _own_session(sid, current_user)
    note = (body.note or "").strip() or None
    await db.set_session_author_note(sid, note)
    return {"ok": True, "note": note}


@api.get("/sessions/{sid}/state")
async def get_char_state(sid: str, current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    doing, location = s.get("char_doing") or "", s.get("char_location") or ""
    known_names = json.loads(s.get("known_names") or "[]")
    display_names = known_names
    if known_names:
        try:
            user_overrides = await db.get_user_settings(current_user["id"])
            display_names = await _localize_texts(known_names, _ui_language(user_overrides))
        except Exception as e:
            log.warning("char-state name localization failed (session=%s): %s: %s",
                        sid, type(e).__name__, e)
    return {
        "doing": doing,
        "location": location,
        "known_names": display_names,
    }


@api.delete("/sessions/{sid}")
async def delete_session(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await db.delete_session(sid)
    await vectors.delete_by_tag(vectors.MEM_INDEX, "session", sid)
    return {"deleted": True}


@api.patch("/sessions/{sid}/messages/{mid}")
async def edit_message(sid: str, mid: str, body: MessageEdit,
                       current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await db.edit_message(sid, mid, body.content)
    return {"ok": True}


async def _build_image_prompt_for_message(sid: str, mid: str, current_user: dict) -> tuple[dict, dict, dict, str]:
    """Shared setup for both the prompt-preview and the actual generation endpoint:
    resolves the session/message/character and returns the auto-generated (positive,
    negative) tags — see _generate_image_prompt for what feeds into them."""
    s = await _own_session(sid, current_user)
    msgs = await db.get_messages(sid)
    msg = next((m for m in msgs if m["id"] == mid), None)
    if not msg:
        raise HTTPException(404, "message not found")
    char = await db.get_character(s["char_id"])
    if not char:
        raise HTTPException(404, "character not found")

    user_overrides = await db.get_user_settings(current_user["id"])
    chat_model = _eff_cfg(user_overrides).get("chat_model") or CFG["chat_model"]
    ep = await _endpoints(user_overrides, current_user["id"], current_user.get("is_admin", False))

    # Same keyword-trigger lookup retrieve() uses for chat context — pulls in any lore
    # entry whose keys appear in the scene, plus the main character's own established
    # look, so the model describes named characters/places consistently instead of
    # inventing new appearances every generation.
    #
    # Optional opt-in: any lore entry with its own appearance_tags field (pre-written
    # Danbooru tags, entered alongside that entry's image) has those tags injected into
    # the positive prompt verbatim instead of being paraphrased by the LLM rewrite —
    # entries that leave the field blank behave exactly as before (prose, rewritten
    # each time).
    appearance_lines = []
    direct_tags = []
    direct_negative_tags = []
    if char.get("persona"):
        appearance_lines.append(f"- {char['name']}: {char['persona']}".replace("\n", " "))
    scene_lower = msg["content"].lower()
    for e in await db.list_lore(s["char_id"]):
        if e["always"] or any(k.lower() in scene_lower for k in e["keys"]):
            if e.get("appearance_tags"):
                direct_tags.append(e["appearance_tags"].strip())
            if e.get("appearance_tags_negative"):
                direct_negative_tags.append(e["appearance_tags_negative"].strip())
            if e["content"]:
                appearance_lines.append("- " + e["content"].replace("\n", " "))

    positive, negative = await _generate_image_prompt(
        msg["content"], char["name"], chat_model, appearance_lines, direct_tags, direct_negative_tags,
        chat_base=ep["chat_base"], chat_key=ep["chat_key"])
    return s, msg, char, positive, negative


def _decode_reference_image(data_url: str | None) -> bytes | None:
    """Decodes an optional data:image/...;base64,... reference image for img2img.
    Returns None (txt2img, unchanged behavior) if no reference was supplied."""
    if not data_url:
        return None
    if not data_url.startswith("data:image/"):
        raise HTTPException(400, "reference_image must be a data:image/... URL")
    _, _, b64data = data_url.partition(",")
    if len(b64data) > MAX_UPLOAD_BYTES * 4 // 3 + 256:
        raise HTTPException(413, f"reference image too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")
    try:
        return base64.b64decode(b64data)
    except Exception:
        raise HTTPException(400, "invalid base64 reference image data")


@api.post("/sessions/{sid}/messages/{mid}/image-prompt")
async def preview_message_image_prompt(sid: str, mid: str,
                                       current_user: dict = Depends(get_current_user)):
    """Runs just the tag-generation step so the UI can show the auto-generated positive/
    negative prompts as separate editable fields before actually calling ComfyUI."""
    _, _, _, positive, negative = await _build_image_prompt_for_message(sid, mid, current_user)
    return {"positive": positive, "negative": negative}


@api.post("/sessions/{sid}/messages/{mid}/image")
async def generate_message_image(sid: str, mid: str, body: ImageGenIn,
                                 current_user: dict = Depends(get_current_user)):
    s, msg, char, auto_positive, auto_negative = await _build_image_prompt_for_message(sid, mid, current_user)
    positive = body.positive if body.positive is not None else auto_positive
    negative = body.negative if body.negative is not None else auto_negative
    checkpoint = body.checkpoint or CFG["comfyui_checkpoint"]
    reference_image = _decode_reference_image(body.reference_image)
    log.info("imagegen: message image start user=%s session=%s mid=%s checkpoint=%s",
             current_user["username"], sid, mid, checkpoint)
    _IMAGEGEN_INFLIGHT.acquire(current_user["id"])
    try:
        image_bytes = await imagegen.generate_image(
            positive, negative, CFG["comfyui_url"], checkpoint,
            custom_workflow=CFG["comfyui_workflow"],
            loras=[l.model_dump() for l in body.loras],
            reference_image=reference_image, denoise=body.denoise)
    except Exception as e:
        log.warning("imagegen: message image failed user=%s session=%s mid=%s: %s",
                    current_user["username"], sid, mid, e)
        raise HTTPException(502, f"Image generation failed: {e}")
    finally:
        _IMAGEGEN_INFLIGHT.release(current_user["id"])

    _delete_media_file(msg.get("image"))

    fname = f"img_{uuid.uuid4().hex[:10]}.png"
    await _write_file(os.path.join(MEDIA_DIR, fname), image_bytes)
    url = f"/media/{fname}"
    await db.set_message_image(sid, mid, url, positive, negative, is_explicit=False)
    log.info("imagegen: message image done user=%s session=%s mid=%s", current_user["username"], sid, mid)
    classify_image_background(image_bytes, "image/png", current_user["id"],
                              current_user.get("is_admin", False),
                              lambda: db.set_message_image_explicit(sid, mid))
    return {"image": url}


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
    return await db.list_checkpoint_previews()


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
    await db.set_checkpoint_meta(name, body.display_name, body.description, body.model_type,
                                 body.default_steps, body.anima_clip_name, body.anima_vae_name)
    log.info("admin: checkpoint meta set by=%s checkpoint=%s", current_user["username"], name)
    return {"checkpoint_name": name, "display_name": body.display_name,
            "description": body.description, "model_type": body.model_type,
            "anima_clip_name": body.anima_clip_name, "anima_vae_name": body.anima_vae_name}


@api.put("/admin/checkpoint-previews/{name:path}")
async def set_checkpoint_preview(name: str, file: UploadFile = File(...),
                                 current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "ckptprev",
                                   db.get_checkpoint_preview, db.set_checkpoint_preview)
    log.info("admin: checkpoint preview set by=%s checkpoint=%s", current_user["username"], name)
    return {"checkpoint_name": name, "image": url}


@api.delete("/admin/checkpoint-previews/{name:path}")
async def clear_checkpoint_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await db.get_checkpoint_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await db.delete_checkpoint_preview(name)
    log.info("admin: checkpoint preview cleared by=%s checkpoint=%s", current_user["username"], name)
    return {"cleared": True}


@api.get("/imagegen/loras")
async def get_imagegen_loras(current_user: dict = Depends(get_current_user)):
    try:
        return await imagegen.list_loras(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/samplers")
async def get_imagegen_samplers(current_user: dict = Depends(get_current_user)):
    try:
        return await imagegen.list_samplers(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/lora-previews")
async def get_lora_previews(current_user: dict = Depends(get_current_user)):
    """{lora_name: {image, display_name, description}} — same shape and purpose
    as /imagegen/checkpoint-previews, for LoRAs."""
    return await db.list_lora_previews()


@api.put("/admin/lora-previews/{name:path}/meta")
async def set_lora_meta_route(name: str, body: ModelMetaIn,
                              current_user: dict = Depends(get_admin)):
    if body.model_category and any(c not in MODEL_CATEGORIES for c in body.model_category):
        raise HTTPException(400, f"model_category entries must be one of {MODEL_CATEGORIES}")
    await db.set_lora_meta(name, body.display_name, body.description, body.model_category)
    log.info("admin: lora meta set by=%s lora=%s", current_user["username"], name)
    return {"lora_name": name, "display_name": body.display_name, "description": body.description,
            "model_category": body.model_category}


@api.put("/admin/lora-previews/{name:path}")
async def set_lora_preview(name: str, file: UploadFile = File(...),
                           current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "lorapreview",
                                   db.get_lora_preview, db.set_lora_preview)
    log.info("admin: lora preview set by=%s lora=%s", current_user["username"], name)
    return {"lora_name": name, "image": url}


@api.delete("/admin/lora-previews/{name:path}")
async def clear_lora_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await db.get_lora_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await db.delete_lora_preview(name)
    log.info("admin: lora preview cleared by=%s lora=%s", current_user["username"], name)
    return {"cleared": True}


@api.get("/imagegen/sampler-previews")
async def get_sampler_previews(current_user: dict = Depends(get_current_user)):
    """{sampler_name: {image, display_name, description}} — same shape and purpose
    as /imagegen/checkpoint-previews, for KSampler samplers."""
    return await db.list_sampler_previews()


@api.put("/admin/sampler-previews/{name:path}/meta")
async def set_sampler_meta_route(name: str, body: ModelMetaIn,
                                 current_user: dict = Depends(get_admin)):
    await db.set_sampler_meta(name, body.display_name, body.description)
    log.info("admin: sampler meta set by=%s sampler=%s", current_user["username"], name)
    return {"sampler_name": name, "display_name": body.display_name, "description": body.description}


@api.put("/admin/sampler-previews/{name:path}")
async def set_sampler_preview(name: str, file: UploadFile = File(...),
                              current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "sampprev",
                                   db.get_sampler_preview, db.set_sampler_preview)
    log.info("admin: sampler preview set by=%s sampler=%s", current_user["username"], name)
    return {"sampler_name": name, "image": url}


@api.delete("/admin/sampler-previews/{name:path}")
async def clear_sampler_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await db.get_sampler_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await db.delete_sampler_preview(name)
    log.info("admin: sampler preview cleared by=%s sampler=%s", current_user["username"], name)
    return {"cleared": True}


@api.get("/imagegen/scheduler-previews")
async def get_scheduler_previews(current_user: dict = Depends(get_current_user)):
    """{scheduler_name: {image, display_name, description}} — same shape and purpose
    as /imagegen/checkpoint-previews, for KSampler schedulers."""
    return await db.list_scheduler_previews()


@api.put("/admin/scheduler-previews/{name:path}/meta")
async def set_scheduler_meta_route(name: str, body: ModelMetaIn,
                                   current_user: dict = Depends(get_admin)):
    await db.set_scheduler_meta(name, body.display_name, body.description)
    log.info("admin: scheduler meta set by=%s scheduler=%s", current_user["username"], name)
    return {"scheduler_name": name, "display_name": body.display_name, "description": body.description}


@api.put("/admin/scheduler-previews/{name:path}")
async def set_scheduler_preview(name: str, file: UploadFile = File(...),
                                current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "schedprev",
                                   db.get_scheduler_preview, db.set_scheduler_preview)
    log.info("admin: scheduler preview set by=%s scheduler=%s", current_user["username"], name)
    return {"scheduler_name": name, "image": url}


@api.delete("/admin/scheduler-previews/{name:path}")
async def clear_scheduler_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await db.get_scheduler_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await db.delete_scheduler_preview(name)
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
    return await db.list_upscaler_previews()


@api.put("/admin/upscaler-previews/{name:path}/meta")
async def set_upscaler_meta_route(name: str, body: ModelMetaIn,
                                  current_user: dict = Depends(get_admin)):
    await db.set_upscaler_meta(name, body.display_name, body.description)
    log.info("admin: upscaler meta set by=%s upscaler=%s", current_user["username"], name)
    return {"upscaler_name": name, "display_name": body.display_name, "description": body.description}


@api.put("/admin/upscaler-previews/{name:path}")
async def set_upscaler_preview(name: str, file: UploadFile = File(...),
                               current_user: dict = Depends(get_admin)):
    url = await _set_preview_image(name, file, "upscprev",
                                   db.get_upscaler_preview, db.set_upscaler_preview)
    log.info("admin: upscaler preview set by=%s upscaler=%s", current_user["username"], name)
    return {"upscaler_name": name, "image": url}


@api.delete("/admin/upscaler-previews/{name:path}")
async def clear_upscaler_preview(name: str, current_user: dict = Depends(get_admin)):
    old = await db.get_upscaler_preview(name)
    if old:
        _delete_media_file(old.split("?")[0])
    await db.delete_upscaler_preview(name)
    log.info("admin: upscaler preview cleared by=%s upscaler=%s", current_user["username"], name)
    return {"cleared": True}


@api.get("/me/images")
async def list_my_images(current_user: dict = Depends(get_current_user)):
    return await db.list_user_images(current_user["id"])


@api.delete("/me/images/{mid}")
async def delete_my_image(mid: str, current_user: dict = Depends(get_current_user)):
    images = await db.list_user_images(current_user["id"])
    img = next((i for i in images if i["mid"] == mid), None)
    if not img:
        raise HTTPException(404, "image not found")
    _delete_media_file(img["image"])
    await db.set_message_image(img["sid"], mid, "")
    return {"deleted": True}


def _clamp_dim(v: int) -> int:
    try:
        v = int(v)
    except (TypeError, ValueError):
        return 1024
    v = max(256, min(2048, v))
    return v - (v % 8)


def _clamp_steps(v: int) -> int:
    try:
        v = int(v)
    except (TypeError, ValueError):
        return 20
    return max(1, min(60, v))


@api.post("/imagegen/standalone/stream")
async def stream_standalone_image(body: ImageGenStandaloneIn,
                                  current_user: dict = Depends(get_current_user)):
    """Live-preview generation for the standalone Image Gen page — not tied to any
    chat message. Nothing is written to disk or the DB here; the browser gets a
    stream of in-progress preview frames followed by the final image as a data
    URL, and only /imagegen/standalone/save persists anything, on explicit request."""
    # The global default checkpoint is an SDXL model — never a sensible
    # fallback for the unrelated Anima architecture, whose "checkpoint" is
    # actually a UNet filename from a completely different ComfyUI list.
    checkpoint = body.checkpoint or (CFG["comfyui_checkpoint"] if body.architecture != "anima" else None)
    if not checkpoint:
        raise HTTPException(400, "No model selected")
    reference_image = _decode_reference_image(body.reference_image)
    width = _clamp_dim(body.width)
    height = _clamp_dim(body.height)

    log.info("imagegen: standalone start user=%s checkpoint=%s arch=%s size=%sx%s",
             current_user["username"], checkpoint, body.architecture, width, height)

    _IMAGEGEN_INFLIGHT.acquire(current_user["id"])

    async def gen():
        try:
            async for kind, data in imagegen.generate_image_stream(
                    body.positive, body.negative, CFG["comfyui_url"], checkpoint,
                    loras=[l.model_dump() for l in body.loras],
                    reference_image=reference_image, denoise=body.denoise,
                    width=width, height=height,
                    sampler=body.sampler or "euler", scheduler=body.scheduler or "normal",
                    steps=_clamp_steps(body.steps), cfg=body.cfg, architecture=body.architecture):
                mime = "image/jpeg" if kind == "preview" else "image/png"
                b64 = base64.b64encode(data).decode()
                yield "data: " + json.dumps({
                    "type": kind, "image": f"data:{mime};base64,{b64}",
                }) + "\n\n"
            log.info("imagegen: standalone done user=%s", current_user["username"])
        except Exception as e:
            log.warning("imagegen: standalone failed user=%s: %s", current_user["username"], e)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        finally:
            _IMAGEGEN_INFLIGHT.release(current_user["id"])

    return StreamingResponse(gen(), media_type="text/event-stream")


@api.post("/imagegen/standalone/stream/stop")
async def stop_standalone_image(current_user: dict = Depends(get_current_user)):
    """Cancel the in-progress standalone generation: aborting the client-side
    stream alone leaves ComfyUI rendering in the background, so this pokes
    ComfyUI's /interrupt to actually stop the GPU job the client just abandoned."""
    try:
        await imagegen.interrupt(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")
    log.info("imagegen: standalone interrupted user=%s", current_user["username"])
    return {"stopped": True}


@api.post("/imagegen/upscale")
async def upscale_standalone_image(body: ImageGenUpscaleIn, current_user: dict = Depends(get_current_user)):
    """Upscales the currently-previewed (not-yet-saved) generated image via a
    dedicated ComfyUI upscale model — no checkpoint/sampler graph involved.
    Returns the upscaled image the same way /imagegen/standalone/stream does
    (a data URL), so the client can just swap it in as the new preview."""
    image_bytes = _decode_reference_image(body.image)
    if not image_bytes:
        raise HTTPException(400, "image is required")
    upscaler = body.upscaler
    if not upscaler:
        upscalers = await imagegen.list_upscalers(CFG["comfyui_url"])
        if not upscalers:
            raise HTTPException(400, "No upscaler models available")
        upscaler = upscalers[0]
    _IMAGEGEN_INFLIGHT.acquire(current_user["id"])
    try:
        result = await imagegen.upscale_image(image_bytes, CFG["comfyui_url"], upscaler)
    except Exception as e:
        log.warning("imagegen: upscale failed user=%s: %s", current_user["username"], e)
        raise HTTPException(502, f"Upscale failed: {e}")
    finally:
        _IMAGEGEN_INFLIGHT.release(current_user["id"])
    log.info("imagegen: upscale done user=%s upscaler=%s", current_user["username"], upscaler)
    b64 = base64.b64encode(result).decode()
    return {"image": f"data:image/png;base64,{b64}"}


@api.post("/imagegen/standalone/save")
async def save_standalone_image(body: ImageGenSaveIn, current_user: dict = Depends(get_current_user)):
    if not body.image.startswith("data:image/"):
        raise HTTPException(400, "expected a data:image/... URL")
    header, _, b64data = body.image.partition(",")
    # cap the encoded payload before decoding — base64 inflates ~33%, so a 15MB
    # image is ~20MB of base64; reject anything larger before allocating the decode.
    if len(b64data) > MAX_UPLOAD_BYTES * 4 // 3 + 256:
        raise HTTPException(413, f"image too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")
    try:
        data = base64.b64decode(b64data)
    except Exception:
        raise HTTPException(400, "invalid base64 image data")
    await validate_image(data)
    fname = f"img_{uuid.uuid4().hex[:10]}.png"
    await _write_file(os.path.join(MEDIA_DIR, fname), data)
    url = f"/media/{fname}"
    rec = await db.create_standalone_image(current_user["id"], url, body.positive, body.negative,
                                           checkpoint=body.checkpoint,
                                           loras=[l.model_dump() for l in body.loras],
                                           is_explicit=False, sampler=body.sampler,
                                           scheduler=body.scheduler, steps=_clamp_steps(body.steps),
                                           is_img2img=body.is_img2img)
    async def _flag_low_confidence(explicit: bool, confidence: int):
        await db.create_image_rating_report(
            rec["id"], current_user["id"], explicit,
            note=f"Auto-flagged: classifier confidence {confidence}% (below 80%) on verdict {'NSFW' if explicit else 'SFW'}.",
            auto_flagged=True)
        await db.notify_admins(
            "admin_image_report", "Low-confidence image rating",
            f"An image was auto-flagged for review — the classifier was only {confidence}% confident.",
            "/admin/moderation")
    classify_image_background(data, "image/png", current_user["id"],
                              current_user.get("is_admin", False),
                              lambda: db.set_standalone_explicit(rec["id"]),
                              on_done=lambda explicit: db.mark_standalone_classified(rec["id"]),
                              on_low_confidence=_flag_low_confidence)
    log.info("imagegen: standalone saved user=%s image=%s", current_user["username"], rec["id"])
    return rec


@api.get("/imagegen/standalone")
async def list_standalone_images(current_user: dict = Depends(get_current_user)):
    return await db.list_standalone_images(current_user["id"])


@api.post("/imagegen/standalone/{iid}/share")
async def share_standalone_image(iid: str, body: ImageShareIn,
                                 current_user: dict = Depends(get_current_user)):
    existing = await db.get_standalone_image(iid)
    if existing is None or existing.get("user_id") != current_user["id"]:
        raise HTTPException(404, "image not found")
    if not existing.get("classified"):
        raise HTTPException(409, "This image hasn't been rated yet — try again in a moment.")
    # The classifier's result is authoritative and can never be downgraded by
    # the sharer — body.is_explicit can only self-flag something the
    # classifier missed as MORE explicit, never mark an already-NSFW image as
    # SFW. Disputing a real classification goes through the report/admin-
    # review flow (lodge a report), not a checkbox at share time.
    final_explicit = bool(existing.get("is_explicit")) or body.is_explicit
    rec = await db.set_standalone_public(iid, current_user["id"], True, final_explicit)
    if rec is None:
        raise HTTPException(404, "image not found")
    log.info("image shared: id=%s by=%s explicit=%s (classifier=%s, self-flagged=%s)",
             iid, current_user["username"], final_explicit, existing.get("is_explicit"), body.is_explicit)
    return rec


@api.post("/imagegen/standalone/{iid}/unshare")
async def unshare_standalone_image(iid: str, current_user: dict = Depends(get_current_user)):
    rec = await db.set_standalone_public(iid, current_user["id"], False)
    if rec is None:
        raise HTTPException(404, "image not found")
    log.info("image unshared: id=%s by=%s", iid, current_user["username"])
    return rec


@api.post("/imagegen/standalone/{iid}/report")
async def report_standalone_image_rating(iid: str, body: ImageRatingReportIn,
                                         current_user: dict = Depends(get_current_user)):
    _IMAGE_REPORT_LIMIT.check_and_record(current_user["id"])
    img = await db.get_standalone_image(iid)
    if img is None:
        raise HTTPException(404, "image not found")
    note = (body.note or "").strip()
    rep = await db.create_image_rating_report(
        iid, current_user["id"], body.claimed_explicit, note)
    claim = "NSFW" if body.claimed_explicit else "SFW"
    # No exclude_user_id here, unlike other admin_* notifications — a rating
    # report is a moderation queue item every admin needs visibility into,
    # including one who reported it themselves (e.g. an admin/dev spotting a
    # misclassification while browsing as a regular member). Self-excluding
    # would make the report invisible to the one admin who just flagged it.
    await db.notify_admins(
        "admin_image_report", f"Image rating report: should be {claim}",
        f"{current_user['username']} reported an image should be rated {claim}.",
        "/admin", related_id=rep["id"])
    log.info("image rating report: image=%s by=%s claimed_explicit=%s",
             iid, current_user["username"], body.claimed_explicit)
    return {"ok": True}


@api.get("/imagegen/standalone/{iid}")
async def get_shared_standalone_image(iid: str, current_user: dict = Depends(get_current_user)):
    rec = await db.get_public_standalone_image(iid)
    if rec is None:
        raise HTTPException(404, "image not found")
    return rec


@api.get("/imagegen/community")
async def community_images(current_user: dict = Depends(get_current_user)):
    hidden = await db.hidden_user_ids(current_user["id"])
    return await db.list_community_images(hidden)


def _match_model_request_host(url: str) -> dict | None:
    """Checked here at submit time, and again by admin.py at approve/retry
    time — the URL itself is never fetched here (see ssrf.py's rationale for
    why untrusted-URL fetching is dangerous); this just gates which links are
    even accepted into the pending-request queue, and later which ones the
    admin can approve with server-side auto-download. Returns the matching
    {"host","api_key"} entry from CFG['model_request_hosts'], or None if the
    URL's host isn't on the allowlist."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return None
    if not host:
        return None
    for entry in CFG.get("model_request_hosts", []):
        h = (entry.get("host") or "").lower().lstrip(".")
        if h and (host == h or host.endswith("." + h)):
            return entry
    return None


def _valid_http_url(url: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        host = ""
    return (url.startswith("http://") or url.startswith("https://")) and bool(host)


@api.post("/imagegen/model-requests")
async def create_model_request(body: ModelRequestIn, current_user: dict = Depends(get_current_user)):
    name = body.model_name.strip()
    url = body.source_url.strip()
    if not name:
        raise HTTPException(400, "model name is required")
    if not _valid_http_url(url):
        raise HTTPException(400, "source URL must be a valid http(s) link")
    vae_url = body.vae_url.strip() if body.vae_url else None
    if vae_url and not _valid_http_url(vae_url):
        raise HTTPException(400, "VAE URL must be a valid http(s) link")
    text_encoder_url = body.text_encoder_url.strip() if body.text_encoder_url else None
    if text_encoder_url and not _valid_http_url(text_encoder_url):
        raise HTTPException(400, "text encoder URL must be a valid http(s) link")
    request_type = (body.request_type if body.request_type in ("checkpoint", "lora", "upscaler", "anima")
                    else "checkpoint")
    host_allowed = 1 if _match_model_request_host(url) else 0
    req = await db.create_model_request(current_user["id"], name, url, body.note.strip(),
                                        request_type, host_allowed,
                                        vae_url, text_encoder_url)
    await db.notify_admins(
        "admin_model_request", f"{request_type.capitalize()} request: {name}",
        f"{current_user['username']} requested {request_type} '{name}'.",
        "/admin", exclude_user_id=current_user["id"])
    log.info("model request created: by=%s type=%s model=%s host_allowed=%s",
             current_user["username"], request_type, name, bool(host_allowed))
    return req


@api.get("/imagegen/model-requests")
async def list_my_model_requests(current_user: dict = Depends(get_current_user)):
    """Always scoped to the caller's own requests — there is no 'view anyone
    else's requests' case for a non-admin, regardless of query params."""
    return await db.list_model_requests(user_id=current_user["id"])


@api.delete("/imagegen/standalone/{iid}")
async def delete_standalone_image(iid: str, current_user: dict = Depends(get_current_user)):
    url = await db.delete_standalone_image(iid, current_user["id"])
    if url is None:
        raise HTTPException(404, "image not found")
    _delete_media_file(url)
    return {"deleted": True}


@api.delete("/sessions/{sid}/messages/{mid}")
async def delete_message(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    msgs = await db.get_messages(sid)
    idx = next((i for i, m in enumerate(msgs) if m["id"] == mid), None)
    if idx is not None:
        _delete_media_file(msgs[idx].get("image"))
    await db.delete_message(sid, mid)
    if idx is not None:
        if msgs[idx]["role"] == "user":
            # memory is keyed by the triggering user message id
            await vectors.delete_memory(mid)
        else:
            # assistant reply — its memory (if any) is keyed by the user turn before it
            prev_user = next((m for m in reversed(msgs[:idx]) if m["role"] == "user"), None)
            if prev_user:
                await vectors.delete_memory(prev_user["id"])
    return {"ok": True}


@api.post("/sessions/{sid}/chat")
async def chat(sid: str, body: ChatIn, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    return await _run(sid, user_content=resolve_inline_rolls(body.content),
                      think=body.think, current_user=current_user)


@api.post("/sessions/{sid}/regenerate")
async def regenerate(sid: str, body: ChatIn | None = None,
                     current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    return await _run(sid, regenerate=True,
                      think=(body.think if body else None), current_user=current_user)


@api.post("/sessions/{sid}/roll")
async def roll(sid: str, body: RollIn, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    try:
        r = roll_dice(body.expr)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return await _run(sid, user_content=format_roll(r, body.note),
                      think=body.think, current_user=current_user)


@api.post("/sessions/{sid}/continue")
async def continue_chat(sid: str, body: ChatIn | None = None,
                        current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    direction = body.content if (body and body.content and body.content.strip()) else None
    return await _run(sid, continue_mode=True, direction=direction,
                      think=(body.think if body else None), current_user=current_user)

