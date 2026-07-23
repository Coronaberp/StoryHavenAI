"""Custom emoji and stickers — any signed-in user can upload one, same as any
other user-generated image content in the app (comment attachments, avatars):
extension-validated, size-capped, background-NSFW-classified, and rate
limited. "emoji" is typed inline as :shortcode: and rendered small within
comment text; "sticker" is sent as its own standalone attachment, never
inline. A shortcode belongs to whoever claimed it first — anyone else
uploading the same shortcode is rejected rather than silently overwriting
someone else's already-in-use emoji (see db.create_custom_emoji)."""
import os
import uuid

from fastapi import HTTPException, Depends, UploadFile, File, Form

from backend import db
from backend.repositories import emojis as custom_emoji_repo
from backend.repositories.emojis import _shape_custom_emoji
from backend.repositories import notifications as notification_repo
from backend.state import api, log, IMG_EXTS, MEDIA_DIR
from backend.auth import get_current_user, get_admin
from backend.feature_flags import require_feature_enabled
from backend.media import _save_uploaded_image, _delete_media_file, gif_blurred_preview
from backend.classify import classify_image_nsfw, _is_animated_image
from backend.ratelimit import SlidingWindow
from backend.schemas import EmojiUpdateIn

_MAX_EMOJI_DIM = 160
_MAX_STICKER_DIM = 512
# Tighter than the app-wide MAX_UPLOAD_BYTES (15MB) — these render tiny
# inline in text or as a small attachment, and animated GIFs in particular
# can be surprisingly large for how little visual real estate they get.
_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_UPLOAD_LIMIT = SlidingWindow(
    10, 300, "You're uploading too fast — please wait a moment and try again")


@api.get("/emojis")
async def list_emojis(current_user: dict = Depends(get_current_user)):
    return await custom_emoji_repo.list_all()


