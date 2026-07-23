"""Creator profile pages, profile update, banner/avatar upload."""
import os
import json
import time
import re as _re_mod

from fastapi import UploadFile, File, HTTPException, Depends

from backend import db
from backend import guest_quota
from backend.state import api, IMG_EXTS, log
from backend.auth import get_current_user, get_current_user_optional
from backend.feature_flags import require_feature_enabled
from backend.media import _save_uploaded_image
from backend.classify import classify_image_background
from backend.schemas import ProfileIn, BlockIn
from backend.repositories import users as user_repo
from backend.repositories import blocks as block_repo
from backend.repositories import follows as follow_repo
from backend.repositories import comments as comment_repo
from backend.repositories import notifications as notification_repo
from backend.ratelimit import SlidingWindow

# Same tighter cap as comment-attachment uploads (backend/routers/comments.py)
# — a profile image upload is a full encode/decode/NSFW-classify round-trip,
# not just a cheap metadata write, and was previously the only upload endpoint
# in the app with no rate limit at all.
_PROFILE_IMAGE_LIMIT = SlidingWindow(
    10, 300, "You're uploading too fast — please wait a moment and try again")

@api.get("/users")
async def list_public_users(q: str | None = None,
                            current_user: dict | None = Depends(get_current_user_optional)):
    """Public creator directory (works for anon like the community char listing).
    Only surfaces users who've published something publicly. Hides users the
    viewer has blocked / been blocked by, mirroring the character listing."""
    rows = await db.list_public_users(q)
    following_ids = set()
    if current_user:
        hidden = await block_repo.hidden_user_ids(current_user["id"])
        if hidden:
            rows = [u for u in rows if u["id"] not in hidden]
        following_ids = set(await follow_repo.following_ids(current_user["id"]))
    return [{**{k: v for k, v in u.items() if k != "id"}, "following": u["id"] in following_ids} for u in rows]


@api.get("/users/{username}")
async def public_profile(username: str, current_user: dict | None = Depends(get_current_user_optional)):
    """Public creator page: profile fields + their community characters. Never
    exposes email-like or auth data — _user_row already strips the hash.
    Viewable while logged out (matches character/image public pages) — the
    viewer-relative fields (blocked_by_viewer, own-title visibility) simply
    fall back to their anonymous defaults."""
    u = await user_repo.get_user_by_username(username)
    if not u or u.get("status") != "active":
        raise HTTPException(404, "user not found")
    if current_user and current_user["id"] != u["id"] and await block_repo.is_block_between(current_user["id"], u["id"]):
        raise HTTPException(404, "user not found")
    chars = await user_repo.public_characters_by_owner(u["id"])
    try:
        social_links = json.loads(u.get("social_links") or "{}")
    except (json.JSONDecodeError, TypeError):
        social_links = {}
    is_self = bool(current_user) and current_user["id"] == u["id"]
    # get_user_by_username returns the raw row (it also serves login/password
    # verification, which needs the undecrypted row) — bio is encrypted at
    # rest, so it must be decrypted here before going out over the API.
    return {
        "id": u["id"],
        "username": u["username"],
        "blocked_by_viewer": await block_repo.has_blocked(current_user["id"], u["id"]) if current_user else False,
        "following": bool(current_user) and not is_self and await follow_repo.is_following(current_user["id"], u["id"]),
        "follower_count": await follow_repo.follower_count(u["id"]),
        "display_name": db._decrypt_secret(u.get("display_name") or ""),
        "bio": db._decrypt_secret(u.get("bio") or ""),
        "avatar": u.get("avatar") or "",
        "banner_color": u.get("banner_color") or "",
        "accent_color": u.get("accent_color") or "",
        "banner_img": u.get("banner_img") or "",
        "is_explicit": bool(u.get("is_explicit")),
        "social_links": social_links,
        "profile_html": db._decrypt_secret(u.get("profile_html") or ""),
        "card_html": db._decrypt_secret(u.get("card_html") or ""),
        "is_admin": u["is_admin"],
        "role": u.get("role") or "user",
        "title": u.get("title") if (u.get("title_status") == "approved" or is_self) else "",
        "title_status": u.get("title_status") if is_self else (
            "approved" if u.get("title_status") == "approved" else "none"),
        "joined": u.get("created"),
        "characters": chars,
        "stats": {"characters": len(chars), "chats": sum(c.get("chats", 0) for c in chars)},
    }


