import os
import re
import uuid

import httpx
from fastapi import HTTPException, Depends, UploadFile, File
from fastapi.responses import PlainTextResponse

from backend import db
from backend.repositories import standalone_images as standalone_image_repo
from backend.repositories import comments as comment_repo
from backend.repositories import emojis as custom_emoji_repo
from backend.repositories import forum as forum_thread_repo
from backend.repositories import notifications as notification_repo
from backend.state import api, log, IMG_EXTS, MEDIA_DIR, CFG
from backend.auth import get_current_user, get_current_user_optional
from backend.feature_flags import require_feature_enabled
from backend.schemas import CommentIn, CommentEditIn, CommentReactIn, GiphySendIn
from backend.ratelimit import SlidingWindow
from backend.media import _save_uploaded_image, _write_file, _check_upload_size
from backend.classify import classify_image_background

ALLOWED_TARGETS = ("character", "user", "image", "thread")
_MENTION_RE = re.compile(r"(?<!\w)@([A-Za-z0-9_-]{2,32})")
_MENTION_ALIASES = {"dev": "zukaarimoto"}

_COMMENT_LIMIT = SlidingWindow(
    20, 60, "You're posting too fast — please wait a moment and try again")

_COMMENT_IMAGE_LIMIT = SlidingWindow(
    10, 300, "You're uploading too fast — please wait a moment and try again")
_GIPHY_SEARCH_LIMIT = SlidingWindow(
    30, 60, "You're searching too fast — please wait a moment and try again")

_REACTION_LIMIT = SlidingWindow(
    60, 60, "You're doing that too fast — please wait a moment and try again")

_VIDEO_EXTS = {".mp4", ".webm", ".mov"}
_MAX_VIDEO_BYTES = 50 * 1024 * 1024

_TEXT_EXTS = {
    ".txt": "text", ".md": "markdown",
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".jsx": "jsx", ".tsx": "tsx", ".java": "java", ".c": "c", ".h": "c",
    ".cpp": "cpp", ".hpp": "cpp", ".cs": "csharp", ".go": "go", ".rs": "rust",
    ".rb": "ruby", ".php": "php", ".html": "html", ".css": "css",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".sh": "bash",
    ".sql": "sql", ".xml": "xml", ".swift": "swift", ".kt": "kotlin",
}
_MAX_TEXT_BYTES = 256 * 1024

def _attachment_kind_for_ext(ext: str) -> str | None:
    if ext in IMG_EXTS:
        return "image"
    if ext in _VIDEO_EXTS:
        return "video"
    if ext in _TEXT_EXTS:
        return "text"
    return None

@api.post("/comments/upload-image")
async def upload_comment_attachment(file: UploadFile = File(...),
                                    current_user: dict = Depends(get_current_user)):
    _COMMENT_IMAGE_LIMIT.check_and_record(current_user["id"])
    ext = os.path.splitext(file.filename or "")[1].lower()
    kind = _attachment_kind_for_ext(ext)
    if kind is None:
        raise HTTPException(400, "unsupported file type")
    data = await file.read()
    basename = f"cmt_{uuid.uuid4().hex[:12]}"

    if kind == "image":
        ext = await _save_uploaded_image(data, basename, ext, allow_animated=True)
        url = f"/media/{basename}{ext}"
        log.info("comment image uploaded by=%s url=%s", current_user["username"], url)
        return {"image": url, "attachment_kind": "image"}

    if kind == "video":
        _check_upload_size(data)
        if len(data) > _MAX_VIDEO_BYTES:
            raise HTTPException(413, f"video too large (max {_MAX_VIDEO_BYTES // (1024 * 1024)}MB)")

        sig_ok = (data[4:12] in (b"ftypisom", b"ftypmp42", b"ftypmp41", b"ftypqt  ") if ext in (".mp4", ".mov")
                 else data[:4] == b"\x1a\x45\xdf\xa3" if ext == ".webm" else False)
        if not sig_ok:
            raise HTTPException(400, "file doesn't look like a valid video")
        fname = f"{basename}{ext}"
        await _write_file(os.path.join(MEDIA_DIR, fname), data)
        url = f"/media/{fname}"
        log.info("comment video uploaded by=%s url=%s", current_user["username"], url)
        return {"image": url, "attachment_kind": "video"}

    if len(data) > _MAX_TEXT_BYTES:
        raise HTTPException(413, f"file too large (max {_MAX_TEXT_BYTES // 1024}KB)")
    if b"\x00" in data:
        raise HTTPException(400, "file doesn't look like plain text")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "file must be valid UTF-8 text")
    fname = f"{basename}{ext}"
    await _write_file(os.path.join(MEDIA_DIR, fname), data)
    log.info("comment text attachment uploaded by=%s file=%s", current_user["username"], fname)
    return {"image": fname, "attachment_kind": "text"}

