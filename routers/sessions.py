"""Memory, session, message, in-chat image generation, and chat/regenerate/
roll/continue routes."""
import os
import json
import uuid
import base64

from fastapi import HTTPException, Depends
from fastapi.responses import StreamingResponse

import db
import vectors
import llm
import imagegen
from state import api, CFG, MEDIA_DIR, MAX_UPLOAD_BYTES, log
from auth import get_current_user
from media import _delete_media_file, _write_file, _save_uploaded_image
from chat_service import (_own_session, _endpoints, _eff_cfg, _ui_language,
                          _chat_language, _localize_texts, _generate_image_prompt, _run)
from prompt import macro, roll_dice, format_roll, resolve_inline_rolls
from schemas import (SessionIn, RenameIn, StyleIn, GlossaryIn, LanguageIn,
                     AuthorNoteIn, MessageEdit, RollIn, ChatIn,
                     ImageGenIn, ImageGenStandaloneIn, ImageGenSaveIn)

@api.get("/sessions/{sid}/memory")
async def get_memory(sid: str, q: str | None = None, k: int = 30,
                     current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    user_overrides = await db.get_user_settings(current_user["id"])
    ep = await _endpoints(user_overrides, current_user["id"])

    if q:
        # embed model/dim stay global (vectors share one index), but the endpoint
        # serving that model may be the user's own (see _endpoints)
        vec = await llm.embed(q, CFG["embed_model"],
                              base_url=ep["embed_base"], api_key=ep["embed_key"])
        items = await vectors.search_memory_scored(sid, vec, k)
    else:
        items = await vectors.list_memory(sid, k)

    return items


@api.delete("/sessions/{sid}/memory")
async def clear_memory(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    # translations in the localization cache are keyed by content hash and shared;
    # they stay behind harmlessly (and get reused if the same note ever recurs)
    await vectors.delete_by_tag(vectors.MEM_INDEX, "session", sid)
    return {"cleared": True}


@api.delete("/sessions/{sid}/memory/{mid}")
async def delete_memory_entry(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await vectors.delete_memory(mid)
    return {"deleted": True}


@api.post("/characters/{cid}/sessions")
async def new_session(cid: str, body: SessionIn,
                      current_user: dict = Depends(get_current_user)):
    char = await db.get_character(cid)
    if not char:
        raise HTTPException(404, "character not found")
    persona = await db.get_persona(body.persona_id) if body.persona_id else await db.default_persona(current_user["id"])
    user_name = persona["name"] if persona else "You"
    sid = await db.create_session(cid, persona["id"] if persona else None,
                                  char["name"], user_name, user_id=current_user["id"])
    greeting = macro(char.get("greeting", ""), char["name"], user_name)
    if greeting:
        # A brand-new session has no talk language yet, so this resolves to the
        # user's interface language (or the instance default). The greeting is
        # character-authored text, localized for display via the same persistent
        # cache as scenarios/personas (see /api/localize) — a pure cache lookup,
        # not a live LLM call.
        user_overrides = await db.get_user_settings(current_user["id"])
        language = _ui_language(user_overrides)
        try:
            [greeting_disp] = await _localize_texts([greeting], language)
        except Exception:
            log.warning("greeting localization failed: session=%s", sid)
            greeting_disp = greeting
        await db.add_message(sid, "assistant", greeting_disp, lang=language)
    return await db.get_session(sid)


@api.get("/sessions")
async def list_sessions(limit: int = 40, char_id: str | None = None,
                        current_user: dict = Depends(get_current_user)):
    return await db.list_sessions(limit, user_id=current_user["id"], char_id=char_id)


@api.get("/sessions/{sid}")
async def get_session(sid: str, current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    return s


@api.patch("/sessions/{sid}")
async def rename_session(sid: str, body: RenameIn,
                         current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await db.rename_session(sid, body.title)
    return {"ok": True}


@api.put("/sessions/{sid}/style")
async def set_session_style(sid: str, body: StyleIn,
                            current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await db.set_session_style(sid, body.key, body.prompt or None)
    return {"ok": True}


@api.put("/sessions/{sid}/glossary")
async def set_session_glossary(sid: str, body: GlossaryIn,
                               current_user: dict = Depends(get_current_user)):
    """Per-session terminology pins: {source term: exact rendering}. Injected into
    every translation prompt for this session so class names, spells, ranks etc.
    are always rendered exactly as the player wants — the vocabulary counterpart
    of known_names."""
    await _own_session(sid, current_user)
    gl = {k.strip(): v.strip() for k, v in (body.glossary or {}).items()
          if k.strip() and v.strip()}
    if len(gl) > 200:
        raise HTTPException(400, "glossary too large")
    await db.set_session_glossary(sid, json.dumps(gl, ensure_ascii=False))
    return {"ok": True, "glossary": gl}


@api.put("/sessions/{sid}/language")
async def set_session_language(sid: str, body: LanguageIn,
                               current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    lang = (body.language or "").strip() or None
    await db.set_session_language(sid, lang)
    return {"ok": True, "language": lang}


@api.put("/sessions/{sid}/note")
async def set_session_author_note(sid: str, body: AuthorNoteIn,
                                  current_user: dict = Depends(get_current_user)):
    """Persistent Author's Note: re-injected as the last message before every
    generation (see the author_note block in _run) so it survives long
    conversations instead of scrolling out of the history window."""
    await _own_session(sid, current_user)
    note = (body.note or "").strip() or None
    await db.set_session_author_note(sid, note)
    return {"ok": True, "note": note}


@api.get("/sessions/{sid}/state")
async def get_char_state(sid: str, current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    doing, location = s.get("char_doing") or "", s.get("char_location") or ""
    known_names = json.loads(s.get("known_names") or "[]")
    display_names = known_names
    if known_names:
        try:
            user_overrides = await db.get_user_settings(current_user["id"])
            display_names = await _localize_texts(known_names, _ui_language(user_overrides))
        except Exception:
            pass
    return {
        "doing": doing,
        "location": location,
        "known_names": display_names,
    }


@api.delete("/sessions/{sid}")
async def delete_session(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await db.delete_session(sid)
    await vectors.delete_by_tag(vectors.MEM_INDEX, "session", sid)
    return {"deleted": True}


@api.patch("/sessions/{sid}/messages/{mid}")
async def edit_message(sid: str, mid: str, body: MessageEdit,
                       current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await db.edit_message(sid, mid, body.content)
    return {"ok": True}


async def _build_image_prompt_for_message(sid: str, mid: str, current_user: dict) -> tuple[dict, dict, dict, str]:
    """Shared setup for both the prompt-preview and the actual generation endpoint:
    resolves the session/message/character and returns the auto-generated (positive,
    negative) tags — see _generate_image_prompt for what feeds into them."""
    s = await _own_session(sid, current_user)
    msgs = await db.get_messages(sid)
    msg = next((m for m in msgs if m["id"] == mid), None)
    if not msg:
        raise HTTPException(404, "message not found")
    char = await db.get_character(s["char_id"])
    if not char:
        raise HTTPException(404, "character not found")

    user_overrides = await db.get_user_settings(current_user["id"])
    chat_model = _eff_cfg(user_overrides).get("chat_model") or CFG["chat_model"]
    ep = await _endpoints(user_overrides, current_user["id"])

    # Same keyword-trigger lookup retrieve() uses for chat context — pulls in any lore
    # entry whose keys appear in the scene, plus the main character's own established
    # look, so the model describes named characters/places consistently instead of
    # inventing new appearances every generation.
    #
    # Optional opt-in: any lore entry with its own appearance_tags field (pre-written
    # Danbooru tags, entered alongside that entry's image) has those tags injected into
    # the positive prompt verbatim instead of being paraphrased by the LLM rewrite —
    # entries that leave the field blank behave exactly as before (prose, rewritten
    # each time).
    appearance_lines = []
    direct_tags = []
    direct_negative_tags = []
    if char.get("persona"):
        appearance_lines.append(f"- {char['name']}: {char['persona']}".replace("\n", " "))
    scene_lower = msg["content"].lower()
    for e in await db.list_lore(s["char_id"]):
        if e["always"] or any(k.lower() in scene_lower for k in e["keys"]):
            if e.get("appearance_tags"):
                direct_tags.append(e["appearance_tags"].strip())
            if e.get("appearance_tags_negative"):
                direct_negative_tags.append(e["appearance_tags_negative"].strip())
            if e["content"]:
                appearance_lines.append("- " + e["content"].replace("\n", " "))

    positive, negative = await _generate_image_prompt(
        msg["content"], char["name"], chat_model, appearance_lines, direct_tags, direct_negative_tags,
        chat_base=ep["chat_base"], chat_key=ep["chat_key"])
    return s, msg, char, positive, negative


@api.post("/sessions/{sid}/messages/{mid}/image-prompt")
async def preview_message_image_prompt(sid: str, mid: str,
                                       current_user: dict = Depends(get_current_user)):
    """Runs just the tag-generation step so the UI can show the auto-generated positive/
    negative prompts as separate editable fields before actually calling ComfyUI."""
    _, _, _, positive, negative = await _build_image_prompt_for_message(sid, mid, current_user)
    return {"positive": positive, "negative": negative}


@api.post("/sessions/{sid}/messages/{mid}/image")
async def generate_message_image(sid: str, mid: str, body: ImageGenIn,
                                 current_user: dict = Depends(get_current_user)):
    s, msg, char, auto_positive, auto_negative = await _build_image_prompt_for_message(sid, mid, current_user)
    positive = body.positive if body.positive is not None else auto_positive
    negative = body.negative if body.negative is not None else auto_negative
    checkpoint = body.checkpoint or CFG["comfyui_checkpoint"]
    try:
        image_bytes = await imagegen.generate_image(
            positive, negative, CFG["comfyui_url"], checkpoint,
            custom_workflow=CFG["comfyui_workflow"],
            lora=body.lora, lora_strength=body.lora_strength)
    except Exception as e:
        raise HTTPException(502, f"Image generation failed: {e}")

    _delete_media_file(msg.get("image"))

    fname = f"img_{uuid.uuid4().hex[:10]}.png"
    await _write_file(os.path.join(MEDIA_DIR, fname), image_bytes)
    url = f"/media/{fname}"
    await db.set_message_image(sid, mid, url, positive, negative)
    return {"image": url}


@api.get("/imagegen/checkpoints")
async def get_imagegen_checkpoints(current_user: dict = Depends(get_current_user)):
    try:
        return await imagegen.list_checkpoints(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/imagegen/loras")
async def get_imagegen_loras(current_user: dict = Depends(get_current_user)):
    try:
        return await imagegen.list_loras(CFG["comfyui_url"])
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")


@api.get("/me/images")
async def list_my_images(current_user: dict = Depends(get_current_user)):
    return await db.list_user_images(current_user["id"])


@api.delete("/me/images/{mid}")
async def delete_my_image(mid: str, current_user: dict = Depends(get_current_user)):
    images = await db.list_user_images(current_user["id"])
    img = next((i for i in images if i["mid"] == mid), None)
    if not img:
        raise HTTPException(404, "image not found")
    _delete_media_file(img["image"])
    await db.set_message_image(img["sid"], mid, "")
    return {"deleted": True}


@api.post("/imagegen/standalone/stream")
async def stream_standalone_image(body: ImageGenStandaloneIn,
                                  current_user: dict = Depends(get_current_user)):
    """Live-preview generation for the standalone Image Gen page — not tied to any
    chat message. Nothing is written to disk or the DB here; the browser gets a
    stream of in-progress preview frames followed by the final image as a data
    URL, and only /imagegen/standalone/save persists anything, on explicit request."""
    checkpoint = body.checkpoint or CFG["comfyui_checkpoint"]

    async def gen():
        try:
            async for kind, data in imagegen.generate_image_stream(
                    body.positive, body.negative, CFG["comfyui_url"], checkpoint,
                    lora=body.lora, lora_strength=body.lora_strength):
                mime = "image/jpeg" if kind == "preview" else "image/png"
                b64 = base64.b64encode(data).decode()
                yield "data: " + json.dumps({
                    "type": kind, "image": f"data:{mime};base64,{b64}",
                }) + "\n\n"
        except Exception as e:
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@api.post("/imagegen/standalone/save")
async def save_standalone_image(body: ImageGenSaveIn, current_user: dict = Depends(get_current_user)):
    if not body.image.startswith("data:image/"):
        raise HTTPException(400, "expected a data:image/... URL")
    header, _, b64data = body.image.partition(",")
    # cap the encoded payload before decoding — base64 inflates ~33%, so a 15MB
    # image is ~20MB of base64; reject anything larger before allocating the decode.
    if len(b64data) > MAX_UPLOAD_BYTES * 4 // 3 + 256:
        raise HTTPException(413, f"image too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")
    try:
        data = base64.b64decode(b64data)
    except Exception:
        raise HTTPException(400, "invalid base64 image data")
    fname = f"img_{uuid.uuid4().hex[:10]}.png"
    await _write_file(os.path.join(MEDIA_DIR, fname), data)
    url = f"/media/{fname}"
    rec = await db.create_standalone_image(current_user["id"], url, body.positive, body.negative)
    return rec


@api.get("/imagegen/standalone")
async def list_standalone_images(current_user: dict = Depends(get_current_user)):
    return await db.list_standalone_images(current_user["id"])


@api.delete("/imagegen/standalone/{iid}")
async def delete_standalone_image(iid: str, current_user: dict = Depends(get_current_user)):
    url = await db.delete_standalone_image(iid, current_user["id"])
    if url is None:
        raise HTTPException(404, "image not found")
    _delete_media_file(url)
    return {"deleted": True}


@api.delete("/sessions/{sid}/messages/{mid}")
async def delete_message(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    msgs = await db.get_messages(sid)
    idx = next((i for i, m in enumerate(msgs) if m["id"] == mid), None)
    if idx is not None:
        _delete_media_file(msgs[idx].get("image"))
    await db.delete_message(sid, mid)
    if idx is not None:
        if msgs[idx]["role"] == "user":
            # memory is keyed by the triggering user message id
            await vectors.delete_memory(mid)
        else:
            # assistant reply — its memory (if any) is keyed by the user turn before it
            prev_user = next((m for m in reversed(msgs[:idx]) if m["role"] == "user"), None)
            if prev_user:
                await vectors.delete_memory(prev_user["id"])
    return {"ok": True}


@api.post("/sessions/{sid}/chat")
async def chat(sid: str, body: ChatIn, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    return await _run(sid, user_content=resolve_inline_rolls(body.content),
                      think=body.think, current_user=current_user)


@api.post("/sessions/{sid}/regenerate")
async def regenerate(sid: str, body: ChatIn | None = None,
                     current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    return await _run(sid, regenerate=True,
                      think=(body.think if body else None), current_user=current_user)


@api.post("/sessions/{sid}/roll")
async def roll(sid: str, body: RollIn, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    try:
        r = roll_dice(body.expr)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return await _run(sid, user_content=format_roll(r, body.note),
                      think=body.think, current_user=current_user)


@api.post("/sessions/{sid}/continue")
async def continue_chat(sid: str, body: ChatIn | None = None,
                        current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    direction = body.content if (body and body.content and body.content.strip()) else None
    return await _run(sid, continue_mode=True, direction=direction,
                      think=(body.think if body else None), current_user=current_user)

