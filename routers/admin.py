"""Admin routes: user management, flagged endpoints, purge, logs."""
from fastapi import HTTPException, Depends

import db
import vectors
from state import api, CFG, log, _log_buffer
from auth import get_admin
from schemas import UserCreateIn

@api.get("/admin/users")
async def admin_list_users(_: dict = Depends(get_admin)):
    return await db.list_users()


@api.post("/admin/users")
async def admin_create_user(body: UserCreateIn, current_user: dict = Depends(get_admin)):
    existing = await db.get_user_by_username(body.username)
    if existing:
        raise HTTPException(400, "Username already taken")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    created = await db.create_user(body.username, body.password, is_admin=body.is_admin)
    log.info("admin: user created by=%s new_user=%s admin=%s", current_user["username"], body.username, body.is_admin)
    return created


@api.delete("/admin/users/{uid}")
async def admin_delete_user(uid: str, current_user: dict = Depends(get_admin)):
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot delete your own account")
    target = await db.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await db.delete_user(uid)
    log.info("admin: user deleted by=%s target=%s", current_user["username"], target["username"])
    return {"deleted": True}


@api.put("/admin/users/{uid}/password")
async def admin_reset_password(uid: str, body: UserCreateIn, current_user: dict = Depends(get_admin)):
    target = await db.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    await db.update_user_password(uid, body.password)
    log.info("admin: password reset by=%s target=%s", current_user["username"], target["username"])
    return {"ok": True}


@api.put("/admin/users/{uid}/role")
async def admin_update_role(uid: str, body: UserCreateIn, current_user: dict = Depends(get_admin)):
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot change your own role")
    target = await db.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await db.update_user_role(uid, body.is_admin)
    log.info("admin: role changed by=%s target=%s admin=%s", current_user["username"], target["username"], body.is_admin)
    return await db.get_user_by_id(uid)


@api.post("/admin/users/{uid}/approve")
async def admin_approve_user(uid: str, current_user: dict = Depends(get_admin)):
    target = await db.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await db.update_user_status(uid, "active")
    log.info("admin: user approved by=%s target=%s", current_user["username"], target["username"])
    return await db.get_user_by_id(uid)


@api.post("/admin/users/{uid}/deny")
async def admin_deny_user(uid: str, current_user: dict = Depends(get_admin)):
    target = await db.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot deny your own account")
    await db.delete_user(uid)
    log.info("admin: user denied by=%s target=%s", current_user["username"], target["username"])
    return {"denied": True}


@api.get("/admin/flagged-endpoints")
async def admin_list_flagged_endpoints(_: dict = Depends(get_admin)):
    return await db.list_flagged_endpoints(pending_only=True)


@api.post("/admin/flagged-endpoints/{fid}/block")
async def admin_block_flagged_endpoint(fid: str, current_user: dict = Depends(get_admin)):
    entry = await db.get_flagged_endpoint(fid)
    if not entry:
        raise HTTPException(404, "not found")
    await db.set_flagged_endpoint_status(fid, "blocked")
    log.info("admin: blocked flagged endpoint by=%s user=%s url=%s",
             current_user["username"], entry["user_id"], entry["url"])
    return {"status": "blocked"}


@api.post("/admin/flagged-endpoints/{fid}/allow")
async def admin_allow_flagged_endpoint(fid: str, current_user: dict = Depends(get_admin)):
    """Approves the endpoint despite it failing automatic verification (e.g. a
    self-hosted server on a legitimately private IP) and applies it to the
    requesting user's settings now, on the admin's authority."""
    entry = await db.get_flagged_endpoint(fid)
    if not entry:
        raise HTTPException(404, "not found")
    data = {"base_url": entry["url"]}
    if entry.get("api_key"):
        data["api_key"] = entry["api_key"]
    await db.set_user_settings(entry["user_id"], data)
    await db.set_flagged_endpoint_status(fid, "allowed")
    log.info("admin: allowed flagged endpoint by=%s user=%s url=%s",
             current_user["username"], entry["user_id"], entry["url"])
    return {"status": "allowed"}


@api.post("/admin/purge")
async def admin_purge(current_user: dict = Depends(get_admin)):
    """Wipe all characters, personas, lore, sessions, messages, and vector data.
    Users and auth sessions are preserved."""
    await db.purge_content()
    await vectors.reset_indexes(CFG["embed_dim"])
    log.warning("ADMIN PURGE executed by %s", current_user["username"])
    return {"purged": True}


@api.post("/admin/purge-memory")
async def admin_purge_memory(current_user: dict = Depends(get_admin)):
    """Wipe only long-term memory vectors (mem_idx) — lore, characters, and message
    history are untouched. Use after a change to what language/format memory is
    stored in, so old entries don't mix with the new canon."""
    await vectors.purge_memory(CFG["embed_dim"])
    log.warning("ADMIN MEMORY PURGE executed by %s", current_user["username"])
    return {"purged": True}


_LOG_LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}


@api.get("/admin/logs")
async def admin_logs(level: str = "INFO", limit: int = 200, _: dict = Depends(get_admin)):
    """Recent server activity for debugging. Only ever contains what this app
    explicitly logs — IDs, roles, counts — never chat/character content, API
    keys, or endpoint URLs. See the _RingBufferHandler comment above for why
    raw request logs are deliberately excluded."""
    floor = _LOG_LEVELS.get(level.upper(), 20)
    entries = [e for e in _log_buffer.buffer if _LOG_LEVELS.get(e["level"], 20) >= floor]
    return {"logs": entries[-max(1, min(limit, 500)):]}