@api.get("/comments/attachment-text/{fname}")
async def get_comment_attachment_text(fname: str):
    base = os.path.basename(fname)
    if not base.startswith("cmt_") or os.path.splitext(base)[1].lower() not in _TEXT_EXTS:
        raise HTTPException(404, "not found")
    path = os.path.join(MEDIA_DIR, base)
    if not os.path.exists(path):
        raise HTTPException(404, "not found")
    with open(path, "rb") as fh:
        data = fh.read()
    return PlainTextResponse(data.decode("utf-8", errors="replace"))

_GIPHY_BASE = "https://api.giphy.com/v1/gifs"
_GIPHY_RATING = "pg-13"
_GIPHY_CLEARED_MEDIA: set[str] = set()

def _giphy_gif_summary(g: dict) -> dict:
    images = g.get("images", {})
    preview = images.get("fixed_width_small", {}) or images.get("fixed_width", {})
    return {
        "id": g.get("id", ""),
        "title": g.get("title", ""),
        "preview_url": preview.get("url", ""),
        "width": preview.get("width", ""),
        "height": preview.get("height", ""),
    }

async def _giphy_get(path: str, params: dict) -> dict:
    if not CFG.get("giphy_api_key"):
        raise HTTPException(503, "GIF search isn't configured on this server yet.")
    params = {**params, "api_key": CFG["giphy_api_key"], "rating": _GIPHY_RATING}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            res = await client.get(f"{_GIPHY_BASE}/{path}", params=params)
        except httpx.HTTPError as e:
            log.warning("comments: giphy %s request failed: %s: %s", path, type(e).__name__, e)
            raise HTTPException(502, "Couldn't reach Giphy right now.")
    if res.status_code != 200:
        log.warning("comments: giphy %s returned %s", path, res.status_code)
        raise HTTPException(502, "Couldn't reach Giphy right now.")
    return res.json()

@api.get("/comments/giphy/trending")
async def giphy_trending(limit: int = 24, current_user: dict = Depends(get_current_user)):
    _GIPHY_SEARCH_LIMIT.check_and_record(current_user["id"])
    data = await _giphy_get("trending", {"limit": min(max(limit, 1), 48)})
    return {"results": [_giphy_gif_summary(g) for g in data.get("data", [])]}

@api.get("/comments/giphy/search")
async def giphy_search(q: str, limit: int = 24, current_user: dict = Depends(get_current_user)):
    _GIPHY_SEARCH_LIMIT.check_and_record(current_user["id"])
    q = q.strip()
    if not q:
        return {"results": []}
    data = await _giphy_get("search", {"q": q, "limit": min(max(limit, 1), 48)})
    return {"results": [_giphy_gif_summary(g) for g in data.get("data", [])]}

