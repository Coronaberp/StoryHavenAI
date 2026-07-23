import time

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.db import feature_flags
from backend.state import log


def _engine():
    from backend import db
    return db.engine()


async def get(key: str) -> dict | None:
    stmt = select(feature_flags).where(feature_flags.c.key == key)
    async with _engine().connect() as conn:
        row = (await conn.execute(stmt)).fetchone()
    return dict(row._mapping) if row else None


async def get_all() -> dict[str, dict]:
    stmt = select(feature_flags)
    async with _engine().connect() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return {r._mapping["key"]: dict(r._mapping) for r in rows}


async def apply_batch(keys: list[str], enabled: bool, message: str | None,
                      eta_minutes: int | None, updated_by: str, updated_by_name: str,
                      updated_by_role: str) -> list[dict]:
    now = int(time.time())
    disabled_at = None if enabled else now

    existing_keys = set()
    async with _engine().connect() as conn:
        stmt = select(feature_flags).where(feature_flags.c.key.in_(keys))
        rows = (await conn.execute(stmt)).fetchall()
        existing_keys = {r._mapping["key"] for r in rows}

    keys_to_upsert = [key for key in keys if key in existing_keys or not enabled]

    async with _engine().begin() as conn:
        for key in keys_to_upsert:
            ins = pg_insert(feature_flags).values(
                key=key, enabled=enabled, message=message, disabled_at=disabled_at,
                eta_minutes=eta_minutes, updated_by=updated_by, updated_by_name=updated_by_name,
                updated_by_role=updated_by_role, updated_ts=now)
            ins = ins.on_conflict_do_update(index_elements=["key"], set_={
                "enabled": enabled, "message": message, "disabled_at": disabled_at,
                "eta_minutes": eta_minutes, "updated_by": updated_by,
                "updated_by_name": updated_by_name, "updated_by_role": updated_by_role,
                "updated_ts": now})
            await conn.execute(ins)
    log.info("feature flags: batch applied keys=%s enabled=%s by=%s",
             ",".join(keys), enabled, updated_by_name)

    rows = []
    async with _engine().connect() as conn:
        stmt = select(feature_flags).where(feature_flags.c.key.in_(keys))
        db_rows = (await conn.execute(stmt)).fetchall()
        db_rows_dict = {r._mapping["key"]: dict(r._mapping) for r in db_rows}

    for key in keys:
        if key in db_rows_dict:
            rows.append(db_rows_dict[key])
        else:
            rows.append({
                "key": key,
                "enabled": True,
                "message": None,
                "disabled_at": None,
                "eta_minutes": None,
                "updated_by": updated_by,
                "updated_by_name": updated_by_name,
                "updated_by_role": updated_by_role,
                "updated_ts": now
            })
    return rows
