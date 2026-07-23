"""Memory retrieval and the chat/regenerate/roll/continue SSE generation
endpoints — the actual "have a conversation" surface. Session CRUD lives in
sessions.py."""
from fastapi import HTTPException, Depends

from backend import db
from backend import llm
from backend.repositories import memory_facts
from backend.state import api, CFG
from backend.auth import get_current_user
from backend.chat_service import _own_session, _endpoints, _run, run_group_speak
from backend.dice import roll_dice, format_roll, resolve_inline_rolls
from backend import guest_quota
from backend.feature_flags import require_feature_enabled
from backend.prompt import apply_directive, apply_inline_directives, strip_sigil
from backend.schemas import RollIn, ChatIn


MEMORY_LIST_MAX = 1000


@api.get("/sessions/{sid}/memory")
async def get_memory(sid: str, q: str | None = None, k: int = 30,
                     current_user: dict = Depends(get_current_user)):
    s = await _own_session(sid, current_user)
    user_overrides = await db.get_user_settings(current_user["id"])
    ep = await _endpoints(user_overrides, current_user["id"], current_user.get("is_admin", False))

    if q:
        vec = await llm.embed(q, CFG["embed_model"],
                              base_url=ep["embed_base"], api_key=ep["embed_key"])
        candidates = await memory_facts.similar_live(sid, vec, k)
        total = len(candidates)
        return {"items": [{"id": c["id"], "text": c["text"]} for c in candidates], "total": total}
    total = await memory_facts.count_live(sid)
    live = await memory_facts.list_live(sid, MEMORY_LIST_MAX)
    return {"items": [{"id": f["id"], "text": f["text"]} for f in live], "total": total}


@api.delete("/sessions/{sid}/memory")
async def clear_memory(sid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await memory_facts.purge_session(sid)
    return {"cleared": True}


@api.delete("/sessions/{sid}/memory/{mid}")
async def delete_memory_entry(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await memory_facts.expire(mid)
    return {"deleted": True}


@api.post("/sessions/{sid}/speak/{char_id}")
async def group_speak(sid: str, char_id: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    guest_quota.check(current_user, "tokens")
    return await run_group_speak(sid, char_id, current_user)


@api.post("/sessions/{sid}/messages/{mid}/reassign/{char_id}")
async def group_reassign(sid: str, mid: str, char_id: str, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    guest_quota.check(current_user, "tokens")
    return await run_group_speak(sid, char_id, current_user, replace_mid=mid)


@api.post("/sessions/{sid}/chat")
async def chat(sid: str, body: ChatIn, current_user: dict = Depends(get_current_user),
               _feature_ok: None = Depends(require_feature_enabled("chat"))):
    await _own_session(sid, current_user)
    guest_quota.check(current_user, "tokens")
    content = resolve_inline_rolls(body.content)
    content = (apply_directive(content, body.directive, body.directive_arg) if body.directive
              else apply_inline_directives(content))
    return await _run(sid, user_content=content,
                      think=body.think, current_user=current_user)


@api.post("/sessions/{sid}/regenerate")
async def regenerate(sid: str, body: ChatIn | None = None,
                     current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    guest_quota.check(current_user, "tokens")
    return await _run(sid, regenerate=True,
                      think=(body.think if body else None), current_user=current_user)


@api.post("/sessions/{sid}/roll")
async def roll(sid: str, body: RollIn, current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    guest_quota.check(current_user, "tokens")
    try:
        r = roll_dice(body.expr)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return await _run(sid, user_content=apply_directive(format_roll(r, body.note), "roll"),
                      think=body.think, current_user=current_user)


@api.post("/sessions/{sid}/continue")
async def continue_chat(sid: str, body: ChatIn | None = None,
                        current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    guest_quota.check(current_user, "tokens")
    direction = strip_sigil(body.content) if (body and body.content and body.content.strip()) else None
    return await _run(sid, continue_mode=True, direction=direction,
                      think=(body.think if body else None), current_user=current_user)
