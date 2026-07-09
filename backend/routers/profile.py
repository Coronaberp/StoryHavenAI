"""Creator profile pages, profile update, banner/avatar upload."""
import os
import json
import time
import re as _re_mod

from fastapi import UploadFile, File, HTTPException, Depends

from backend import db
from backend.state import api, IMG_EXTS, log
from backend.auth import get_current_user, get_current_user_optional
from backend.media import _save_uploaded_image
from backend.chat_service import classify_image_background
from backend.schemas import ProfileIn, BlockIn

@api.get("/users")
async def list_public_users(q: str | None = None,
                            current_user: dict | None = Depends(get_current_user_optional)):
    """Public creator directory (works for anon like the community char listing).
    Only surfaces users who've published something publicly. Hides users the
    viewer has blocked / been blocked by, mirroring the character listing."""
    rows = await db.list_public_users(q)
    if current_user:
        hidden = await db.hidden_user_ids(current_user["id"])
        if hidden:
            rows = [u for u in rows if u["id"] not in hidden]
    return [{k: v for k, v in u.items() if k != "id"} for u in rows]


@api.get("/users/{username}")
async def public_profile(username: str, current_user: dict = Depends(get_current_user)):
    """Public creator page: profile fields + their community characters. Never
    exposes email-like or auth data — _user_row already strips the hash."""
    u = await db.get_user_by_username(username)
    if not u or u.get("status") != "active":
        raise HTTPException(404, "user not found")
    if current_user["id"] != u["id"] and await db.is_block_between(current_user["id"], u["id"]):
        raise HTTPException(404, "user not found")
    chars = await db.public_characters_by_owner(u["id"])
    try:
        social_links = json.loads(u.get("social_links") or "{}")
    except (json.JSONDecodeError, TypeError):
        social_links = {}
    # get_user_by_username returns the raw row (it also serves login/password
    # verification, which needs the undecrypted row) — bio is encrypted at
    # rest, so it must be decrypted here before going out over the API.
    return {
        "id": u["id"],
        "username": u["username"],
        "blocked_by_viewer": await db.has_blocked(current_user["id"], u["id"]),
        "display_name": db._decrypt_secret(u.get("display_name") or ""),
        "bio": db._decrypt_secret(u.get("bio") or ""),
        "avatar": u.get("avatar") or "",
        "banner_color": u.get("banner_color") or "",
        "accent_color": u.get("accent_color") or "",
        "banner_img": u.get("banner_img") or "",
        "is_explicit": bool(u.get("is_explicit")),
        "social_links": social_links,
        "profile_html": db._decrypt_secret(u.get("profile_html") or ""),
        "is_admin": u["is_admin"],
        "title": u.get("title") if (u.get("title_status") == "approved"
                                     or current_user["id"] == u["id"]) else "",
        "title_status": u.get("title_status") if current_user["id"] == u["id"] else (
            "approved" if u.get("title_status") == "approved" else "none"),
        "joined": u.get("created"),
        "characters": chars,
        "stats": {"characters": len(chars), "chats": sum(c.get("chats", 0) for c in chars)},
    }


SOCIAL_LINK_KEYS = ("twitter", "twitch", "instagram", "discord", "pixiv", "youtube", "patreon", "kofi")


