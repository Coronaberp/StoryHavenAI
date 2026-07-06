"""Persona CRUD routes."""
from fastapi import HTTPException, Depends

import db
from state import api
from auth import get_current_user
from schemas import PersonaIn

@api.get("/personas")
async def list_personas(current_user: dict = Depends(get_current_user)):
    return await db.list_own_personas(current_user["id"])


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

