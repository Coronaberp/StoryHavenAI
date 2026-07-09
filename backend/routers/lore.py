"""Lorebook CRUD routes."""
from fastapi import HTTPException, Depends

from backend import db
from backend import vectors
from backend.state import api
from backend.auth import get_current_user, get_current_user_optional
from backend.chat_service import index_lore, classify_image_background, _data_url_to_bytes
from backend.routers.characters import _decode_lore_image
from backend.schemas import LoreIn

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
    image = _decode_lore_image(body.image_data) if body.image_data else body.image
    lid = await db.create_lore(target, body.keys, body.content, body.always,
                                image, body.category, body.hidden, body.name,
                                body.appearance_tags, body.appearance_tags_negative,
                                is_explicit=False)
    if body.image_data:
        img_bytes, mime = _data_url_to_bytes(body.image_data)
        if img_bytes:
            classify_image_background(img_bytes, mime or "image/png", current_user["id"],
                                      current_user["is_admin"], lambda: db.set_lore_explicit(lid),
                                      review_context="a lore entry image")
    await index_lore(lid, target, body.content, body.name, body.category)
    return {"id": lid}


@api.put("/lore/{lid}")
async def update_lore(lid: str, body: LoreIn, current_user: dict = Depends(get_current_user)):
    entry = await db.get_lore(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    if entry.get("char_id"):
        c = await db.get_character(entry["char_id"])
        if not current_user["is_admin"] and (not c or c.get("owner_id") != current_user["id"]):
            raise HTTPException(403, "Not authorized")
    elif not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized")
    image = body.image
    is_explicit = None
    img_bytes = mime = None
    if body.image_data:
        image = _decode_lore_image(body.image_data)
        img_bytes, mime = _data_url_to_bytes(body.image_data)
        if img_bytes:
            is_explicit = False
    await db.update_lore(lid, body.keys, body.content, body.always,
                          image, body.category, body.hidden, body.name,
                          body.appearance_tags, body.appearance_tags_negative,
                          is_explicit=is_explicit)
    if img_bytes:
        classify_image_background(img_bytes, mime or "image/png", current_user["id"],
                                  current_user["is_admin"], lambda: db.set_lore_explicit(lid),
                                  review_context="a lore entry image")
    await index_lore(lid, entry.get("char_id"), body.content, body.name, body.category)
    return {"id": lid}


@api.delete("/lore/{lid}")
async def delete_lore(lid: str, current_user: dict = Depends(get_current_user)):
    entry = await db.get_lore(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    if entry.get("char_id"):
        c = await db.get_character(entry["char_id"])
        if not current_user["is_admin"] and (not c or c.get("owner_id") != current_user["id"]):
            raise HTTPException(403, "Not authorized")
    elif not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized")
    await db.delete_lore(lid)
    await vectors.delete_lore_vector(lid)
    return {"deleted": True}