@api.put("/me/profile")
async def update_my_profile(body: ProfileIn, current_user: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)
    if "display_name" in data:
        data["display_name"] = (data["display_name"] or "").strip()[:48]
    if "bio" in data:
        data["bio"] = (data["bio"] or "").strip()[:600]
    for ck in ("banner_color", "accent_color"):
        if ck in data:
            v = (data[ck] or "").strip()
            if v and not _re_mod.fullmatch(r"#[0-9a-fA-F]{3,8}", v):
                raise HTTPException(400, f"{ck} must be a hex color")
            data[ck] = v
    if "social_links" in data:
        links = data["social_links"] or {}
        data["social_links"] = {k: v.strip()[:300] for k, v in links.items()
                                if k in SOCIAL_LINK_KEYS and (v or "").strip()}
    if "profile_html" in data:
        data["profile_html"] = data["profile_html"] or ""
        if data["profile_html"].strip():
            if "{{share}}" not in data["profile_html"]:
                raise HTTPException(400, "profile_html must include a {{share}} placeholder")
            if "{{edit}}" not in data["profile_html"]:
                raise HTTPException(400, "profile_html must include an {{edit}} placeholder")
            if "{{comments}}" not in data["profile_html"]:
                raise HTTPException(400, "profile_html must include a {{comments}} placeholder")
            if "{{block}}" not in data["profile_html"]:
                raise HTTPException(400, "profile_html must include a {{block}} placeholder")
    if "title" in data:
        title = (data["title"] or "").strip()[:32]
        if _re_mod.search(r"[<>]", title):
            raise HTTPException(400, "title must not contain HTML")
        data["title"] = title
        current = await db.get_user_by_id(current_user["id"])
        if title and title != (current.get("title") or ""):
            data["title_status"] = "pending"
        elif not title:
            data["title_status"] = "none"
    await db.update_user_profile(current_user["id"], data)
    if data.get("title_status") == "pending":
        await db.notify_admins(
            "admin_title_request",
            f"Title request: {current_user['username']}",
            f"{current_user['username']} requested the custom title \"{data['title']}\".",
            "/admin", exclude_user_id=current_user["id"])
    return await db.get_user_by_id(current_user["id"])


@api.post("/me/banner")
async def upload_my_banner(file: UploadFile = File(...),
                           current_user: dict = Depends(get_current_user)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = ".png"
    data = await file.read()
    ext = await _save_uploaded_image(data, f"ub_{current_user['id']}", ext, allow_animated=False)
    url = f"/media/ub_{current_user['id']}{ext}?v={int(time.time())}"
    await db.update_user_profile(current_user["id"], {"banner_img": url})
    if not current_user.get("is_explicit"):
        uid = current_user["id"]
        classify_image_background(data, "image/png", uid, current_user.get("is_admin", False),
                                  lambda: db.update_user_profile(uid, {"is_explicit": 1}),
                                  review_context="a profile banner")
    return {"banner_img": url}


@api.post("/me/avatar")
async def upload_my_avatar(file: UploadFile = File(...),
                           current_user: dict = Depends(get_current_user)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in IMG_EXTS:
        ext = ".png"
    data = await file.read()
    ext = await _save_uploaded_image(data, f"u_{current_user['id']}", ext)
    url = f"/media/u_{current_user['id']}{ext}?v={int(time.time())}"
    await db.update_user_profile(current_user["id"], {"avatar": url})
    if not current_user.get("is_explicit"):
        uid = current_user["id"]
        classify_image_background(data, "image/png", uid, current_user.get("is_admin", False),
                                  lambda: db.update_user_profile(uid, {"is_explicit": 1}),
                                  review_context="a profile avatar")
    return {"avatar": url}



@api.post("/users/{username}/block")
async def block_user_route(username: str, body: BlockIn,
                           current_user: dict = Depends(get_current_user)):
    u = await db.get_user_by_username(username)
    if not u or u.get("status") != "active":
        raise HTTPException(404, "user not found")
    if u["id"] == current_user["id"]:
        raise HTTPException(400, "You cannot block yourself.")
    await db.block_user(current_user["id"], u["id"], (body.reason or "").strip()[:500])
    removed = await db.delete_comments_by_author_on_owner(
        u["id"], current_user["id"], current_user["username"])
    log.info("user blocked: by=%s blocked=%s removed_comments=%s",
             current_user["username"], u["username"], removed)
    return {"blocked": True, "removed_comments": removed}


@api.post("/users/{username}/unblock")
async def unblock_user_route(username: str,
                             current_user: dict = Depends(get_current_user)):
    u = await db.get_user_by_username(username)
    if not u:
        raise HTTPException(404, "user not found")
    await db.unblock_user(current_user["id"], u["id"])
    log.info("user unblocked: by=%s unblocked=%s", current_user["username"], u["username"])
    return {"blocked": False}


@api.get("/me/blocked")
async def my_blocked(current_user: dict = Depends(get_current_user)):
    return await db.list_blocked(current_user["id"])
