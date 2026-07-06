"""Character CRUD, avatar/media upload, and card import/export routes."""
import os
import io
import json
import base64
import time
import uuid

from PIL import Image
from fastapi import UploadFile, File, HTTPException, Response, Depends

import db
import vectors
from state import api, MEDIA_DIR, IMG_EXTS, log
from auth import get_current_user, get_current_user_optional
from media import _save_uploaded_image, _check_upload_size, _write_file
from chat_service import index_lore
from schemas import CharacterIn

@api.get("/characters")
async def list_characters(q: str | None = None, scope: str | None = None,
                          current_user: dict | None = Depends(get_current_user_optional)):
    if not current_user:
        if scope != "community":
            raise HTTPException(401, "Not authenticated")
        chars = await db.list_characters(q, scope="community")
        # Anonymous /explore visitors don't get explicit content — sign in to see it.
        return [c for c in chars if not c.get("is_explicit")]
    return await db.list_characters(q, user_id=current_user["id"],
                                    is_admin=current_user["is_admin"],
                                    scope=scope)


@api.get("/characters/persona-pool")
async def persona_pool(current_user: dict = Depends(get_current_user)):
    return await db.list_persona_pool_characters(current_user["id"], current_user["is_admin"])


@api.get("/characters/{cid}")
async def get_character(cid: str, current_user: dict | None = Depends(get_current_user_optional)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    is_owner = bool(current_user) and c.get("owner_id") == current_user["id"]
    # Visible if public, or own character — admins get no special access to private content
    if not c.get("is_public") and not is_owner:
        raise HTTPException(404, "character not found")
    if not current_user and c.get("is_explicit"):
        raise HTTPException(404, "character not found")
    return c


@api.post("/characters")
async def create_character(body: CharacterIn, current_user: dict = Depends(get_current_user)):
    data = body.model_dump()
    data["owner_id"] = current_user["id"]   # creator always owns it
    if not (data.get("creator") or "").strip() or data.get("creator") == "you":
        data["creator"] = current_user["username"]
    # is_public stays from body (default False = library-only)
    c = await db.create_character(data)
    log.info("character created: id=%s owner=%s public=%s", c["id"], current_user["id"], data.get("is_public"))
    return c


@api.put("/characters/{cid}")
async def update_character(cid: str, body: CharacterIn,
                           current_user: dict = Depends(get_current_user)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    # Editing is owner-only — admins can delete (moderation) but not touch content
    if c.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized to edit this character")
    data = body.model_dump()
    data.pop("is_private", None)            # remove legacy field if client sends it
    data["owner_id"] = c["owner_id"]        # ownership never changes via edit
    return await db.update_character(cid, data)


@api.post("/characters/{cid}/avatar")
async def upload_avatar(cid: str, file: UploadFile = File(...),
                        current_user: dict = Depends(get_current_user)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    if c.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in IMG_EXTS:
        ext = ".png"
    data = await file.read()
    ext = await _save_uploaded_image(data, cid, ext)
    fname = f"{cid}{ext}"
    char = await db.update_character(cid, {"avatar": f"/media/{fname}?v={int(time.time())}"})
    return {"avatar": char["avatar"]}


@api.post("/characters/{cid}/media")
async def upload_media(cid: str, file: UploadFile = File(...),
                       current_user: dict = Depends(get_current_user)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    if c.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized")
    ext = os.path.splitext(file.filename or "")[1].lower()
    ALLOWED_AUD = {".mp3", ".ogg", ".wav", ".flac", ".m4a"}
    if ext not in IMG_EXTS | ALLOWED_AUD:
        raise HTTPException(400, "unsupported file type")
    data = await file.read()
    _check_upload_size(data)
    basename = f"{cid}_{uuid.uuid4().hex[:8]}"
    if ext in IMG_EXTS:
        ext = await _save_uploaded_image(data, basename, ext)
    else:
        await _write_file(os.path.join(MEDIA_DIR, basename + ext), data)
    return {"url": f"/media/{basename}{ext}"}


@api.delete("/characters/{cid}")
async def delete_character(cid: str, current_user: dict = Depends(get_current_user)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    owner_id = c.get("owner_id")
    # Owner can always delete their own character; admin can delete anything
    if owner_id != current_user["id"] and not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized to delete this character")
    await db.delete_character(cid)
    await vectors.delete_by_tag(vectors.MEM_INDEX, "chartag", cid)
    await vectors.delete_by_tag(vectors.LORE_INDEX, "chartag", cid)
    log.info("character deleted: id=%s by=%s", cid, current_user["id"])
    return {"deleted": True}


def parse_card(filename, data):
    if (filename or "").lower().endswith(".json"):
        raw = json.loads(data.decode("utf-8"))
    else:
        img = Image.open(io.BytesIO(data))
        chunks = {}
        try:
            chunks.update(img.text)
        except Exception:
            pass
        chunks.update({k: v for k, v in img.info.items() if isinstance(v, str)})
        blob = chunks.get("ccv3") or chunks.get("chara")
        if not blob:
            raise ValueError("no character data in image")
        raw = json.loads(base64.b64decode(blob).decode("utf-8", "ignore"))
    d = raw.get("data") if isinstance(raw, dict) and "data" in raw else raw
    persona = d.get("description", "") or ""
    personality = d.get("personality", "") or ""
    if personality and personality not in persona:
        persona = (persona + ("\n\n" if persona else "") + "Personality: " + personality)
    return {
        "name": d.get("name", "") or "Imported character",
        "persona": persona, "scenario": d.get("scenario", "") or "",
        "greeting": d.get("first_mes", "") or "", "dialogue": d.get("mes_example", "") or "",
        "system_prompt": d.get("system_prompt", "") or "", "tags": d.get("tags", []) or [],
        "creator": d.get("creator", "") or "imported",
        "alt_greetings": d.get("alternate_greetings", []) or [],
        "character_book": d.get("character_book") or {},
    }


def _decode_lore_image(image_data: str | None) -> str:
    """Reverse of _embed_lore_image: pulls a card entry's inline data URI back
    out to a media file, returning the /media path (or "" if none/invalid)."""
    if not image_data or not image_data.startswith("data:image/"):
        return ""
    try:
        header, b64 = image_data.split(",", 1)
        ext = header.split("/")[1].split(";")[0]
        if ext == "jpeg":
            ext = "jpg"
        data = base64.b64decode(b64)
    except Exception:
        return ""
    fname = f"{db.nid('limg')}.{ext}"
    with open(os.path.join(MEDIA_DIR, fname), "wb") as fh:
        fh.write(data)
    return f"/media/{fname}"


@api.post("/characters/import")
async def import_character(file: UploadFile = File(...),
                           current_user: dict = Depends(get_current_user)):
    data = await file.read()
    _check_upload_size(data)
    try:
        card = parse_card(file.filename, data)
    except Exception as e:
        raise HTTPException(400, f"Could not read card: {e}")
    # Imported cards are private to the importer by default
    char_data = {k: card[k] for k in
                 ("name", "persona", "scenario", "greeting", "dialogue",
                  "system_prompt", "tags", "creator", "alt_greetings")}
    char_data["owner_id"] = current_user["id"]
    char_data["is_public"] = False
    # attribute the card to the user who imported it (the card's original author,
    # if any, would otherwise show up as a stranger — or worse, as "imported")
    char_data["creator"] = current_user["username"]
    char = await db.create_character(char_data)
    cid = char["id"]
    if not (file.filename or "").lower().endswith(".json"):
        img_ext = await _save_uploaded_image(data, cid, ".png")
        char = await db.update_character(cid, {"avatar": f"/media/{cid}{img_ext}"})
    imported = 0
    for e in (card["character_book"].get("entries") or []):
        if e.get("enabled") is False:
            continue
        content = e.get("content")
        if isinstance(content, list):
            content = "\n".join(content)
        if not content:
            continue
        meta = (e.get("extensions") or {}).get("personae") or {}
        image = _decode_lore_image(meta.get("image_data"))
        name = meta.get("name") or e.get("comment") or ""
        lid = await db.create_lore(cid, e.get("keys") or [], content, bool(e.get("constant")),
                                    image, meta.get("category", ""), bool(meta.get("hidden")), name)
        await index_lore(lid, cid, content)
        imported += 1
    char["lore_imported"] = imported
    return char


@api.post("/characters/{cid}/reimport")
async def reimport_character(cid: str, file: UploadFile = File(...),
                             current_user: dict = Depends(get_current_user)):
    """Refresh an existing character from a newer card: overwrites the card fields
    (name, persona, scenario, greeting, dialogue, system prompt, tags, alternate
    greetings) in place. Ownership, visibility, creator attribution, stage assets,
    existing lore, and chats are untouched; a PNG card also refreshes the avatar."""
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    if c.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized")
    data = await file.read()
    _check_upload_size(data)
    try:
        card = parse_card(file.filename, data)
    except Exception as e:
        raise HTTPException(400, f"Could not read card: {e}")
    upd = {k: card[k] for k in ("name", "persona", "scenario", "greeting", "dialogue",
                                "system_prompt", "tags", "alt_greetings")}
    if not (file.filename or "").lower().endswith(".json"):
        img_ext = await _save_uploaded_image(data, cid, ".png")
        upd["avatar"] = f"/media/{cid}{img_ext}"
    char = await db.update_character(cid, upd)
    log.info("character reimported: id=%s by=%s", cid, current_user["username"])
    return char


def _embed_lore_image(image_path: str) -> str | None:
    """Inline an entry's image as a data URI so it travels with the exported
    card file — a plain /media path would 404 on any other install."""
    if not image_path or not image_path.startswith("/media/"):
        return None
    # basename strips any "../" a crafted lore.image value could contain — the
    # /media/ prefix check alone doesn't stop "/media/../../etc/passwd".
    fname = os.path.basename(image_path[len("/media/"):])
    fpath = os.path.join(MEDIA_DIR, fname)
    if not os.path.isfile(fpath):
        return None
    ext = os.path.splitext(fname)[1].lstrip(".").lower() or "png"
    mime = "jpeg" if ext == "jpg" else ext
    with open(fpath, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    return f"data:image/{mime};base64,{b64}"


def build_card(char: dict, lore: list, spec: str = "v2") -> dict:
    entries = []
    for i, e in enumerate(lore):
        keys = e.get("keys") or []
        entries.append({
            "keys": keys, "secondary_keys": [], "comment": e.get("name", "") or "",
            "content": e.get("content", ""), "constant": bool(e.get("always")),
            "selective": bool(keys), "insertion_order": i, "enabled": True,
            "position": "before_char", "case_sensitive": False, "id": i,
            "extensions": {
                "personae": {
                    "name": e.get("name", "") or "",
                    "category": e.get("category", "") or "",
                    "hidden": bool(e.get("hidden")),
                    "image_data": _embed_lore_image(e.get("image", "")),
                },
            },
        })
    data = {
        "name": char.get("name", ""), "description": char.get("persona", ""),
        "personality": "", "scenario": char.get("scenario", ""),
        "first_mes": char.get("greeting", ""), "mes_example": char.get("dialogue", ""),
        "creator_notes": "", "system_prompt": char.get("system_prompt", ""),
        "post_history_instructions": "",
        "alternate_greetings": char.get("alt_greetings", []) or [],
        "tags": char.get("tags", []) or [], "creator": char.get("creator", "you"),
        "character_version": "1.0", "extensions": {},
    }
    if entries:
        data["character_book"] = {
            "name": f"{char.get('name','')} lorebook", "description": "",
            "scan_depth": 4, "token_budget": 512, "recursive_scanning": False,
            "extensions": {}, "entries": entries,
        }
    if spec == "v3":
        # chara_card_v3 is additive over v2 — same `data` fields, plus these.
        avatar_url = _embed_lore_image(char.get("avatar", "")) if char.get("avatar", "").startswith("/media/") else None
        data["nickname"] = ""
        data["creator_notes_multilingual"] = {}
        data["source"] = []
        data["group_only_greetings"] = []
        data["creation_date"] = int(char.get("created", time.time()))
        data["modification_date"] = int(time.time())
        data["assets"] = [{"type": "icon", "uri": avatar_url or "ccdefault:", "name": "main", "ext": "png"}]
        return {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}
    return {"spec": "chara_card_v2", "spec_version": "2.0", "data": data}


@api.get("/characters/{cid}/export")
async def export_character(cid: str, spec: str = "v2",
                           current_user: dict = Depends(get_current_user)):
    if spec not in ("v2", "v3"):
        raise HTTPException(400, "spec must be 'v2' or 'v3'")
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    is_owner = c.get("owner_id") == current_user["id"]
    if not is_owner and not (c.get("is_public") and c.get("allow_download")):
        raise HTTPException(403, "The creator hasn't allowed this character to be downloaded")
    lore = [e for e in await db.list_lore(cid) if not e.get("global")]
    if not is_owner:
        for e in lore:
            if e.get("hidden"):
                e["content"] = ""
    body = json.dumps(build_card(c, lore, spec), ensure_ascii=False, indent=2)
    safe = "".join(ch for ch in c["name"] if ch.isalnum() or ch in " -_").strip() or "character"
    return Response(content=body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.{spec}.card.json"'})

