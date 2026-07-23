"""Character CRUD, avatar/media upload, and card import/export routes."""
import os
import io
import json
import base64
import time
import uuid

from PIL import Image
from fastapi import UploadFile, File, HTTPException, Response, Depends, Request

from backend import db
from backend import guest_quota
from backend.repositories import characters
from backend.repositories import personas
from backend.repositories import memory_facts
from backend.repositories import groups as groups_repo
from backend.repositories import users as users_repo
from backend import vectors
from backend.state import api, MEDIA_DIR, IMG_EXTS, CFG, log
from backend.auth import get_current_user, get_current_user_optional
from backend.media import _save_uploaded_image, _check_upload_size, _write_file
from backend.chat_service import _endpoints, _eff_cfg
from backend.retrieval import index_lore
from backend.ai_helpers import generate_character_from_description
from backend.classify import classify_image_background
from backend.schemas import CharacterIn
from backend.ratelimit import SlidingWindow
from backend.feature_flags import require_feature_enabled

_GENERATE_LIMIT = SlidingWindow(
    10, 60, "Too many generations — please wait a moment and try again")

async def _group_feed_item(g: dict) -> dict:
    preview = []
    for row in (await groups_repo.list_cast(g["id"]))[:4]:
        c = await characters.get(row["char_id"])
        if c and c.get("is_public"):
            preview.append({"char_id": c["id"], "name": c["name"], "avatar": c.get("avatar")})
    creator = None
    owner = await users_repo.get_user_by_id(g["owner_id"])
    if owner:
        creator = {"username": owner.get("username"), "display_name": owner.get("display_name")}
    return {"id": g["id"], "kind": "group", "name": g["name"],
            "group_mode": g["group_mode"], "cast_preview": preview, "creator": creator}


@api.get("/characters")
async def list_characters(q: str | None = None, scope: str | None = None,
                          tags: str | None = None, creator: str | None = None,
                          current_user: dict | None = Depends(get_current_user_optional)):
    tag_list = [t for t in (tags or "").split(",") if t.strip()] or None
    if not current_user:
        if scope != "community":
            raise HTTPException(401, "Not authenticated")
        rows = await characters.list_all(q, scope="community",
                                        tags=tag_list, creator=creator)
        hidden = set()
    else:
        rows = await characters.list_all(q, user_id=current_user["id"],
                                        is_admin=current_user["is_admin"],
                                        scope=scope, tags=tag_list, creator=creator)
        hidden = await db.hidden_user_ids(current_user["id"])
        if hidden:
            rows = [c for c in rows if c.get("owner_id") not in hidden]
    if scope == "community":
        for g in await groups_repo.list_public(q, None):
            if g["owner_id"] in hidden:
                continue
            rows.append(await _group_feed_item(g))
    return rows


@api.get("/characters/{cid}/groups")
async def character_groups(cid: str, current_user: dict | None = Depends(get_current_user_optional)):
    hidden = await db.hidden_user_ids(current_user["id"]) if current_user else set()
    return [await _group_feed_item(g) for g in await groups_repo.list_public_for_char(cid) if g["owner_id"] not in hidden]


@api.get("/characters/persona-pool")
async def persona_pool(current_user: dict = Depends(get_current_user)):
    return await personas.list_pool_characters(current_user["id"], current_user["is_admin"])


@api.get("/characters/{cid}")
async def get_character(cid: str, current_user: dict | None = Depends(get_current_user_optional)):
    c = await characters.get(cid)
    if not c:
        raise HTTPException(404, "character not found")
    is_owner = bool(current_user) and c.get("owner_id") == current_user["id"]
    # Visible if public, or own character — admins get no special access to private content
    if not c.get("is_public") and not is_owner:
        raise HTTPException(404, "character not found")
    if (current_user and not is_owner and c.get("owner_id")
            and await db.is_block_between(current_user["id"], c["owner_id"])):
        raise HTTPException(404, "character not found")
    # Explicit content is not hidden from anon viewers anymore — the frontend
    # blurs its images for anyone who isn't opted into mature content, same as
    # a logged-in SFW-mode user. This is what makes shared links to explicit
    # characters work for signed-out visitors at all.
    return c


@api.post("/characters")
async def create_character(body: CharacterIn, current_user: dict = Depends(get_current_user),
                            _feature_ok: None = Depends(require_feature_enabled("characters"))):
    guest_quota.require_full(current_user, "create characters")
    data = body.model_dump()
    data["owner_id"] = current_user["id"]   # creator always owns it
    if not (data.get("creator") or "").strip() or data.get("creator") == "you":
        data["creator"] = current_user["username"]
    data["assets"] = _decode_media_paths(data.get("assets") or {})
    # is_public stays from body (default False = library-only)
    c = await characters.create(data)
    log.info("character created: id=%s owner=%s public=%s", c["id"], current_user["id"], data.get("is_public"))
    return c


