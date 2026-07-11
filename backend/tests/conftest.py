import os

import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine

from backend import db


class _NoCloseConnCM:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _TxEngine:
    """Makes db._q/_q1/_scalar/_w (which call _engine.connect()/_engine.begin())
    reuse one already-open connection instead of pulling fresh ones from the
    pool, so a whole test runs inside the one outer transaction the db_conn
    fixture opened and rolls back afterward — never committed to the live
    database. _w's own begin()/commit() is flattened into that same
    transaction rather than nested, since asyncpg's single connection can't
    have two transactional contexts interleaved concurrently."""

    def __init__(self, conn):
        self._conn = conn

    def connect(self):
        return _NoCloseConnCM(self._conn)

    def begin(self):
        return _NoCloseConnCM(self._conn)


@pytest_asyncio.fixture
async def db_conn():
    # A fresh engine per test, not backend.db's process-wide singleton — that
    # singleton's asyncpg connections get bound to whatever event loop first
    # created them, and pytest-asyncio spins up a new loop per test function,
    # so reusing it across tests raises spurious asyncpg "another operation
    # is in progress" errors once a second test's loop touches it.
    if db._fernet is None:
        # Populates db._fernet (Fernet key from SECRET_ENCRYPTION_KEY or the
        # settings table) — needed by any repository whose rows are encrypted
        # at rest (e.g. lore content). Runs at most once per session; the
        # transient engine init() creates is never used for actual queries
        # (those go through the per-test _TxEngine below), so it doesn't
        # reintroduce the cross-event-loop asyncpg issue described above.
        await db.init()
    database_url = os.environ["DATABASE_URL"]
    test_engine = create_async_engine(database_url)
    try:
        async with test_engine.connect() as conn:
            outer_tx = await conn.begin()
            original_engine = db._engine
            db._engine = _TxEngine(conn)
            try:
                yield conn
            finally:
                db._engine = original_engine
                await outer_tx.rollback()
    finally:
        await test_engine.dispose()