SOCIAL_LINK_KEYS = ("twitter", "twitch", "instagram", "discord", "pixiv", "youtube", "patreon", "kofi")


@api.put("/me/profile")
async def update_my_profile(body: ProfileIn, current_user: dict = Depends(get_current_user)):
    guest_quota.require_full(current_user, "customize their profile")
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
            if "{{report}}" not in data["profile_html"]:
                raise HTTPException(400, "profile_html must include a {{report}} placeholder")
            if "{{follow}}" not in data["profile_html"]:
                raise HTTPException(400, "profile_html must include a {{follow}} placeholder")
    if "title" in data:
        title = (data["title"] or "").strip()[:32]
        if _re_mod.search(r"[<>]", title):
            raise HTTPException(400, "title must not contain HTML")
        data["title"] = title
        current = await user_repo.get_user_by_id(current_user["id"])
        if title and title != (current.get("title") or ""):
            data["title_status"] = "pending"
        elif not title:
            data["title_status"] = "none"
    await user_repo.update_user_profile(current_user["id"], data)
    if data.get("title_status") == "pending":
        await notification_repo.notify_admins(
            "admin_title_request",
            f"Title request: {current_user['username']}",
            f"{current_user['username']} requested the custom title \"{data['title']}\".",
            "/admin", exclude_user_id=current_user["id"])
    log.info("profile: updated by=%s fields=%s", current_user["username"], ",".join(sorted(data.keys())))
    return await user_repo.get_user_by_id(current_user["id"])


@api.post("/me/banner")
async def upload_my_banner(file: UploadFile = File(...),
                           current_user: dict = Depends(get_current_user),
                           _feature: None = Depends(require_feature_enabled("profile"))):
    _PROFILE_IMAGE_LIMIT.check_and_record(current_user["id"])
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = ".png"
    data = await file.read()
    ext = await _save_uploaded_image(data, f"ub_{current_user['id']}", ext, allow_animated=False)
    url = f"/media/ub_{current_user['id']}{ext}?v={int(time.time())}"
    await user_repo.update_user_profile(current_user["id"], {"banner_img": url})
    if not current_user.get("is_explicit"):
        uid = current_user["id"]
        classify_image_background(data, "image/png", uid, current_user.get("is_admin", False),
                                  lambda: user_repo.update_user_profile(uid, {"is_explicit": 1}),
                                  review_context="a profile banner")
    log.info("profile: banner uploaded by=%s", current_user["username"])
    return {"banner_img": url}


@api.post("/me/chat-background")
async def upload_my_chat_background(file: UploadFile = File(...),
                                    current_user: dict = Depends(get_current_user),
                                    _feature: None = Depends(require_feature_enabled("profile"))):
    """Fallback chat background — shown behind the message thread whenever a
    character has no stage art, or the user has toggled stage art off for one
    that does (see backend/routers/chat.py / new_ui/js/chat.js's #chatStage)."""
    _PROFILE_IMAGE_LIMIT.check_and_record(current_user["id"])
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = ".png"
    data = await file.read()
    ext = await _save_uploaded_image(data, f"ucb_{current_user['id']}", ext, allow_animated=False)
    url = f"/media/ucb_{current_user['id']}{ext}?v={int(time.time())}"
    await user_repo.update_user_profile(current_user["id"], {"chat_background_img": url})
    if not current_user.get("is_explicit"):
        uid = current_user["id"]
        classify_image_background(data, "image/png", uid, current_user.get("is_admin", False),
                                  lambda: user_repo.update_user_profile(uid, {"is_explicit": 1}),
                                  review_context="a chat background")
    log.info("profile: chat background uploaded by=%s", current_user["username"])
    return {"chat_background_img": url}


