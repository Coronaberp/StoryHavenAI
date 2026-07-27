import asyncio
import os

import pytest
from sqlalchemy import and_, func, update
from sqlalchemy.ext.asyncio import create_async_engine

from backend import db, guest_quota
from backend.repositories import users as user_repo

pytestmark = pytest.mark.asyncio


async def _reserve_on_own_connection(engine, uid, field, amount, limit):
    used = func.coalesce(db.users.c[field], 0)
    async with engine.begin() as conn:
        result = await conn.execute(update(db.users)
            .where(and_(db.users.c.id == uid, used + amount <= limit))
            .values({field: used + amount}))
        return result.rowcount > 0


async def test_real_cross_connection_race_never_exceeds_quota():
    if db._fernet is None:
        await db.init()

    database_url = os.environ["DATABASE_URL"]
    control_engine = create_async_engine(database_url)
    engines = [create_async_engine(database_url, pool_size=1, max_overflow=0) for _ in range(10)]
    original_engine = db._engine
    db._engine = control_engine

    try:
        guest = await user_repo.create_user("quota-race-real-conn-guest", "pw12345678", tier="guest")
        field = "guest_videos_used"
        limit = guest_quota.GUEST_VIDEO_LIMIT
        already_used = limit - 3
        await user_repo.reserve_guest_usage(guest["id"], field, already_used, limit)

        try:
            results = await asyncio.gather(*[
                _reserve_on_own_connection(engine, guest["id"], field, 1, limit)
                for engine in engines
            ])
            granted = [r for r in results if r]
            denied = [r for r in results if not r]
            assert len(granted) == 3
            assert len(denied) == 7

            final = await user_repo.get_user_by_id(guest["id"])
            assert final[field] == limit
        finally:
            await user_repo.delete_user(guest["id"])
    finally:
        db._engine = original_engine
        await control_engine.dispose()
        for engine in engines:
            await engine.dispose()
