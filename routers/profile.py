"""Creator profile pages, profile update, banner/avatar upload."""
import os
import json
import time
import re as _re_mod

from fastapi import UploadFile, File, HTTPException, Depends

import db
from state import api, IMG_EXTS
from auth import get_current_user
from media import _save_uploaded_image
from schemas import ProfileIn

@api.get("/users/{username}")
async def public_profile(username: str, _: dict = Depends(get_current_user)):
    """Public creator page: profile fields + their community characters. Never
    exposes email-like or auth data — _user_row already strips the hash."""
    u = await db.get_user_by_username(username)
    if not u or u.get("status") != "active":
        raise HTTPException(404, "user not found")
    chars = await db.public_characters_by_owner(u["id"])
    try:
        social_links = json.loads(u.get("social_links") or "{}")
    except (json.JSONDecodeError, TypeError):
        social_links = {}
    return {
        "username": u["username"],
        "display_name": u.get("display_name") or "",
        "bio": u.get("bio") or "",
        "avatar": u.get("avatar") or "",
        "banner_color": u.get("banner_color") or "",
        "accent_color": u.get("accent_color") or "",
        "banner_img": u.get("banner_img") or "",
        "social_links": social_links,
        "profile_html": u.get("profile_html") or "",
        "is_admin": u["is_admin"],
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
    await db.update_user_profile(current_user["id"], data)
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
    return {"avatar": url}

