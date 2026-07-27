from __future__ import annotations
from fastapi import Depends, HTTPException

from backend.state import api, log
from backend.auth import get_current_user
from backend.repositories import content_likes as content_like_repo
from backend.repositories import characters
from backend.repositories import groups as groups_repo
from backend.repositories import standalone_images as standalone_image_repo

async def _character_visible(cid: str, user_id: str) -> bool:
    c = await characters.get(cid)
    return bool(c) and (bool(c.get("is_public")) or c.get("owner_id") == user_id)

async def _group_visible(gid: str, user_id: str) -> bool:
    g = await groups_repo.get(gid)
    return bool(g) and (bool(g.get("is_public")) or g.get("owner_id") == user_id)

async def _image_visible(iid: str, user_id: str) -> bool:
    img = await standalone_image_repo.get(iid)
    return bool(img) and (bool(img.get("is_public")) or img.get("user_id") == user_id)

_VISIBILITY_CHECKS = {
    "character": _character_visible,
    "group": _group_visible,
    "image": _image_visible,
}

async def _require_visible_target(target_type: str, target_id: str, user_id: str):
    check = _VISIBILITY_CHECKS.get(target_type)
    if check is None:
        raise HTTPException(404, "content not found")
    if not await check(target_id, user_id):
        raise HTTPException(404, "content not found")

_TARGET_GETTERS = {
    "character": characters.get,
    "group": groups_repo.get,
    "image": standalone_image_repo.get,
}

@api.get("/me/likes")
async def my_likes(target_type: str | None = None,
                   current_user: dict = Depends(get_current_user)):
    if target_type is not None and target_type not in _TARGET_GETTERS:
        raise HTTPException(404, "unknown content type")
    rows = await content_like_repo.list_liked_by_user(current_user["id"], target_type)
    out = {"characters": [], "groups": [], "images": []}
    key_for_type = {"character": "characters", "group": "groups", "image": "images"}
    for row in rows:
        getter = _TARGET_GETTERS.get(row["target_type"])
        if getter is None:
            continue
        item = await getter(row["target_id"])
        if item is None:
            continue
        out[key_for_type[row["target_type"]]].append(item)
    return out

@api.post("/{target_type}/{target_id}/like")
async def like_content(target_type: str, target_id: str,
                       current_user: dict = Depends(get_current_user)):
    await _require_visible_target(target_type, target_id, current_user["id"])
    await content_like_repo.like(target_type, target_id, current_user["id"])
    log.info("content liked: target=%s:%s by=%s", target_type, target_id, current_user["id"])
    return {"liked": True, "like_count": await content_like_repo.like_count(target_type, target_id)}

@api.delete("/{target_type}/{target_id}/like")
async def unlike_content(target_type: str, target_id: str,
                         current_user: dict = Depends(get_current_user)):
    if target_type not in _VISIBILITY_CHECKS:
        raise HTTPException(404, "content not found")
    await content_like_repo.unlike(target_type, target_id, current_user["id"])
    log.info("content unliked: target=%s:%s by=%s", target_type, target_id, current_user["id"])
    return {"liked": False, "like_count": await content_like_repo.like_count(target_type, target_id)}
