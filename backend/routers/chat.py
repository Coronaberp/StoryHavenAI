"""Memory retrieval and the chat/regenerate/roll/continue SSE generation
endpoints — the actual "have a conversation" surface. Session CRUD lives in
sessions.py."""
from fastapi import HTTPException, Depends

from backend import db
from backend import vectors
from backend import llm
from backend.state import api, CFG
from backend.auth import get_current_user
from backend.chat_service import _own_session, _endpoints, _run
from backend.dice import roll_dice, format_roll, resolve_inline_rolls
from backend.schemas import RollIn, ChatIn


@api.get("/sessions/{sid}/memory")
async def get_memory(sid: str, q: str | None = None, k: int = 30,
                     current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    user_overrides = await db.get_user_settings(current_user["id"])
    ep = await _endpoints(user_overrides, current_user["id"], current_user.get("is_admin", False))

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
