import os
import uuid

from fastapi import HTTPException, Depends, UploadFile, File

from backend import db
from backend import guest_quota
from backend import vectors
from backend.state import api, log, IMG_EXTS
from backend.auth import get_current_user, get_current_user_optional
from backend.retrieval import index_lore, chunk_lore_content
from backend.classify import classify_image_background, _data_url_to_bytes
from backend.routers.characters import _decode_lore_image
from backend.media import _save_uploaded_image, _check_upload_size
from backend.repositories import lore
from backend.repositories import personas
from backend.repositories import lore_links
from backend.repositories import lore_secrets
from backend.repositories import lore_chunks as lore_chunks_repo
from backend.schemas import LoreIn, LorePersonaToggleIn, LoreLinksIn, LoreChunkPreviewIn
from backend.feature_flags import require_feature_enabled

async def _require_can_edit(entry: dict, current_user: dict) -> None:
    if current_user["is_admin"]:
        return
    if entry.get("char_id"):
        c = await db.get_character(entry["char_id"])
        if not c or c.get("owner_id") != current_user["id"]:
            raise HTTPException(403, "Not authorized")
        return
    if entry.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized")

async def _attach_links(entries: list[dict]) -> None:
    ids = [e["id"] for e in entries]
    outgoing = await lore_links.outgoing_for_many(ids)
    incoming = await lore_links.incoming_for_many(ids)
    for e in entries:
        e["outgoing_links"] = outgoing.get(e["id"], [])
        e["incoming_links"] = incoming.get(e["id"], [])

@api.get("/lore/mine")
async def list_my_lore(current_user: dict = Depends(get_current_user)):
    entries = await lore.list_mine(current_user["id"])
    await _attach_links(entries)
    return entries

@api.post("/lore/preview-chunks")
async def preview_lore_chunks(body: LoreChunkPreviewIn, current_user: dict = Depends(get_current_user)):
    return {"chunks": chunk_lore_content(body.content)}

