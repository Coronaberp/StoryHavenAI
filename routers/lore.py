"""Lorebook CRUD routes."""
from fastapi import HTTPException, Depends

import db
import vectors
from state import api
from auth import get_current_user, get_current_user_optional
from chat_service import index_lore
from schemas import LoreIn

@api.get("/characters/{cid}/lore")
async def list_lore(cid: str, current_user: dict | None = Depends(get_current_user_optional)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    is_owner = bool(current_user) and c.get("owner_id") == current_user["id"]
    if not c.get("is_public") and not is_owner:
        raise HTTPException(404, "character not found")
    entries = await db.list_lore(cid)
    if not is_owner:
        for e in entries:
            if e["hidden"]:
                e["content"] = ""
            # Image-gen tags are an authoring aid for the owner only — never sent
            # to other viewers, regardless of whether the entry itself is hidden.
            e["appearance_tags"] = ""
            e["appearance_tags_negative"] = ""
    return entries


@api.post("/characters/{cid}/lore")
async def add_lore(cid: str, body: LoreIn, current_user: dict = Depends(get_current_user)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    if c.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized")
    if not body.content.strip():
        raise HTTPException(400, "content is required")
    target = None if body.is_global else cid
    lid = await db.create_lore(target, body.keys, body.content, body.always,
                                body.image, body.category, body.hidden, body.name,
                                body.appearance_tags, body.appearance_tags_negative)
    await index_lore(lid, target, body.content)
    return {"id": lid}


@api.put("/lore/{lid}")
async def update_lore(lid: str, body: LoreIn, current_user: dict = Depends(get_current_user)):
    entry = await db.get_lore(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    if entry.get("char_id"):
        c = await db.get_character(entry["char_id"])
        if c and c.get("owner_id") != current_user["id"]:
            raise HTTPException(403, "Not authorized")
    elif not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized")
    await db.update_lore(lid, body.keys, body.content, body.always,
                          body.image, body.category, body.hidden, body.name,
                          body.appearance_tags, body.appearance_tags_negative)
    await index_lore(lid, entry.get("char_id"), body.content)
    return {"id": lid}


@api.delete("/lore/{lid}")
async def delete_lore(lid: str, current_user: dict = Depends(get_current_user)):
    entry = await db.get_lore(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    if entry.get("char_id"):
        c = await db.get_character(entry["char_id"])
        if c and c.get("owner_id") != current_user["id"]:
            raise HTTPException(403, "Not authorized")
    elif not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized")
    await db.delete_lore(lid)
    await vectors.delete_lore_vector(lid)
    return {"deleted": True}