@api.post("/me/avatar")
async def upload_my_avatar(file: UploadFile = File(...),
                           current_user: dict = Depends(get_current_user),
                           _feature: None = Depends(require_feature_enabled("profile"))):
    guest_quota.require_full(current_user, "customize their profile")
    _PROFILE_IMAGE_LIMIT.check_and_record(current_user["id"])
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in IMG_EXTS:
        ext = ".png"
    data = await file.read()
    ext = await _save_uploaded_image(data, f"u_{current_user['id']}", ext)
    url = f"/media/u_{current_user['id']}{ext}?v={int(time.time())}"
    await user_repo.update_user_profile(current_user["id"], {"avatar": url})
    if not current_user.get("is_explicit"):
        uid = current_user["id"]
        classify_image_background(data, "image/png", uid, current_user.get("is_admin", False),
                                  lambda: user_repo.update_user_profile(uid, {"is_explicit": 1}),
                                  review_context="a profile avatar")
    log.info("profile: avatar uploaded by=%s", current_user["username"])
    return {"avatar": url}



@api.post("/users/{username}/block")
async def block_user_route(username: str, body: BlockIn,
                           current_user: dict = Depends(get_current_user)):
    u = await user_repo.get_user_by_username(username)
    if not u or u.get("status") != "active":
        raise HTTPException(404, "user not found")
    if u["id"] == current_user["id"]:
        raise HTTPException(400, "You cannot block yourself.")
    await block_repo.block_user(current_user["id"], u["id"], (body.reason or "").strip()[:500])
    removed = await comment_repo.delete_by_author_on_owner(
        u["id"], current_user["id"], current_user["username"])
    log.info("user blocked: by=%s blocked=%s removed_comments=%s",
             current_user["username"], u["username"], removed)
    return {"blocked": True, "removed_comments": removed}


@api.post("/users/{username}/unblock")
async def unblock_user_route(username: str,
                             current_user: dict = Depends(get_current_user)):
    u = await user_repo.get_user_by_username(username)
    if not u:
        raise HTTPException(404, "user not found")
    await block_repo.unblock_user(current_user["id"], u["id"])
    log.info("user unblocked: by=%s unblocked=%s", current_user["username"], u["username"])
    return {"blocked": False}


@api.get("/me/blocked")
async def my_blocked(current_user: dict = Depends(get_current_user)):
    return await block_repo.list_blocked(current_user["id"])


_FOLLOWER_MILESTONES = {10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000}


@api.post("/users/{username}/follow")
async def follow_user_route(username: str, current_user: dict = Depends(get_current_user),
                            _feature: None = Depends(require_feature_enabled("follows"))):
    u = await user_repo.get_user_by_username(username)
    if not u or u.get("status") != "active":
        raise HTTPException(404, "user not found")
    if u["id"] == current_user["id"]:
        raise HTTPException(400, "You cannot follow yourself.")
    if await block_repo.is_block_between(current_user["id"], u["id"]):
        raise HTTPException(403, "You cannot follow this creator.")
    created = await follow_repo.follow(current_user["id"], u["id"])
    count = await follow_repo.follower_count(u["id"])
    if created:
        await notification_repo.create(
            u["id"], "follow", "New follower",
            f"@{current_user['username']} started following you.",
            f"/u/{current_user['username']}")
        if count in _FOLLOWER_MILESTONES:
            await notification_repo.create(
                u["id"], "milestone", "Follower milestone",
                f"You reached {count:,} followers. Nicely done.",
                f"/u/{u['username']}")
    return {"following": True, "follower_count": count}


@api.delete("/users/{username}/follow")
async def unfollow_user_route(username: str, current_user: dict = Depends(get_current_user)):
    u = await user_repo.get_user_by_username(username)
    if not u:
        raise HTTPException(404, "user not found")
    await follow_repo.unfollow(current_user["id"], u["id"])
    return {"following": False, "follower_count": await follow_repo.follower_count(u["id"])}


@api.get("/users/{username}/followers")
async def user_followers(username: str, current_user: dict | None = Depends(get_current_user_optional)):
    u = await user_repo.get_user_by_username(username)
    if not u or u.get("status") != "active":
        raise HTTPException(404, "user not found")
    return await follow_repo.followers(u["id"])