@api.post("/comments/giphy/send")
async def giphy_send(body: GiphySendIn, current_user: dict = Depends(get_current_user)):
    _COMMENT_IMAGE_LIMIT.check_and_record(current_user["id"])
    gif_id = re.sub(r"[^a-zA-Z0-9]", "", body.id)[:64]
    if not gif_id:
        raise HTTPException(400, "invalid gif id")
    data = await _giphy_get(f"{gif_id}", {})
    images = data.get("data", {}).get("images", {})
    original = images.get("original", {})
    url = original.get("url", "")
    if not url or not url.startswith("https://media"):
        raise HTTPException(502, "That GIF isn't available right now.")
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            res = await client.get(url)
        except httpx.HTTPError as e:
            log.warning("comments: giphy download failed id=%s: %s: %s", gif_id, type(e).__name__, e)
            raise HTTPException(502, "Couldn't download that GIF.")
    if res.status_code != 200:
        raise HTTPException(502, "Couldn't download that GIF.")
    basename = f"cmt_{uuid.uuid4().hex[:12]}"
    ext = await _save_uploaded_image(res.content, basename, ".gif", allow_animated=True)
    url = f"/media/{basename}{ext}"
    _GIPHY_CLEARED_MEDIA.add(url)
    log.info("comment gif sent by=%s giphy_id=%s url=%s", current_user["username"], gif_id, url)
    return {"image": url, "attachment_kind": "image"}

async def _resolve_target_owner(target_type: str, target_id: str) -> str | None:
    if target_type == "character":
        c = await db.get_character(target_id)
        return c.get("owner_id") if c else None
    if target_type == "image":
        img = await standalone_image_repo.get(target_id)
        return img.get("user_id") if img else None
    if target_type == "thread":
        th = await forum_thread_repo.get(target_id)
        return th.get("author_id") if th else None
    u = await db.get_user_by_username(target_id)
    if not u or u.get("status") != "active":
        return None
    return u["id"]

@api.get("/comments")
async def get_comments(target_type: str, target_id: str,
                       current_user: dict | None = Depends(get_current_user_optional)):
    if target_type not in ALLOWED_TARGETS:
        raise HTTPException(400, "invalid target_type")
    viewer_id = current_user["id"] if current_user else None
    return await comment_repo.list_for_target(target_type, target_id, viewer_id)

_COMMENT_IMAGE_RE = re.compile(r"^/media/cmt_[0-9a-f]{12}\.(png|jpe?g|gif|webp)$")
_COMMENT_VIDEO_RE = re.compile(r"^/media/cmt_[0-9a-f]{12}\.(mp4|webm|mov)$")
_COMMENT_TEXT_RE = re.compile(r"^cmt_[0-9a-f]{12}\.(" + "|".join(e[1:] for e in _TEXT_EXTS) + ")$")

_COMMENT_STICKER_RE = re.compile(r"^/media/emo_[0-9a-f]{12}\.(png|jpe?g|gif|webp)$")
_ATTACHMENT_RE_BY_KIND = {"image": _COMMENT_IMAGE_RE, "video": _COMMENT_VIDEO_RE, "text": _COMMENT_TEXT_RE}

