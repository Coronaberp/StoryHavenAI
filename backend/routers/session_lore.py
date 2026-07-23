from fastapi import HTTPException, Depends

from backend import db
from backend.state import api, CFG, log
from backend.auth import get_current_user
from backend.chat_service import _own_session, _eff_cfg, _endpoints
from backend.repositories import lore
from backend.repositories import lore_links
from backend.repositories import lore_secrets as ls
from backend.repositories import session_lore_state as sls
from backend.repositories import memory_facts
from backend import lore_memory
from backend import ai_helpers
from backend.schemas import SessionLoreOverrideIn


async def _translate_for_session(text: str, session: dict, current_user: dict) -> str:
    if not text or not session.get("language"):
        return text
    from backend.routers.misc import translate_text_live
    user_overrides = await db.get_user_settings(current_user["id"])
    eff = _eff_cfg(user_overrides)
    ep = await _endpoints(user_overrides, current_user["id"], current_user["is_admin"])
    try:
        translated = await translate_text_live(
            text, session["language"], eff.get("chat_model") or CFG["chat_model"], ep)
        return translated or text
    except Exception as e:
        log.warning("session_lore: reveal translation failed session=%s: %s: %s",
                    session["id"], type(e).__name__, e)
        return text


async def _ensure_secrets(entry: dict) -> list[dict]:
    existing = await ls.secrets_for(entry["id"])
    if existing:
        return existing
    try:
        texts = await ai_helpers.extract_lore_secrets(entry["content"], CFG["chat_model"])
    except Exception as e:
        log.warning("session_lore: secret extraction failed lore=%s: %s: %s",
                    entry["id"], type(e).__name__, e)
        return []
    if not texts:
        return []
    return await ls.set_secrets(entry["id"], texts)


async def _revealed_content(sid: str, entry: dict) -> str | None:
    secrets = await _ensure_secrets(entry)
    if not secrets:
        return None
    revealed = await ls.revealed_ids(sid, [s["id"] for s in secrets])
    if not revealed:
        return None
    return "\n".join(f"- {s['text']}" for s in secrets if s["id"] in revealed)


async def _entry_with_session_state(sid: str, entry: dict, state: dict | None) -> dict | None:
    effective = dict(entry)
    effective["player_edited"] = bool(state and state.get("override_content") is not None)
    if state and state.get("override_content") is not None:
        effective["content"] = state["override_content"]
        return effective
    if not entry["hidden"]:
        return effective
    revealed = await _revealed_content(sid, entry)
    if revealed is None:
        return None
    effective["content"] = revealed
    return effective


@api.get("/sessions/{sid}/lore")
async def list_session_lore(sid: str, current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entries = await lore.list_for_character(session["char_id"], current_user["id"])
    result = []
    for e in entries:
        state = await sls.get_state(sid, e["id"])
        effective = await _entry_with_session_state(sid, e, state)
        if effective is not None:
            effective["content"] = await _translate_for_session(effective["content"], session, current_user)
            result.append(effective)
    visible_ids = {e["id"] for e in result}
    outgoing = await lore_links.outgoing_for_many(list(visible_ids))
    for e in result:
        e["links"] = [{"target_id": link["target_id"], "label": link["label"]}
                      for link in outgoing.get(e["id"], []) if link["target_id"] in visible_ids]
    return result


@api.get("/sessions/{sid}/lore/hidden")
async def list_hidden_session_lore(sid: str, current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entries = await lore.list_for_character(session["char_id"], current_user["id"])
    result = []
    for e in entries:
        if not e["hidden"]:
            continue
        secrets = await _ensure_secrets(e)
        if not secrets:
            continue
        revealed = await ls.revealed_ids(sid, [s["id"] for s in secrets])
        if len(revealed) < len(secrets):
            result.append({"id": e["id"], "name": e["name"], "category": e["category"]})
    return result


@api.get("/sessions/{sid}/lore/{lid}/secrets")
async def get_lore_secrets(sid: str, lid: str, current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    secrets = await _ensure_secrets(entry)
    revealed = await ls.revealed_ids(sid, [s["id"] for s in secrets])
    result = []
    for s in secrets:
        text = s["text"] if s["id"] in revealed else None
        if text:
            text = await _translate_for_session(text, session, current_user)
        result.append({"id": s["id"], "revealed": s["id"] in revealed, "text": text})
    return result


@api.post("/sessions/{sid}/lore/{lid}/secrets/{secret_id}/reveal")
async def reveal_lore_secret(sid: str, lid: str, secret_id: str,
                             current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    secrets = await ls.secrets_for(lid)
    match = next((s for s in secrets if s["id"] == secret_id), None)
    if not match:
        raise HTTPException(404, "secret not found on this entry")
    await lore_memory.apply_secret_reveal(sid, session["char_id"], secret_id, match["text"])
    log.info("session_lore: revealed session=%s lore=%s secret=%s by=%s",
             sid, lid, secret_id, current_user["username"])
    display_text = await _translate_for_session(match["text"], session, current_user)
    return {"id": secret_id, "revealed": True, "text": display_text}


@api.put("/sessions/{sid}/lore/{lid}/override")
async def set_session_lore_override(sid: str, lid: str, body: SessionLoreOverrideIn,
                                    current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    if body.content is None:
        fact_id = await sls.clear_override(sid, lid)
        if fact_id:
            await memory_facts.expire(fact_id)
        log.info("session_lore: override cleared session=%s lore=%s by=%s", sid, lid, current_user["username"])
        return {"content": None}
    fact_id = await lore_memory.apply_session_lore_override(
        sid, session["char_id"], lid, body.content)
    log.info("session_lore: override set session=%s lore=%s fact=%s by=%s",
             sid, lid, fact_id, current_user["username"])
    return {"content": body.content}
