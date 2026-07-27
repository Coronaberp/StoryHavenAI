from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.db import role_permissions, _q, _q1, _w
from backend.state import log

FEATURE_KEYS = ["chat", "lora_training", "comments", "forum", "characters", "personas",
                "lore", "groups", "emojis", "group_chats", "profile", "follows", "tts"]

ADMIN_RESOURCES = ["user_management", "moderation_queue", "invite_codes", "server_logs",
                   "model_request_approval", "site_announcements", "emoji_moderation",
                   "feature_flags_admin", "service_health", "lora_training_admin",
                   "model_previews_curation", "system_settings"]

def _row(r) -> dict:
    return {"can_read": bool(r["can_read"]), "can_write": bool(r["can_write"]),
            "can_execute": bool(r["can_execute"])}

async def get(role: str, resource: str) -> dict | None:
    row = await _q1(select(role_permissions).where(
        role_permissions.c.role == role, role_permissions.c.resource == resource))
    return _row(row) if row else None

async def set(role: str, resource: str, can_read: bool, can_write: bool, can_execute: bool) -> None:
    stmt = pg_insert(role_permissions).values(
        role=role, resource=resource, can_read=can_read, can_write=can_write, can_execute=can_execute)
    stmt = stmt.on_conflict_do_update(
        index_elements=["role", "resource"],
        set_={"can_read": can_read, "can_write": can_write, "can_execute": can_execute})
    await _w(stmt)
    log.info("role_permissions: set role=%s resource=%s r=%s w=%s x=%s",
             role, resource, can_read, can_write, can_execute)

async def list_all() -> list[dict]:
    rows = await _q(select(role_permissions))
    return [{"role": r["role"], "resource": r["resource"], **_row(r)} for r in rows]

async def _seed_row_if_absent(role: str, resource: str, can_read: bool, can_write: bool, can_execute: bool) -> None:
    stmt = pg_insert(role_permissions).values(
        role=role, resource=resource, can_read=can_read, can_write=can_write, can_execute=can_execute)
    stmt = stmt.on_conflict_do_nothing(index_elements=["role", "resource"])
    await _w(stmt)

async def seed_defaults() -> None:
    for key in FEATURE_KEYS:
        if key == "chat":
            await _seed_row_if_absent("guest", key, True, True, False)
        await _seed_row_if_absent("member", key, True, True, False)
        await _seed_row_if_absent("admin", key, True, True, True)
    for resource in ADMIN_RESOURCES:
        await _seed_row_if_absent("admin", resource, True, True, True)
    await _seed_row_if_absent("guest", "test_site_access", True, True, False)
    await _seed_row_if_absent("member", "test_site_access", True, True, False)
    await _seed_row_if_absent("admin", "test_site_access", True, True, True)
    log.info("role_permissions: default matrix seeded")