@api.post("/emojis")
async def upload_emoji(shortcode: str = Form(...), kind: str = Form("emoji"),
                       file: UploadFile = File(...), current_user: dict = Depends(get_current_user),
                       _feature: None = Depends(require_feature_enabled("emojis"))):
    if kind not in ("emoji", "sticker"):
        raise HTTPException(400, "kind must be 'emoji' or 'sticker'")
    _UPLOAD_LIMIT.check_and_record(current_user["id"])
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in IMG_EXTS:
        raise HTTPException(400, "unsupported file type")
    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file too large (max {_MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")
    basename = f"emo_{uuid.uuid4().hex[:12]}"
    max_dim = _MAX_STICKER_DIM if kind == "sticker" else _MAX_EMOJI_DIM
    ext = await _save_uploaded_image(data, basename, ext, allow_animated=True, max_dim=max_dim)
    image = f"/media/{basename}{ext}"
    full_path = os.path.join(MEDIA_DIR, os.path.basename(image))
    with open(full_path, "rb") as fh:
        file_data = fh.read()
    is_admin = current_user.get("is_admin", False)
    # Animated GIFs are never trusted to the classifier at all (see
    # chat_service.classify_image_nsfw — it only ever sees one static frame of
    # an animation) and never auto-approved, even for the uploader's own use:
    # they're stored pre-flagged NSFW with a blurred single-frame stand-in
    # served in place of the real file until an admin reviews it directly and
    # approves it (or deletes it, if the review confirms it's actually NSFW).
    # Admins uploading their own GIF are trusted the same way they're trusted
    # elsewhere in the app (e.g. the SSRF private-IP exemption) — skipped here.
    if not is_admin and _is_animated_image(file_data):
        preview_bytes = await gif_blurred_preview(file_data, max_dim=max_dim)
        preview_basename = f"{basename}_prev.webp"
        with open(os.path.join(MEDIA_DIR, preview_basename), "wb") as fh:
            fh.write(preview_bytes)
        preview_image = f"/media/{preview_basename}"
        row = await custom_emoji_repo.create(shortcode, image, kind, current_user["id"],
                                           is_explicit=True, preview_image=preview_image)
        if row is None:
            _delete_media_file(image)
            _delete_media_file(preview_image)
            raise HTTPException(400, "invalid shortcode, or it's already taken by another user")
        await notification_repo.notify_admins(
            "admin_image_report", "Animated GIF sticker/emoji needs review",
            f"{current_user['username']} uploaded a {kind} (:{row['shortcode']}:) as an animated GIF — "
            "the NSFW classifier can't judge animations, so it's pre-flagged and blurred pending your review.",
            "/admin/emojis")
        log.info("%s uploaded by=%s shortcode=%s (animated GIF, pending admin review)",
                 kind, current_user["username"], row["shortcode"])
        return row
    # Unlike a one-off comment attachment, an emoji/sticker becomes a small,
    # widely-reused piece of chrome (typed inline, offered to everyone in the
    # picker) — so this blocks on the classifier synchronously rather than the
    # usual fire-and-forget flow. A flagged static image is never silently
    # rejected/discarded outright, though (that gave the uploader no path
    # forward besides guessing at a different image) — it's saved the same
    # way an animated GIF is: pre-flagged NSFW, blurred in the public picker
    # via the normal is_explicit blur treatment, and queued for an admin to
    # actually look at and approve or delete.
    mime = "image/gif" if image.endswith(".gif") else "image/webp" if image.endswith(".webp") else "image/png"
    explicit, _confidence = await classify_image_nsfw(file_data, mime, current_user["id"], is_admin)
    row = await custom_emoji_repo.create(shortcode, image, kind, current_user["id"], is_explicit=explicit)
    if row is None:
        _delete_media_file(image)
        raise HTTPException(400, "invalid shortcode, or it's already taken by another user")
    if explicit and not is_admin:
        await notification_repo.notify_admins(
            "admin_image_report", "Sticker/emoji flagged NSFW — needs review",
            f"{current_user['username']} uploaded a {kind} (:{row['shortcode']}:) that the NSFW classifier "
            "flagged — it's blurred pending your review.",
            "/admin/emojis")
        log.info("%s uploaded by=%s shortcode=%s (flagged NSFW, pending admin review)",
                 kind, current_user["username"], row["shortcode"])
    else:
        log.info("%s uploaded by=%s shortcode=%s", kind, current_user["username"], row["shortcode"])
    return row


@api.delete("/emojis/{eid}")
async def delete_emoji(eid: str, current_user: dict = Depends(get_current_user)):
    row = await custom_emoji_repo.get(eid, admin_view=True)
    if not row:
        raise HTTPException(404, "not found")
    if row["uploader_id"] != current_user["id"] and not current_user.get("is_admin", False):
        raise HTTPException(403, "Not authorized")
    _delete_media_file(row.get("image"))
    _delete_media_file(row.get("preview_image"))
    await custom_emoji_repo.delete(eid)
    log.info("custom emoji/sticker deleted id=%s by=%s", eid, current_user["username"])
    return {"deleted": True}


@api.get("/admin/emojis")
async def admin_list_emojis(_: dict = Depends(get_admin)):
    """True (unblurred) images, for the admin review panel — see
    db._shape_custom_emoji for why the regular GET /emojis doesn't return these."""
    return await custom_emoji_repo.list_all(admin_view=True)


@api.post("/admin/emojis/{eid}/approve")
async def admin_approve_emoji(eid: str, current_user: dict = Depends(get_admin)):
    row = await custom_emoji_repo.get(eid, admin_view=True)
    if not row:
        raise HTTPException(404, "not found")
    await custom_emoji_repo.approve(eid)
    _delete_media_file(row.get("preview_image"))
    log.info("admin: emoji/sticker approved by=%s shortcode=%s", current_user["username"], row["shortcode"])
    return {"approved": True}


@api.patch("/admin/emojis/{eid}")
async def admin_update_emoji(eid: str, body: EmojiUpdateIn, current_user: dict = Depends(get_admin)):
    if body.kind is not None and body.kind not in ("emoji", "sticker"):
        raise HTTPException(400, "kind must be 'emoji' or 'sticker'")
    row = await custom_emoji_repo.update(eid, body.shortcode, body.kind)
    if not row:
        raise HTTPException(400, "not found, or shortcode invalid/already taken")
    log.info("admin: emoji/sticker updated id=%s by=%s shortcode=%s", eid, current_user["username"], row["shortcode"])
    return _shape_custom_emoji(row, admin_view=True)