@api.put("/characters/{cid}")
async def update_character(cid: str, body: CharacterIn,
                           current_user: dict = Depends(get_current_user)):
    c = await characters.get(cid)
    if not c:
        raise HTTPException(404, "character not found")
    # Editing is owner-only — admins can delete (moderation) but not touch content
    if c.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized to edit this character")
    data = body.model_dump()
    data.pop("is_private", None)            # remove legacy field if client sends it
    data["owner_id"] = c["owner_id"]        # ownership never changes via edit
    data["assets"] = _decode_media_paths(data.get("assets") or {})
    c = await characters.update(cid, data)
    log.info("character updated: id=%s by=%s", cid, current_user["id"])
    return c


@api.post("/characters/{cid}/avatar")
async def upload_avatar(cid: str, file: UploadFile = File(...),
                        current_user: dict = Depends(get_current_user)):
    c = await characters.get(cid)
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
    char = await characters.update(cid, {"avatar": f"/media/{fname}?v={int(time.time())}"})
    if not c.get("is_explicit"):
        classify_image_background(data, "image/png", current_user["id"], current_user.get("is_admin", False),
                                  lambda: characters.update(cid, {"is_explicit": True}),
                                  review_context="a character avatar")
    log.info("character avatar uploaded: id=%s by=%s", cid, current_user["id"])
    return {"avatar": char["avatar"]}


@api.post("/characters/{cid}/media")
async def upload_media(cid: str, file: UploadFile = File(...),
                       current_user: dict = Depends(get_current_user)):
    c = await characters.get(cid)
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
    log.info("character media uploaded: id=%s by=%s file=%s", cid, current_user["id"], basename + ext)
    return {"url": f"/media/{basename}{ext}"}


