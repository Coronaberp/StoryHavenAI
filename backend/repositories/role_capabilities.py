from sqlalchemy import select, delete as sa_delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.db import role_capabilities, _q, _q1, _w
from backend.state import log

async def has(role: str, capability: str) -> bool:
    row = await _q1(select(role_capabilities).where(
        role_capabilities.c.role == role, role_capabilities.c.capability == capability))
    return row is not None

async def grant(role: str, capability: str) -> None:
    stmt = pg_insert(role_capabilities).values(role=role, capability=capability)
    stmt = stmt.on_conflict_do_nothing(index_elements=["role", "capability"])
    await _w(stmt)
    log.info("role_capabilities: granted role=%s capability=%s", role, capability)

async def revoke(role: str, capability: str) -> None:
    await _w(sa_delete(role_capabilities).where(
        role_capabilities.c.role == role, role_capabilities.c.capability == capability))
    log.info("role_capabilities: revoked role=%s capability=%s", role, capability)

async def list_for_role(role: str) -> list[str]:
    rows = await _q(select(role_capabilities.c.capability).where(role_capabilities.c.role == role))
    return [r["capability"] for r in rows]

async def set_all(role: str, capabilities: list[str]) -> None:
    await _w(sa_delete(role_capabilities).where(role_capabilities.c.role == role))
    for cap in capabilities:
        await grant(role, cap)
    log.info("role_capabilities: set_all role=%s count=%d", role, len(capabilities))

async def seed_defaults() -> None:
    from backend.auth import CAPABILITY_REGISTRY
    from backend.repositories import roles as roles_repo
    for role in ("guest", "member"):
        row = await roles_repo.get(role)
        if row and not row["capabilities_seeded"]:
            await grant(role, "test_site.toggle_own")
            await roles_repo.mark_capabilities_seeded(role)
    admin_row = await roles_repo.get("admin")
    if admin_row and not admin_row["capabilities_seeded"]:
        for key in CAPABILITY_REGISTRY:
            await grant("admin", key)
        await roles_repo.mark_capabilities_seeded("admin")
    log.info("role_capabilities: defaults seeded (%d admin capabilities)", len(CAPABILITY_REGISTRY))
