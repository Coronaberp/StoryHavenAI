from __future__ import annotations
from fastapi import Depends, HTTPException

from backend.state import api, log
from backend.auth import get_current_user, get_current_user_optional
from backend.schemas import GroupPublishIn, GroupEditIn
from backend.repositories import groups as groups_repo
from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import session_characters as session_char_repo
from backend.repositories import users as users_repo
from backend.routers.sessions import start_group_from_cast
from backend.feature_flags import require_feature_enabled


async def _own_private_char_ids(char_ids: list[str], owner_id: str) -> list[str]:
    blockers = []
    for cid in char_ids:
        c = await characters.get(cid)
        if c and c.get("owner_id") == owner_id and not c.get("is_public"):
            blockers.append(cid)
    return blockers


@api.post("/groups")
async def publish_group(body: GroupPublishIn, current_user: dict = Depends(get_current_user),
                         _feature_ok: None = Depends(require_feature_enabled("groups"))):
    s = await chat_sessions.get(body.session_id)
    if not s or s.get("user_id") != current_user["id"]:
        raise HTTPException(404, "session not found")
    if not s.get("is_group"):
        raise HTTPException(400, "only a group chat can be published")
    cast = await session_char_repo.list_cast(body.session_id)
    char_ids = [row["char_id"] for row in cast]
    if not (2 <= len(char_ids) <= 4):
        raise HTTPException(400, "a group needs 2 to 4 characters")
    blockers = await _own_private_char_ids(char_ids, current_user["id"])
    if blockers:
        raise HTTPException(400, f"publish these characters first: {', '.join(blockers)}")
    linked = s.get("source_group_id")
    existing = await groups_repo.get(linked) if linked else None
    if existing and existing["owner_id"] == current_user["id"]:
        await groups_repo.set_public(linked, 1)
        gid = linked
    else:
        msgs = await chat_sessions.list_messages(body.session_id)
        opening = next((m["content"] for m in msgs
                        if m["role"] == "assistant" and not m.get("char_id")), "")
        gid = await groups_repo.create(current_user["id"], s.get("title") or "Group", opening,
                                       s.get("group_mode") or "roleplay", 1, char_ids)
    log.info("group published: id=%s from_session=%s owner=%s", gid, body.session_id, current_user["id"])
    return {"id": gid}


def _char_accessible(c: dict, viewer_id: str | None) -> bool:
    return bool(c.get("is_public")) or (viewer_id is not None and c.get("owner_id") == viewer_id)


async def _cast_view(gid: str, viewer_id: str | None) -> list[dict]:
    out = []
    for row in await groups_repo.list_cast(gid):
        c = await characters.get(row["char_id"])
        if not c:
            continue
        if _char_accessible(c, viewer_id):
            public = bool(c.get("is_public"))
            out.append({"char_id": row["char_id"], "name": c["name"], "avatar": c.get("avatar"),
                        "is_public": public, "linkable": public, "hidden": False})
        else:
            out.append({"char_id": row["char_id"], "name": None, "avatar": None,
                        "is_public": False, "linkable": False, "hidden": True})
    return out


@api.get("/groups/{gid}")
async def get_group(gid: str, current_user: dict | None = Depends(get_current_user_optional)):
    g = await groups_repo.get(gid)
    if not g:
        raise HTTPException(404, "group not found")
    viewer_id = current_user["id"] if current_user else None
    is_owner = viewer_id is not None and g["owner_id"] == viewer_id
    if not g["is_public"] and not is_owner:
        raise HTTPException(404, "group not found")
    owner = await users_repo.get_user_by_id(g["owner_id"])
    return {"id": g["id"], "name": g["name"], "opening": g["opening"],
            "group_mode": g["group_mode"], "is_public": bool(g["is_public"]),
            "is_owner": is_owner,
            "owner": {"username": (owner or {}).get("username"),
                      "display_name": (owner or {}).get("display_name"),
                      "avatar": (owner or {}).get("avatar")},
            "cast": await _cast_view(gid, viewer_id)}


async def _validate_cast(char_ids: list[str], owner_id: str) -> list[str]:
    seen, ordered = set(), []
    for cid in char_ids:
        if cid not in seen:
            seen.add(cid)
            ordered.append(cid)
    if not (2 <= len(ordered) <= 4):
        raise HTTPException(400, "a group needs 2 to 4 characters")
    for cid in ordered:
        c = await characters.get(cid)
        if not c:
            raise HTTPException(404, "character not found")
        if (c.get("mode") or "character") == "rpg":
            raise HTTPException(400, "RPG characters cannot join a group")
    blockers = await _own_private_char_ids(ordered, owner_id)
    if blockers:
        raise HTTPException(400, f"publish these characters first: {', '.join(blockers)}")
    return ordered


async def _own_group_or_404(gid: str, current_user: dict) -> dict:
    g = await groups_repo.get(gid)
    if not g or g["owner_id"] != current_user["id"]:
        raise HTTPException(404, "group not found")
    return g


@api.put("/groups/{gid}")
async def edit_group(gid: str, body: GroupEditIn, current_user: dict = Depends(get_current_user)):
    await _own_group_or_404(gid, current_user)
    if not (body.name or "").strip():
        raise HTTPException(400, "a group needs a name")
    mode = "chat" if body.mode == "chat" else "roleplay"
    char_ids = await _validate_cast(body.char_ids or [], current_user["id"])
    await groups_repo.update(gid, body.name.strip(), (body.opening or "").strip(), mode, char_ids)
    log.info("group edited: id=%s owner=%s", gid, current_user["id"])
    return {"ok": True}


@api.post("/groups/{gid}/sessions")
async def start_group_chat(gid: str, current_user: dict = Depends(get_current_user)):
    g = await groups_repo.get(gid)
    if not g or (not g["is_public"] and g["owner_id"] != current_user["id"]):
        raise HTTPException(404, "group not found")
    cast = await groups_repo.list_cast(gid)
    char_ids, chars = [], []
    for row in cast:
        c = await characters.get(row["char_id"])
        if c and _char_accessible(c, current_user["id"]):
            char_ids.append(row["char_id"])
            chars.append(c)
    if len(char_ids) < 2:
        raise HTTPException(400, "this group's cast is no longer available")
    sid = await start_group_from_cast(current_user["id"], g["name"], g["opening"],
                                      g["group_mode"], char_ids, chars, expand_opening=False,
                                      source_group_id=gid)
    log.info("group chat started from template: template=%s session=%s by=%s",
             gid, sid, current_user["id"])
    return {"session_id": sid}


@api.delete("/groups/{gid}")
async def delete_group(gid: str, current_user: dict = Depends(get_current_user)):
    await _own_group_or_404(gid, current_user)
    await groups_repo.delete(gid)
    log.info("group deleted by owner: id=%s owner=%s", gid, current_user["id"])
    return {"ok": True}
