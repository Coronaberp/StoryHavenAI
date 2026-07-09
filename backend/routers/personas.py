"""Persona CRUD routes."""
from fastapi import HTTPException, Depends

from backend import db
from backend.state import api, CFG
from backend.auth import get_current_user
from backend.schemas import PersonaIn, ExpandPersonaIn
from backend.chat_service import expand_persona_description, _endpoints, _eff_cfg
from backend.ratelimit import SlidingWindow

_EXPAND_LIMIT = SlidingWindow(
    10, 60, "Too many generations — please wait a moment and try again")

@api.get("/personas")
async def list_personas(current_user: dict = Depends(get_current_user)):
    return await db.list_own_personas(current_user["id"])


@api.get("/personas/drafts")
async def list_draft_personas(current_user: dict = Depends(get_current_user)):
    return await db.list_draft_personas(current_user["id"])


@api.post("/personas/expand-description")
async def expand_description(body: ExpandPersonaIn,
                             current_user: dict = Depends(get_current_user)):
    """Expand/normalize a plaintext persona description (full persona or short
    descriptors) into complete prose via the LLM and return it. No DB write —
    the frontend drops the result back into the textarea for the user to review
    and Save."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    _EXPAND_LIMIT.check_and_record(current_user["id"])
    user_overrides = await db.get_user_settings(current_user["id"])
    chat_model = _eff_cfg(user_overrides).get("chat_model") or CFG["chat_model"]
    ep = await _endpoints(user_overrides, current_user["id"], current_user.get("is_admin", False))
    return {"description": await expand_persona_description(
        text, chat_model, chat_base=ep["chat_base"], chat_key=ep["chat_key"])}


@api.post("/characters/{cid}/persona")
async def become_persona(cid: str, current_user: dict = Depends(get_current_user)):
    char = await db.get_character(cid)
    if not char:
        raise HTTPException(404, "character not found")
    if not char.get("can_be_persona"):
        raise HTTPException(403, "This character can't be played as a persona")
    if not char.get("is_public") and char.get("owner_id") != current_user["id"]:
        raise HTTPException(404, "character not found")
    return await db.get_or_create_persona_from_character(char, current_user["id"])


@api.post("/personas")
async def create_persona(body: PersonaIn, current_user: dict = Depends(get_current_user)):
    return await db.create_persona(body.model_dump(), current_user["id"])


@api.put("/personas/{pid}")
async def update_persona(pid: str, body: PersonaIn, current_user: dict = Depends(get_current_user)):
    p = await db.get_persona(pid)
    if not p:
        raise HTTPException(404, "persona not found")
    if p.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "not your persona")
    p = await db.update_persona(pid, body.model_dump(), current_user["id"])
    return p


@api.delete("/personas/{pid}")
async def delete_persona(pid: str, current_user: dict = Depends(get_current_user)):
    p = await db.get_persona(pid)
    if not p:
        raise HTTPException(404, "persona not found")
    if p.get("owner_id") != current_user["id"]:
        raise HTTPException(403, "not your persona")
    await db.delete_persona(pid)
    return {"deleted": True}