@api.get("/characters/{cid}/lore")
async def list_lore(cid: str, current_user: dict | None = Depends(get_current_user_optional)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    is_owner = bool(current_user) and c.get("owner_id") == current_user["id"]
    if not c.get("is_public") and not is_owner:
        raise HTTPException(404, "character not found")
    entries = await lore.list_for_character(cid, current_user["id"] if current_user else None)
    await _attach_links(entries)
    if not is_owner:
        hidden_ids = {e["id"] for e in entries if e["hidden"]}
        for e in entries:
            e["content"] = "" if e["hidden"] else e["content"]
            e["appearance_tags"] = ""
            e["appearance_tags_negative"] = ""
            for l in e["outgoing_links"]:
                if e["hidden"] or l["target_id"] in hidden_ids:
                    l["label"] = ""
            for l in e["incoming_links"]:
                if e["hidden"] or l["source_id"] in hidden_ids:
                    l["label"] = ""
    return entries

@api.post("/characters/{cid}/lore")
async def add_lore(cid: str, body: LoreIn, current_user: dict = Depends(get_current_user),
                    _feature_ok: None = Depends(require_feature_enabled("lore"))):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    if c.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized")
    if not body.content.strip():
        raise HTTPException(400, "content is required")
    lid = await _create_entry(cid, None, body, current_user)
    log.info("lore: created id=%s char=%s by=%s", lid, cid, current_user["username"])
    return {"id": lid}

@api.post("/lore/global")
async def add_global_lore(body: LoreIn, current_user: dict = Depends(get_current_user),
                          _feature_ok: None = Depends(require_feature_enabled("lore"))):
    guest_quota.require_full(current_user, "create lore")
    if not body.content.strip():
        raise HTTPException(400, "content is required")
    lid = await _create_entry(None, current_user["id"], body, current_user)
    log.info("lore: global entry created id=%s owner=%s", lid, current_user["username"])
    return {"id": lid}

async def _create_entry(char_id: str | None, owner_id: str | None, body: LoreIn,
                        current_user: dict) -> str:
    image = _decode_lore_image(body.image_data) if body.image_data else body.image
    lid = await lore.create(char_id, body.keys, body.content, body.always,
                                  image, body.category, body.hidden, body.name,
                                  body.appearance_tags, body.appearance_tags_negative,
                                  is_explicit=False, owner_id=owner_id,
                                  require_keys=body.require_keys, exclude_keys=body.exclude_keys)
    if body.image_data:
        img_bytes, mime = _data_url_to_bytes(body.image_data)
        if img_bytes:
            classify_image_background(img_bytes, mime or "image/png", current_user["id"],
                                      current_user["is_admin"], lambda: lore.set_explicit(lid),
                                      review_context="a lore entry image")
    await index_lore(lid, char_id, body.content, body.name, body.category)
    return lid

@api.post("/lore/media")
async def upload_lore_media(file: UploadFile = File(...),
                            current_user: dict = Depends(get_current_user)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in IMG_EXTS:
        raise HTTPException(400, "unsupported file type")
    data = await file.read()
    _check_upload_size(data)
    basename = f"lore_{current_user['id']}_{uuid.uuid4().hex[:8]}"
    ext = await _save_uploaded_image(data, basename, ext)
    log.info("lore media uploaded: by=%s file=%s", current_user["id"], basename + ext)
    return {"url": f"/media/{basename}{ext}"}

@api.put("/lore/{lid}")
async def update_lore(lid: str, body: LoreIn, current_user: dict = Depends(get_current_user)):
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    await _require_can_edit(entry, current_user)
    image = body.image
    is_explicit = None
    img_bytes = mime = None
    if body.image_data:
        image = _decode_lore_image(body.image_data)
        img_bytes, mime = _data_url_to_bytes(body.image_data)
        if img_bytes:
            is_explicit = False
    await lore.update(lid, body.keys, body.content, body.always,
                            image, body.category, body.hidden, body.name,
                            body.appearance_tags, body.appearance_tags_negative,
                            is_explicit=is_explicit,
                            require_keys=body.require_keys, exclude_keys=body.exclude_keys)
    if img_bytes:
        classify_image_background(img_bytes, mime or "image/png", current_user["id"],
                                  current_user["is_admin"], lambda: lore.set_explicit(lid),
                                  review_context="a lore entry image")
    await index_lore(lid, entry.get("char_id"), body.content, body.name, body.category)
    log.info("lore: updated id=%s by=%s", lid, current_user["username"])
    return {"id": lid}

@api.put("/lore/{lid}/usable-as-persona")
async def set_lore_usable_as_persona(lid: str, body: LorePersonaToggleIn,
                                     current_user: dict = Depends(get_current_user)):
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    await _require_can_edit(entry, current_user)
    await lore.set_usable_as_persona(lid, body.value)
    log.info("lore: usable_as_persona toggled id=%s value=%s by=%s", lid, body.value, current_user["username"])
    return {"id": lid, "usable_as_persona": body.value}

@api.post("/lore/{lid}/persona")
async def become_persona_from_lore(lid: str, current_user: dict = Depends(get_current_user)):
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    if entry.get("char_id"):
        c = await db.get_character(entry["char_id"])
        is_owner = bool(c) and c.get("owner_id") == current_user["id"]
    else:
        is_owner = entry.get("owner_id") == current_user["id"]
    allowed = is_owner or current_user["is_admin"] or (entry.get("usable_as_persona") and not entry.get("hidden"))
    if not allowed:
        raise HTTPException(403, "This lore entry can't be played as a persona")
    p = await personas.get_or_create_from_lore(entry, current_user["id"])
    log.info("lore: persona created from entry=%s by=%s", lid, current_user["username"])
    return p

@api.delete("/lore/{lid}")
async def delete_lore(lid: str, current_user: dict = Depends(get_current_user)):
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    await _require_can_edit(entry, current_user)
    await lore.delete(lid)
    await vectors.delete_lore_vector(lid)
    await lore_chunks_repo.delete_chunks(lid)
    await lore_secrets.delete_secrets(lid)
    log.info("lore: deleted id=%s by=%s", lid, current_user["username"])
    return {"deleted": True}

@api.put("/lore/{lid}/links")
async def set_lore_links(lid: str, body: LoreLinksIn, current_user: dict = Depends(get_current_user)):
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    await _require_can_edit(entry, current_user)
    links = []
    for item in body.links:
        if item.target_id == lid:
            continue
        target = await lore.get(item.target_id)
        if not target:
            raise HTTPException(400, f"link target {item.target_id} not found")
        same_lorebook = target.get("char_id") == entry.get("char_id") or target.get("char_id") is None or entry.get("char_id") is None
        if not same_lorebook:
            raise HTTPException(400, "link target must be in the same lorebook or global")
        await _require_can_edit(target, current_user)
        links.append({"target_id": item.target_id, "label": item.label})
    await lore_links.set_outgoing_links(lid, links)
    log.info("lore: links set id=%s count=%s by=%s", lid, len(links), current_user["username"])
    return {"id": lid, "links": links}