@api.delete("/characters/{cid}")
async def delete_character(cid: str, current_user: dict = Depends(get_current_user)):
    c = await characters.get(cid)
    if not c:
        raise HTTPException(404, "character not found")
    owner_id = c.get("owner_id")
    # Owner can always delete their own character; admin can delete anything
    if owner_id != current_user["id"] and not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized to delete this character")
    await characters.delete(cid)
    await memory_facts.purge_char(cid)
    await vectors.delete_lore_vectors_by_char(cid)
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
        except Exception as e:
            log.debug("card import: no text chunks in image: %s: %s", type(e).__name__, e)
        chunks.update({k: v for k, v in img.info.items() if isinstance(v, str)})
        blob = chunks.get("ccv3") or chunks.get("chara")
        if not blob:
            raise ValueError("no character data in image")
        raw = json.loads(base64.b64decode(blob).decode("utf-8", "ignore"))
    # v1 cards are a bare object with these same field names and no {spec,data}
    # wrapper, no character_book, and no extensions — the "data" fallback to
    # raw itself, plus .get() defaults everywhere below, already cover that
    # shape without any v1-specific branch needed.
    d = raw.get("data") if isinstance(raw, dict) and "data" in raw else raw
    persona = d.get("description", "") or ""
    personality = d.get("personality", "") or ""
    if personality and personality not in persona:
        persona = (persona + ("\n\n" if persona else "") + "Personality: " + personality)
    # v4 (this app's own round-trip format) rides inside data.extensions.storyhaven
    # — a v2/v3 card simply won't have this key, so sh ends up {} and every field
    # below falls back to this app's own create_character defaults.
    sh = (d.get("extensions") or {}).get("storyhaven") or {}
    return {
        "name": d.get("name", "") or "Imported character",
        "persona": persona, "scenario": d.get("scenario", "") or "",
        "greeting": d.get("first_mes", "") or "", "dialogue": d.get("mes_example", "") or "",
        "system_prompt": d.get("system_prompt", "") or "", "tags": d.get("tags", []) or [],
        "creator": d.get("creator", "") or "imported",
        "alt_greetings": d.get("alternate_greetings", []) or [],
        "character_book": d.get("character_book") or {},
        "mode": sh.get("mode", "character") if sh.get("mode") in ("character", "rpg") else "character",
        "presentation_html": sh.get("presentation_html", "") or "",
        "is_explicit": bool(sh.get("is_explicit")),
        "can_be_persona": bool(sh.get("can_be_persona")),
        "allow_download": bool(sh.get("allow_download")),
        # Left undecoded (any embedded images stay as data URIs) — parse_card
        # itself must never write files, since parsing happens both for the
        # save-nothing-yet import preview and for reimport, and a preview the
        # user discards without saving shouldn't leave orphaned media files
        # on disk. Whoever actually persists the character is responsible for
        # decoding these for real at that point.
        "assets": sh.get("assets") or {},
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
    except Exception as e:
        log.warning("lore image decode failed: %s: %s", type(e).__name__, e)
        return ""
    fname = f"{db.nid('limg')}.{ext}"
    with open(os.path.join(MEDIA_DIR, fname), "wb") as fh:
        fh.write(data)
    return f"/media/{fname}"


def _decode_media_paths(value):
    """Reverse of _embed_media_paths: walks an imported v4 assets blob and
    writes any inline data:image/... URI back out to a real media file,
    replacing it with the resulting /media path. Non-data-URI strings pass
    through unchanged (e.g. a v4 card built without a given asset present)."""
    if isinstance(value, dict):
        return {k: _decode_media_paths(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_decode_media_paths(v) for v in value]
    if isinstance(value, str) and value.startswith("data:image/"):
        return _decode_lore_image(value) or value
    return value


@api.post("/characters/import")
async def import_character(file: UploadFile = File(...),
                           current_user: dict = Depends(get_current_user)):
    guest_quota.require_full(current_user, "import characters")
    """Parses a card and returns its fields for the editor to prefill — this
    does NOT create or save anything. The importer reviews/edits in the normal
    "new character" editor and only a real, explicit Save persists it, same as
    writing one from scratch. (Previously this saved immediately, which meant
    dropping a card into the editor's own import dropzone silently created a
    character and navigated away from the very form the user was looking at.)"""
    data = await file.read()
    _check_upload_size(data)
    try:
        card = parse_card(file.filename, data)
    except Exception as e:
        log.warning("character import: card parse failed by=%s: %s: %s",
                    current_user["username"], type(e).__name__, e)
        raise HTTPException(400, f"Could not read card: {e}")
    is_image_card = not (file.filename or "").lower().endswith(".json")
    avatar_data_url = None
    if is_image_card:
        mime = (file.content_type or "image/png")
        avatar_data_url = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
    lore = []
    for e in (card["character_book"].get("entries") or []):
        if e.get("enabled") is False:
            continue
        content = e.get("content")
        if isinstance(content, list):
            content = "\n".join(content)
        if not content:
            continue
        extensions = e.get("extensions") or {}
        meta = extensions.get("storyhavenai") or extensions.get("personae") or {}
        lore.append({
            "keys": e.get("keys") or [], "content": content, "always": bool(e.get("constant")),
            "category": meta.get("category", ""), "name": meta.get("name") or e.get("comment") or "",
            "appearance_tags": meta.get("appearance_tags", ""),
            "appearance_tags_negative": meta.get("appearance_tags_negative", ""),
            # Left as a data URI (not written to a media file) — the character
            # doesn't exist yet, and if the user never saves, nothing orphaned
            # is left on disk. Decoded for real only once lore is actually
            # created after the character itself is saved.
            "image_data": meta.get("image_data"),
        })
    return {
        "name": card["name"], "persona": card["persona"], "scenario": card["scenario"],
        "greeting": card["greeting"], "dialogue": card["dialogue"],
        "system_prompt": card["system_prompt"], "tags": card["tags"],
        "alt_greetings": card["alt_greetings"], "mode": card["mode"],
        "presentation_html": card["presentation_html"], "is_explicit": card["is_explicit"],
        "assets": card["assets"], "avatar_data_url": avatar_data_url, "lore": lore,
    }


@api.post("/characters/generate-from-description")
async def generate_from_description(request: Request,
                                    current_user: dict = Depends(get_current_user)):
    """Expand a plaintext description into structured character fields via the
    LLM and return them for the editor to prefill — no DB write, same as the
    import preview. The user reviews the filled form and must click Save."""
    try:
        raw = await request.json()
    except Exception as e:
        log.warning("generate_from_description: could not parse request body: %s", e)
        raw = None
    desc = str(raw.get("description") or "").strip() if isinstance(raw, dict) else ""
    if not desc:
        raise HTTPException(400, "description is required")
    _GENERATE_LIMIT.check_and_record(current_user["id"])
    user_overrides = await db.get_user_settings(current_user["id"])
    chat_model = _eff_cfg(user_overrides).get("chat_model") or CFG["chat_model"]
    ep = await _endpoints(user_overrides, current_user["id"], current_user.get("is_admin", False))
    return await generate_character_from_description(
        desc, chat_model, chat_base=ep["chat_base"], chat_key=ep["chat_key"])


@api.post("/characters/{cid}/reimport")
async def reimport_character(cid: str, file: UploadFile = File(...),
                             current_user: dict = Depends(get_current_user)):
    """Refresh an existing character from a newer card: overwrites the card fields
    (name, persona, scenario, greeting, dialogue, system prompt, tags, alternate
    greetings) in place. Ownership, visibility, creator attribution, stage assets,
    existing lore, and chats are untouched; a PNG card also refreshes the avatar."""
    c = await characters.get(cid)
    if not c:
        raise HTTPException(404, "character not found")
    if c.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "Not authorized")
    data = await file.read()
    _check_upload_size(data)
    try:
        card = parse_card(file.filename, data)
    except Exception as e:
        log.warning("character reimport: card parse failed id=%s by=%s: %s: %s",
                    cid, current_user["username"], type(e).__name__, e)
        raise HTTPException(400, f"Could not read card: {e}")
    upd = {k: card[k] for k in ("name", "persona", "scenario", "greeting", "dialogue",
                                "system_prompt", "tags", "alt_greetings")}
    if not (file.filename or "").lower().endswith(".json"):
        img_ext = await _save_uploaded_image(data, cid, ".png")
        upd["avatar"] = f"/media/{cid}{img_ext}"
    char = await characters.update(cid, upd)
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


def _embed_media_paths(value):
    """Walks an arbitrary JSON-ish structure (the character `assets` blob —
    banner, stage.default, sprites, etc. — shape not fixed) and replaces any
    /media/ path string with its inlined data URI, so a v4 export is fully
    self-contained instead of pointing at paths that only exist on this
    install. Non-media strings, and anything _embed_lore_image can't read
    (missing file, non-image path), pass through unchanged."""
    if isinstance(value, dict):
        return {k: _embed_media_paths(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_embed_media_paths(v) for v in value]
    if isinstance(value, str) and value.startswith("/media/"):
        return _embed_lore_image(value) or value
    return value


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
                "storyhavenai": {
                    "name": e.get("name", "") or "",
                    "category": e.get("category", "") or "",
                    "hidden": bool(e.get("hidden")),
                    "image_data": _embed_lore_image(e.get("image", "")),
                    "appearance_tags": e.get("appearance_tags", "") or "",
                    "appearance_tags_negative": e.get("appearance_tags_negative", "") or "",
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
    if spec in ("v3", "storyhaven"):
        # chara_card_v3 is additive over v2 — same `data` fields, plus these.
        avatar_url = _embed_lore_image(char.get("avatar", "")) if char.get("avatar", "").startswith("/media/") else None
        data["nickname"] = ""
        data["creator_notes_multilingual"] = {}
        data["source"] = []
        data["group_only_greetings"] = []
        data["creation_date"] = int(char.get("created", time.time()))
        data["modification_date"] = int(time.time())
        data["assets"] = [{"type": "icon", "uri": avatar_url or "ccdefault:", "name": "main", "ext": "png"}]
        if spec == "v3":
            return {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}
        # "storyhaven" is this app's own full-fidelity round-trip format — not a
        # numbered spec version, just this app's own extras riding inside the
        # spec's own reserved data.extensions slot. Additive over v3, so any
        # spec-v3 reader still opens it fine and just ignores what it doesn't
        # recognize; only this app reads data.extensions.storyhaven back out.
        data["extensions"]["storyhaven"] = {
            "mode": char.get("mode", "character"),
            "presentation_html": char.get("presentation_html", "") or "",
            "is_explicit": bool(char.get("is_explicit")),
            "can_be_persona": bool(char.get("can_be_persona")),
            "allow_download": bool(char.get("allow_download")),
            "assets": _embed_media_paths(char.get("assets") or {}),
        }
        return {"spec": "storyhaven_card", "spec_version": "1.0", "data": data}
    return {"spec": "chara_card_v2", "spec_version": "2.0", "data": data}


@api.get("/characters/{cid}/export")
async def export_character(cid: str, spec: str = "v2",
                           current_user: dict | None = Depends(get_current_user_optional)):
    if spec not in ("v2", "v3", "storyhaven"):
        raise HTTPException(400, "spec must be 'v2', 'v3', or 'storyhaven'")
    c = await characters.get(cid)
    if not c:
        raise HTTPException(404, "character not found")
    is_owner = bool(current_user) and c.get("owner_id") == current_user["id"]
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

