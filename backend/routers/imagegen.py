"""In-chat and standalone image generation: per-message ComfyUI generation,
the standalone Image Gen page's streaming generate/upscale/save flow, the
community/shared-image feed, and user model-download requests. Read-only
ComfyUI option listings and admin preview/metadata curation for those same
checkpoints/LoRAs/samplers/schedulers/upscalers live in model_previews.py."""
import os
import json
import uuid
import base64
from urllib.parse import urlparse

from fastapi import HTTPException, Depends
from fastapi.responses import StreamingResponse

from backend import db
from backend.repositories import standalone_images as standalone_image_repo
from backend.repositories import image_rating_reports as image_rating_report_repo
from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import model_requests as model_request_repo
from backend.repositories import notifications as notification_repo
from backend import imagegen
from backend import guest_quota
from backend.gpu_queue import gpu_queue
from backend.state import api, CFG, MEDIA_DIR, MAX_UPLOAD_BYTES, log
from backend.auth import get_current_user, get_current_user_optional, get_admin
from backend.media import _delete_media_file, _write_file, validate_image, reencode_webp
from backend.chat_service import _own_session, _endpoints, _eff_cfg
from backend.ai_helpers import _generate_image_prompt, generate_image_prompt_and_params
from backend.classify import classify_image_background
from backend.ratelimit import SlidingWindow, InFlight
from backend.schemas import (ImageGenIn, ImageGenStandaloneIn, ImageGenSaveIn, ImageGenUpscaleIn,
                     ImageShareIn, ModelRequestIn, ImageRatingReportIn, ImagePromptFromDescriptionIn,
                     ImageGenInpaintIn, ImageGenVideoIn)

# One image generation per user at a time — these all hit a single shared GPU, and
# a user with a request already rendering cannot usefully start another. Simple
# in-flight tracking is more robust here than a per-minute window: it naturally
# bounds GPU contention regardless of how long a render takes.
_IMAGEGEN_INFLIGHT = InFlight(
    "You already have an image generating — please wait for it to finish")
_IMAGE_REPORT_LIMIT = SlidingWindow(
    20, 60, "Too many reports — please slow down and try again shortly")


async def _build_image_prompt_for_message(sid: str, mid: str, current_user: dict) -> tuple[dict, dict, dict, str]:
    """Shared setup for both the prompt-preview and the actual generation endpoint:
    resolves the session/message/character and returns the auto-generated (positive,
    negative) tags — see _generate_image_prompt for what feeds into them."""
    s = await _own_session(sid, current_user)
    msgs = await chat_sessions.list_messages(sid)
    msg = next((m for m in msgs if m["id"] == mid), None)
    if not msg:
        raise HTTPException(404, "message not found")
    char = await characters.get(s["char_id"])
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
    if char.get("appearance_tags"):
        direct_tags.append(char["appearance_tags"].strip())
    if char.get("appearance_tags_negative"):
        direct_negative_tags.append(char["appearance_tags_negative"].strip())
    if char.get("persona"):
        appearance_lines.append(f"- {char['name']}: {char['persona']}".replace("\n", " "))
    scene_lower = msg["content"].lower()
    for e in await db.list_lore(s["char_id"], current_user["id"]):
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
    guest_quota.check(current_user, "images")
    s, msg, char, auto_positive, auto_negative = await _build_image_prompt_for_message(sid, mid, current_user)
    positive = body.positive if body.positive is not None else auto_positive
    negative = body.negative if body.negative is not None else auto_negative
    checkpoint = body.checkpoint or (CFG["comfyui_checkpoint"] if body.architecture != "anima" else None)
    if not checkpoint:
        raise HTTPException(400, "checkpoint is required for Anima generation")
    reference_image = _decode_reference_image(body.reference_image)
    log.info("imagegen: message image start user=%s session=%s mid=%s checkpoint=%s architecture=%s",
             current_user["username"], sid, mid, checkpoint, body.architecture)
    _IMAGEGEN_INFLIGHT.acquire(current_user["id"])
    await gpu_queue.acquire(current_user)
    try:
        image_bytes = await imagegen.generate_image(
            positive, negative, CFG["comfyui_url"], checkpoint,
            custom_workflow=CFG["comfyui_workflow"],
            loras=[l.model_dump() for l in body.loras],
            reference_image=reference_image, denoise=body.denoise,
            width=body.width, height=body.height,
            sampler=body.sampler or "dpmpp_2m_sde_gpu", scheduler=body.scheduler or "karras",
            steps=body.steps, cfg=body.cfg, architecture=body.architecture)
    except Exception as e:
        log.warning("imagegen: message image failed user=%s session=%s mid=%s: %s",
                    current_user["username"], sid, mid, e)
        raise HTTPException(502, f"Image generation failed: {e}")
    finally:
        gpu_queue.release()
        _IMAGEGEN_INFLIGHT.release(current_user["id"])

    await guest_quota.record(current_user, "images")
    _delete_media_file(msg.get("image"))

    fname = f"img_{uuid.uuid4().hex[:10]}.png"
    await _write_file(os.path.join(MEDIA_DIR, fname), image_bytes)
    url = f"/media/{fname}"
    await chat_sessions.set_message_image(sid, mid, url, positive, negative, is_explicit=False)
    log.info("imagegen: message image done user=%s session=%s mid=%s", current_user["username"], sid, mid)
    classify_image_background(image_bytes, "image/png", current_user["id"],
                              current_user.get("is_admin", False),
                              lambda: chat_sessions.set_message_image_explicit(sid, mid))
    return {"image": url}