@api.post("/comments")
async def post_comment(body: CommentIn, current_user: dict = Depends(get_current_user),
                       _feature_ok: None = Depends(require_feature_enabled("comments"))):
    if body.target_type not in ALLOWED_TARGETS:
        raise HTTPException(400, "invalid target_type")
    _COMMENT_LIMIT.check_and_record(current_user["id"])
    content = (body.content or "").strip()

    image = (body.image or "").strip()
    kind = body.attachment_kind if body.attachment_kind in _ATTACHMENT_RE_BY_KIND else ""
    if image:
        if kind == "image" and _COMMENT_STICKER_RE.match(image):
            if not await custom_emoji_repo.get_sticker_by_image(image):
                raise HTTPException(400, "invalid attachment reference")
        elif not kind or not _ATTACHMENT_RE_BY_KIND[kind].match(image):
            raise HTTPException(400, "invalid attachment reference")
    else:
        kind = ""
    if not content and not image:
        raise HTTPException(400, "content or image is required")
    owner_id = await _resolve_target_owner(body.target_type, body.target_id)
    if owner_id is None:
        raise HTTPException(404, "target not found")
    if owner_id != current_user["id"] and await db.is_block_between(owner_id, current_user["id"]):
        raise HTTPException(403, "You cannot comment here.")
    parent_id = body.parent_id or None
    parent = None
    if parent_id:
        parent = await comment_repo.get(parent_id)
        if (not parent or parent["target_type"] != body.target_type
                or parent["target_id"] != body.target_id):
            raise HTTPException(400, "invalid parent")
    cid = await comment_repo.create(body.target_type, body.target_id,
                                  current_user["id"], parent_id, content, image, kind)
    if image and kind == "image":
        sticker = await custom_emoji_repo.get_sticker_by_image(image)
        if sticker:

            if sticker.get("is_explicit"):
                await comment_repo.set_explicit(cid)
        elif image in _GIPHY_CLEARED_MEDIA:
            _GIPHY_CLEARED_MEDIA.discard(image)
            log.info("comment gif from giphy (rating-capped) skips review: comment=%s", cid)
        else:
            path = os.path.join(MEDIA_DIR, os.path.basename(image))
            if os.path.exists(path):
                with open(path, "rb") as fh:
                    data = fh.read()
                mime = "image/gif" if image.endswith(".gif") else "image/webp" if image.endswith(".webp") else "image/png"
                classify_image_background(data, mime, current_user["id"],
                                          current_user.get("is_admin", False),
                                          lambda: comment_repo.set_explicit(cid),
                                          review_context="a comment attachment")
    await _notify_comment_owner(body.target_type, body.target_id, owner_id,
                                current_user, content, cid)
    mentioned = await _notify_mentioned_users(body.target_type, body.target_id, owner_id,
                                             current_user, content, cid)
    if parent:
        await _notify_reply_parent_author(body.target_type, body.target_id, parent,
                                          owner_id, current_user, content, cid, mentioned)
    log.info("comment created: id=%s by=%s target=%s:%s", cid, current_user["username"],
             body.target_type, body.target_id)
    return await comment_repo.get_view(cid, current_user["id"])

def _comment_title_link(target_type: str, target_id: str, target_extra: dict | None) -> tuple[str, str]:
    if target_type == "character":
        name = target_extra["name"] if target_extra else "a character"
        return name, f"/c/{target_id}"
    if target_type == "image":
        return "an image", "/images"
    if target_type == "thread":
        name = target_extra["title"] if target_extra else "a forum thread"
        return name, f"/forum/{target_id}"
    return "a profile", f"/u/{target_id}"

async def _comment_target_extra(target_type: str, target_id: str) -> dict | None:
    if target_type == "character":
        return await db.get_character(target_id)
    if target_type == "thread":
        return await forum_thread_repo.get(target_id)
    return None

async def _notify_comment_owner(target_type: str, target_id: str, owner_id: str,
                                author: dict, content: str, comment_id: str):
    if owner_id == author["id"]:
        return
    excerpt = content[:140]
    extra = await _comment_target_extra(target_type, target_id)
    name, link = _comment_title_link(target_type, target_id, extra)
    subject = "your image" if target_type == "image" else ("your profile" if target_type == "user" else name)
    await notification_repo.create(owner_id, "comment", f"New comment on {subject}", excerpt, link,
                                 related_id=comment_id)

async def _notify_mentioned_users(target_type: str, target_id: str, owner_id: str,
                                  author: dict, content: str, comment_id: str) -> set[str]:
    usernames = {m.group(1).lower() for m in _MENTION_RE.finditer(content)}
    notified = set()
    if not usernames:
        return notified
    extra = await _comment_target_extra(target_type, target_id)
    name, link = _comment_title_link(target_type, target_id, extra)
    excerpt = content[:140]
    for uname in usernames:
        u = await db.get_user_by_username(_MENTION_ALIASES.get(uname, uname))
        if not u or u.get("status") != "active":
            continue
        if u["id"] == author["id"] or u["id"] in notified:
            continue
        notified.add(u["id"])
        await notification_repo.create(
            u["id"], "mention", f"{author['username']} mentioned you",
            excerpt, link, related_id=comment_id)
    return notified

