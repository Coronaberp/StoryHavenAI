from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.db import roles, users, _q, _q1, _w, _scalar
from backend.state import log

BUILTIN_ROLES = [("guest", "Guest"), ("member", "Member"), ("admin", "Admin")]

async def get(name: str) -> dict | None:
    row = await _q1(select(roles).where(roles.c.name == name))
    if not row:
        return None
    return {"name": row["name"], "label": row["label"], "is_builtin": bool(row["is_builtin"])}

async def create(name: str, label: str) -> None:
    if name == "dev":
        raise ValueError("'dev' is a hardcoded role and cannot be created")
    if await get(name):
        raise ValueError(f"role '{name}' already exists")
    await _w(roles.insert().values(name=name, label=label, is_builtin=False))
    log.info("roles: created name=%s label=%s", name, label)

async def delete(name: str) -> None:
    row = await get(name)
    if not row:
        return
    if row["is_builtin"]:
        raise ValueError(f"'{name}' is a built-in role and cannot be deleted")
    in_use = await _scalar(select(func.count()).select_from(users).where(users.c.role == name))
    if in_use:
        raise ValueError(f"role '{name}' is still assigned to {in_use} user(s)")
    await _w(roles.delete().where(roles.c.name == name))
    log.info("roles: deleted name=%s", name)

async def list_all() -> list[dict]:
    rows = await _q(select(roles))
    result = []
    for r in rows:
        count = await _scalar(select(func.count()).select_from(users).where(users.c.role == r["name"]))
        result.append({"name": r["name"], "label": r["label"], "is_builtin": bool(r["is_builtin"]),
                        "user_count": count})
    return result

async def seed_builtins() -> None:
    for name, label in BUILTIN_ROLES:
        stmt = pg_insert(roles).values(name=name, label=label, is_builtin=True)
        stmt = stmt.on_conflict_do_nothing(index_elements=["name"])
        await _w(stmt)
    log.info("roles: builtins seeded")