@api.get("/me/images")
async def list_my_images(current_user: dict = Depends(get_current_user)):
    return await standalone_image_repo.list_all_for_user(current_user["id"])


@api.delete("/me/images/{mid}")
async def delete_my_image(mid: str, current_user: dict = Depends(get_current_user)):
    images = await standalone_image_repo.list_all_for_user(current_user["id"])
    img = next((i for i in images if i["mid"] == mid), None)
    if not img:
        raise HTTPException(404, "image not found")
    _delete_media_file(img["image"])
    await chat_sessions.set_message_image(img["sid"], mid, "")
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


@api.post("/imagegen/prompt-from-description")
async def prompt_from_description(body: ImagePromptFromDescriptionIn,
                                   current_user: dict = Depends(get_current_user)):
    """Simple-mode image generation: converts a plain-English description (no
    chat/character context) into everything Simple mode needs — Danbooru tags
    AND sampler/scheduler/cfg/steps — so that UI only has to expose checkpoint,
    LoRAs, and a description field."""
    description = body.description.strip()
    if not description:
        raise HTTPException(400, "description is required")
    try:
        sampler_data = await imagegen.list_samplers(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")
    samplers = sampler_data.get("samplers") or []
    schedulers = sampler_data.get("schedulers") or []
    user_overrides = await db.get_user_settings(current_user["id"])
    chat_model = _eff_cfg(user_overrides).get("chat_model") or CFG["chat_model"]
    ep = await _endpoints(user_overrides, current_user["id"], current_user.get("is_admin", False))
    result = await generate_image_prompt_and_params(
        description, chat_model, samplers, schedulers,
        chat_base=ep["chat_base"], chat_key=ep["chat_key"])
    log.info("imagegen: prompt-from-description generated by=%s sampler=%s scheduler=%s",
             current_user["username"], result["sampler"], result["scheduler"])
    return result


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
    guest_quota.check(current_user, "images")
    await guest_quota.record(current_user, "images")
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
        queue_state = gpu_queue.status()
        if queue_state["busy"] or queue_state["queued"] or queue_state["cooling"]:
            yield "data: " + json.dumps({"type": "status", "message": (
                "GPU cooling down - your spot is held" if queue_state["cooling"]
                else f"Waiting for a GPU slot ({queue_state['queued'] + 1} in line)")}) + "\n\n"
        await gpu_queue.acquire(current_user)
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
            gpu_queue.release()
            _IMAGEGEN_INFLIGHT.release(current_user["id"])

    return StreamingResponse(gen(), media_type="text/event-stream")


@api.get("/imagegen/queue")
async def imagegen_queue_status(current_user: dict = Depends(get_current_user)):
    return gpu_queue.status()


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


@api.post("/imagegen/inpaint")
async def stream_inpaint_image(body: ImageGenInpaintIn, current_user: dict = Depends(get_current_user)):
    """Live-preview inpaint generation for a caller-supplied image — nothing
    persisted until /save, same shape as /imagegen/standalone/stream."""
    guest_quota.check(current_user, "images")
    await guest_quota.record(current_user, "images")
    image_bytes = _decode_reference_image(body.image)
    if not image_bytes:
        raise HTTPException(400, "image is required")
    mask_bytes = _decode_reference_image(body.mask)
    if not mask_bytes:
        raise HTTPException(400, "mask is required")

    checkpoint = body.checkpoint or (CFG["comfyui_checkpoint"] if body.architecture != "anima" else None)
    if not checkpoint:
        raise HTTPException(400, "checkpoint is required for Anima inpainting")
    log.info("imagegen: inpaint start user=%s checkpoint=%s architecture=%s",
             current_user["username"], checkpoint, body.architecture)
    _IMAGEGEN_INFLIGHT.acquire(current_user["id"])

    async def gen():
        queue_state = gpu_queue.status()
        if queue_state["busy"] or queue_state["queued"] or queue_state["cooling"]:
            yield "data: " + json.dumps({"type": "status", "message": (
                "GPU cooling down - your spot is held" if queue_state["cooling"]
                else f"Waiting for a GPU slot ({queue_state['queued'] + 1} in line)")}) + "\n\n"
        await gpu_queue.acquire(current_user)
        try:
            async for kind, data in imagegen.generate_inpaint_image_stream(
                    body.positive, body.negative, CFG["comfyui_url"], checkpoint,
                    image_bytes, mask_bytes, denoise=body.denoise,
                    sampler=body.sampler or "euler", scheduler=body.scheduler or "normal",
                    steps=_clamp_steps(body.steps), cfg=body.cfg, architecture=body.architecture):
                mime = "image/jpeg" if kind == "preview" else "image/png"
                b64 = base64.b64encode(data).decode()
                yield "data: " + json.dumps({"type": kind, "image": f"data:{mime};base64,{b64}"}) + "\n\n"
            log.info("imagegen: inpaint done user=%s", current_user["username"])
        except Exception as e:
            log.warning("imagegen: inpaint failed user=%s: %s", current_user["username"], e)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        finally:
            gpu_queue.release()
            _IMAGEGEN_INFLIGHT.release(current_user["id"])

    return StreamingResponse(gen(), media_type="text/event-stream")


@api.post("/imagegen/inpaint/save")
async def save_inpaint_image(body: ImageGenSaveIn, current_user: dict = Depends(get_current_user)):
    image_bytes = _decode_reference_image(body.image)
    await validate_image(image_bytes)
    header, _, _ = body.image.partition(",")
    save_ext = ".webp" if "image/webp" in header else ".png"
    fname = f"img_{uuid.uuid4().hex[:10]}{save_ext}"
    await _write_file(os.path.join(MEDIA_DIR, fname), image_bytes)
    url = f"/media/{fname}"

    saved = await standalone_image_repo.create(
        current_user["id"], url, body.positive, body.negative,
        checkpoint=body.checkpoint, loras=[l.model_dump() for l in body.loras],
        sampler=body.sampler, scheduler=body.scheduler, steps=_clamp_steps(body.steps),
        is_img2img=True, cfg=body.cfg, upscaler=body.upscaler,
        media_type="image", source_image_id=body.source_image_id)
    log.info("imagegen: inpaint saved user=%s id=%s source_image_id=%s",
             current_user["username"], saved["id"], body.source_image_id)

    async def _flag_low_confidence(explicit: bool, confidence: int):
        await image_rating_report_repo.create(
            saved["id"], current_user["id"], explicit,
            note=f"Auto-flagged: classifier confidence {confidence}% (below 80%) on verdict {'NSFW' if explicit else 'SFW'}.",
            auto_flagged=True)
        await notification_repo.notify_admins(
            "admin_image_report", "Low-confidence image rating",
            f"An image was auto-flagged for review — the classifier was only {confidence}% confident.",
            "/admin/moderation")
    classify_image_background(image_bytes, "image/png", current_user["id"],
                              current_user.get("is_admin", False),
                              lambda: standalone_image_repo.set_explicit(saved["id"]),
                              on_done=lambda explicit: standalone_image_repo.mark_classified(saved["id"]),
                              on_low_confidence=_flag_low_confidence)
    return saved


@api.post("/imagegen/video")
async def stream_video(body: ImageGenVideoIn, current_user: dict = Depends(get_current_user)):
    """Wan2.1 text-to-video generation. Unlike standalone image gen, the
    result is persisted directly on the done event rather than via a
    separate /save step — re-running a multi-minute video job just to save
    it would waste real GPU time for no reason."""
    guest_quota.check(current_user, "videos")
    await guest_quota.record(current_user, "videos")
    if body.fps < 1:
        raise HTTPException(400, "fps must be at least 1")

    unet_name = body.unet_name or CFG.get("wan_unet_name") or None
    clip_name = body.clip_name or CFG.get("wan_clip_name") or None
    vae_name = body.vae_name or CFG.get("wan_vae_name") or None
    if not (unet_name and clip_name and vae_name):
        unets = await imagegen.list_wan_unets(CFG["comfyui_url"])
        clips = await imagegen.list_wan_clip_models(CFG["comfyui_url"])
        vaes = await imagegen.list_vaes(CFG["comfyui_url"])
        if not (unets and clips and vaes):
            raise HTTPException(400, "No Wan2.1 model files available in ComfyUI")
        # ComfyUI's UNETLoader/CLIPLoader option lists are shared across every
        # architecture that loads through them (Anima included) — with more
        # than one candidate present, guessing index 0 silently picks a
        # non-Wan file and fails deep inside KSampler with an opaque tensor
        # shape mismatch instead of here, where the actual problem is clear.
        if not unet_name:
            if len(unets) > 1:
                raise HTTPException(400,
                    "Multiple UNET files are installed in ComfyUI — set wan_unet_name in Settings "
                    "to specify which one is the Wan2.1 model.")
            unet_name = unets[0]
        if not clip_name:
            if len(clips) > 1:
                raise HTTPException(400,
                    "Multiple CLIP files are installed in ComfyUI — set wan_clip_name in Settings "
                    "to specify which one is the Wan2.1 text encoder.")
            clip_name = clips[0]
        if not vae_name:
            if len(vaes) > 1:
                raise HTTPException(400,
                    "Multiple VAE files are installed in ComfyUI — set wan_vae_name in Settings "
                    "to specify which one is the Wan2.1 VAE.")
            vae_name = vaes[0]

    log.info("imagegen: video start user=%s frames=%s fps=%s",
             current_user["username"], body.num_frames, body.fps)
    _IMAGEGEN_INFLIGHT.acquire(current_user["id"])

    async def gen():
        queue_state = gpu_queue.status()
        if queue_state["busy"] or queue_state["queued"] or queue_state["cooling"]:
            yield "data: " + json.dumps({"type": "status", "message": (
                "GPU cooling down - your spot is held" if queue_state["cooling"]
                else f"Waiting for a GPU slot ({queue_state['queued'] + 1} in line)")}) + "\n\n"
        await gpu_queue.acquire(current_user)
        try:
            video_bytes = None
            async for kind, data in imagegen.generate_video_stream(
                    body.positive, body.negative, CFG["comfyui_url"],
                    unet_name, clip_name, vae_name,
                    fps=body.fps, num_frames=body.num_frames,
                    width=body.width, height=body.height, steps=body.steps, cfg=body.cfg):
                if kind == "done":
                    video_bytes = data
                    continue
                if kind == "preview":
                    b64 = base64.b64encode(data).decode()
                    yield "data: " + json.dumps({
                        "type": "preview", "image": f"data:image/jpeg;base64,{b64}",
                    }) + "\n\n"
                    continue
                yield "data: " + json.dumps({"type": kind, "message": data}) + "\n\n"

            fname = f"vid_{uuid.uuid4().hex[:10]}.mp4"
            await _write_file(os.path.join(MEDIA_DIR, fname), video_bytes)
            url = f"/media/{fname}"
            saved = await standalone_image_repo.create(
                current_user["id"], url, body.positive, body.negative,
                is_explicit=True, media_type="video", source_image_id=None,
                fps=body.fps, frame_count=body.num_frames, duration_s=body.num_frames / body.fps,
                classified=True)
            log.info("imagegen: video done user=%s id=%s", current_user["username"], saved["id"])
            yield "data: " + json.dumps({"type": "done", "video": saved}) + "\n\n"
        except Exception as e:
            log.warning("imagegen: video failed user=%s: %s", current_user["username"], e)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        finally:
            gpu_queue.release()
            _IMAGEGEN_INFLIGHT.release(current_user["id"])

    return StreamingResponse(gen(), media_type="text/event-stream")


@api.post("/imagegen/upscale")
async def upscale_standalone_image(body: ImageGenUpscaleIn, current_user: dict = Depends(get_admin)):
    """One-shot (non-streaming) upscale — used by the admin upscaler-preview
    generator (openUpscalerPreviewModal), which just needs a single result
    image back, not a live progress feed. This endpoint was dropped by
    mistake during an earlier split of this router (the docstring on the
    /stream version below already called it out as this endpoint's "old"
    counterpart, but the route itself never got carried over), which silently
    broke the admin preview flow with a 404/405 instead of a clean upscale."""
    image_bytes = _decode_reference_image(body.image)
    if not image_bytes:
        raise HTTPException(400, "image is required")
    upscaler = body.upscaler
    if not upscaler:
        upscalers = await imagegen.list_upscalers(CFG["comfyui_url"])
        if not upscalers:
            raise HTTPException(400, "No upscaler models available")
        upscaler = upscalers[0]
    try:
        data = await imagegen.upscale_image(image_bytes, CFG["comfyui_url"], upscaler)
    except Exception as e:
        log.warning("imagegen: one-shot upscale failed by=%s upscaler=%s: %s",
                   current_user["username"], upscaler, e)
        raise HTTPException(502, f"Upscale failed: {e}")
    data = await reencode_webp(data)
    if len(data) > MAX_UPLOAD_BYTES * 3 // 4:
        raise HTTPException(413, f"Upscaled image is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB) — try a smaller source image or a less aggressive upscaler.")
    b64 = base64.b64encode(data).decode()
    log.info("imagegen: one-shot upscale done by=%s upscaler=%s", current_user["username"], upscaler)
    return {"image": f"data:image/webp;base64,{b64}"}


@api.post("/imagegen/upscale/stream")
async def upscale_standalone_image_stream(body: ImageGenUpscaleIn, current_user: dict = Depends(get_current_user)):
    """Live-preview counterpart to the old one-shot /imagegen/upscale — same
    SSE shape as /imagegen/standalone/stream (preview/done/error events) via
    imagegen.upscale_image_stream, so the client's existing sseEvents handling
    for generation works unchanged here too. See that generator's docstring
    for why a plain upscale-model pass may never actually emit a "preview"
    event — the win here is the "done" event firing the instant ComfyUI's
    websocket reports it, not up to 1s later off a poll."""
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

    async def gen():
        queue_state = gpu_queue.status()
        if queue_state["busy"] or queue_state["queued"] or queue_state["cooling"]:
            yield "data: " + json.dumps({"type": "status", "message": (
                "GPU cooling down - your spot is held" if queue_state["cooling"]
                else f"Waiting for a GPU slot ({queue_state['queued'] + 1} in line)")}) + "\n\n"
        await gpu_queue.acquire(current_user)
        try:
            async for kind, data in imagegen.upscale_image_stream(image_bytes, CFG["comfyui_url"], upscaler):
                if kind == "done":
                    # A raw PNG straight out of a 4x upscale easily blows past
                    # MAX_UPLOAD_BYTES for a detailed image, which then made the
                    # result un-savable (413) — see media.reencode_webp.
                    data = await reencode_webp(data)
                    if len(data) > MAX_UPLOAD_BYTES * 3 // 4:
                        # Headers are already committed once an SSE stream starts —
                        # there's no real HTTP status left to raise, an "error"
                        # event is the only way left to report this to the client.
                        raise RuntimeError(f"Upscaled image is too large to save (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB) — try a smaller source image or a less aggressive upscaler.")
                    mime = "image/webp"
                else:
                    mime = "image/jpeg"
                b64 = base64.b64encode(data).decode()
                yield "data: " + json.dumps({
                    "type": kind, "image": f"data:{mime};base64,{b64}",
                }) + "\n\n"
            log.info("imagegen: upscale done user=%s upscaler=%s", current_user["username"], upscaler)
        except Exception as e:
            log.warning("imagegen: upscale failed user=%s: %s", current_user["username"], e)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        finally:
            gpu_queue.release()
            _IMAGEGEN_INFLIGHT.release(current_user["id"])

    return StreamingResponse(gen(), media_type="text/event-stream")


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
    # header is "data:image/png" or "data:image/webp" (see /imagegen/upscale,
    # which now returns webp) — the saved file's extension has to match the
    # actual encoded bytes, or the static route serves it with the wrong
    # Content-Type (inferred from the filename) and some browsers refuse to
    # render it.
    save_ext = ".webp" if "image/webp" in header else ".png"
    fname = f"img_{uuid.uuid4().hex[:10]}{save_ext}"
    await _write_file(os.path.join(MEDIA_DIR, fname), data)
    url = f"/media/{fname}"
    rec = await standalone_image_repo.create(current_user["id"], url, body.positive, body.negative,
                                           checkpoint=body.checkpoint,
                                           loras=[l.model_dump() for l in body.loras],
                                           is_explicit=False, sampler=body.sampler,
                                           scheduler=body.scheduler, steps=_clamp_steps(body.steps),
                                           is_img2img=body.is_img2img, cfg=body.cfg,
                                           upscaler=body.upscaler)
    async def _flag_low_confidence(explicit: bool, confidence: int):
        await image_rating_report_repo.create(
            rec["id"], current_user["id"], explicit,
            note=f"Auto-flagged: classifier confidence {confidence}% (below 80%) on verdict {'NSFW' if explicit else 'SFW'}.",
            auto_flagged=True)
        await notification_repo.notify_admins(
            "admin_image_report", "Low-confidence image rating",
            f"An image was auto-flagged for review — the classifier was only {confidence}% confident.",
            "/admin/moderation")
    classify_image_background(data, "image/png", current_user["id"],
                              current_user.get("is_admin", False),
                              lambda: standalone_image_repo.set_explicit(rec["id"]),
                              on_done=lambda explicit: standalone_image_repo.mark_classified(rec["id"]),
                              on_low_confidence=_flag_low_confidence)
    log.info("imagegen: standalone saved user=%s image=%s", current_user["username"], rec["id"])
    return rec


@api.get("/imagegen/standalone")
async def list_standalone_images(current_user: dict = Depends(get_current_user)):
    return await standalone_image_repo.list_for_user(current_user["id"])


@api.post("/imagegen/standalone/{iid}/share")
async def share_standalone_image(iid: str, body: ImageShareIn,
                                 current_user: dict = Depends(get_current_user)):
    existing = await standalone_image_repo.get(iid)
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
    rec = await standalone_image_repo.set_public(iid, current_user["id"], True, final_explicit)
    if rec is None:
        raise HTTPException(404, "image not found")
    log.info("image shared: id=%s by=%s explicit=%s (classifier=%s, self-flagged=%s)",
             iid, current_user["username"], final_explicit, existing.get("is_explicit"), body.is_explicit)
    return rec


@api.post("/imagegen/standalone/{iid}/unshare")
async def unshare_standalone_image(iid: str, current_user: dict = Depends(get_current_user)):
    rec = await standalone_image_repo.set_public(iid, current_user["id"], False)
    if rec is None:
        raise HTTPException(404, "image not found")
    log.info("image unshared: id=%s by=%s", iid, current_user["username"])
    return rec


@api.post("/imagegen/standalone/{iid}/report")
async def report_standalone_image_rating(iid: str, body: ImageRatingReportIn,
                                         current_user: dict = Depends(get_current_user)):
    _IMAGE_REPORT_LIMIT.check_and_record(current_user["id"])
    img = await standalone_image_repo.get(iid)
    if img is None:
        raise HTTPException(404, "image not found")
    note = (body.note or "").strip()
    rep = await image_rating_report_repo.create(
        iid, current_user["id"], body.claimed_explicit, note)
    claim = "NSFW" if body.claimed_explicit else "SFW"
    # No exclude_user_id here, unlike other admin_* notifications — a rating
    # report is a moderation queue item every admin needs visibility into,
    # including one who reported it themselves (e.g. an admin/dev spotting a
    # misclassification while browsing as a regular member). Self-excluding
    # would make the report invisible to the one admin who just flagged it.
    await notification_repo.notify_admins(
        "admin_image_report", f"Image rating report: should be {claim}",
        f"{current_user['username']} reported an image should be rated {claim}.",
        "/admin", related_id=rep["id"])
    log.info("image rating report: image=%s by=%s claimed_explicit=%s",
             iid, current_user["username"], body.claimed_explicit)
    return {"ok": True}


@api.get("/imagegen/standalone/{iid}")
async def get_shared_standalone_image(iid: str, current_user: dict | None = Depends(get_current_user_optional)):
    rec = await standalone_image_repo.get_public(iid)
    if rec is None:
        raise HTTPException(404, "image not found")
    return rec


@api.get("/imagegen/community")
async def community_images(current_user: dict | None = Depends(get_current_user_optional)):
    hidden = await db.hidden_user_ids(current_user["id"]) if current_user else set()
    return await standalone_image_repo.list_community(hidden)


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
    request_type = (body.request_type if body.request_type in ("checkpoint", "lora", "upscaler", "anima", "wan")
                    else "checkpoint")
    host_allowed = 1 if _match_model_request_host(url) else 0
    req = await model_request_repo.create(current_user["id"], name, url, body.note.strip(),
                                          request_type, host_allowed,
                                          vae_url, text_encoder_url)
    await notification_repo.notify_admins(
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
    return await model_request_repo.list(user_id=current_user["id"])


@api.delete("/imagegen/standalone/{iid}")
async def delete_standalone_image(iid: str, current_user: dict = Depends(get_current_user)):
    url = await standalone_image_repo.delete(iid, current_user["id"])
    if url is None:
        raise HTTPException(404, "image not found")
    _delete_media_file(url)
    return {"deleted": True}