async def _notify_reply_parent_author(target_type: str, target_id: str, parent: dict,
                                      owner_id: str, author: dict, content: str,
                                      comment_id: str, already_notified: set[str]):
    parent_author_id = parent["author_id"]
    if parent_author_id == author["id"] or parent_author_id == owner_id or parent_author_id in already_notified:
        return
    extra = await _comment_target_extra(target_type, target_id)
    name, link = _comment_title_link(target_type, target_id, extra)
    excerpt = content[:140]
    await notification_repo.create(
        parent_author_id, "comment_reply", f"{author['username']} replied to your comment",
        excerpt, link, related_id=comment_id)

@api.delete("/comments/{cid}")
async def delete_comment(cid: str, current_user: dict = Depends(get_current_user)):
    c = await comment_repo.get(cid)
    if not c:
        raise HTTPException(404, "comment not found")
    allowed = c["author_id"] == current_user["id"] or current_user["is_admin"]
    if not allowed and c["target_type"] in ("character", "image", "thread"):
        owner_id = await _resolve_target_owner(c["target_type"], c["target_id"])
        allowed = owner_id == current_user["id"]
    if not allowed:
        raise HTTPException(403, "Not authorized")
    await comment_repo.delete(cid)
    log.info("comment deleted: id=%s by=%s author=%s", cid, current_user["username"], c["author_id"])
    return {"deleted": True}

@api.put("/comments/{cid}")
async def edit_comment(cid: str, body: CommentEditIn, current_user: dict = Depends(get_current_user)):
    c = await comment_repo.get(cid)
    if not c:
        raise HTTPException(404, "comment not found")
    if c["author_id"] != current_user["id"]:
        raise HTTPException(403, "Not authorized")
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(400, "content is required")
    await comment_repo.update(cid, content)
    log.info("comment edited: id=%s by=%s", cid, current_user["username"])
    return await comment_repo.get_view(cid, current_user["id"])

@api.post("/comments/{cid}/like")
async def like_comment(cid: str, current_user: dict = Depends(get_current_user)):
    _REACTION_LIMIT.check_and_record(current_user["id"])
    if not await comment_repo.get(cid):
        raise HTTPException(404, "comment not found")
    await comment_repo.like(cid, current_user["id"])
    log.info("comment liked: id=%s by=%s", cid, current_user["username"])
    return {"liked": True, "like_count": await comment_repo.like_count(cid)}

@api.delete("/comments/{cid}/like")
async def unlike_comment(cid: str, current_user: dict = Depends(get_current_user)):
    _REACTION_LIMIT.check_and_record(current_user["id"])
    await comment_repo.unlike(cid, current_user["id"])
    log.info("comment unliked: id=%s by=%s", cid, current_user["username"])
    return {"liked": False, "like_count": await comment_repo.like_count(cid)}

REACTION_EMOJI = {"👍", "👎", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥", "👀"}

_SUPER_REACTION_LIMIT = SlidingWindow(
    5, 300, "You're out of Super Reactions for now — try again in a few minutes")

@api.post("/comments/{cid}/react")
async def react_to_comment(cid: str, body: CommentReactIn, current_user: dict = Depends(get_current_user)):
    _REACTION_LIMIT.check_and_record(current_user["id"])
    if body.emoji not in REACTION_EMOJI:
        raise HTTPException(400, f"emoji must be one of {sorted(REACTION_EMOJI)}")
    if not await comment_repo.get(cid):
        raise HTTPException(404, "comment not found")
    if body.super:
        _SUPER_REACTION_LIMIT.check_and_record(current_user["id"])
    await comment_repo.react(cid, current_user["id"], body.emoji, body.super)
    log.info("comment reacted: id=%s by=%s emoji=%s super=%s", cid, current_user["username"],
             body.emoji, body.super)
    return await comment_repo.get_view(cid, current_user["id"])

@api.delete("/comments/{cid}/react")
async def unreact_to_comment(cid: str, body: CommentReactIn, current_user: dict = Depends(get_current_user)):
    _REACTION_LIMIT.check_and_record(current_user["id"])
    await comment_repo.unreact(cid, current_user["id"], body.emoji)
    log.info("comment unreacted: id=%s by=%s emoji=%s", cid, current_user["username"], body.emoji)
    return await comment_repo.get_view(cid, current_user["id"])
