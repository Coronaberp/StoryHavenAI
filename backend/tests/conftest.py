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

    def __init__(self, conn):
        self._conn = conn

    def connect(self):
        return _NoCloseConnCM(self._conn)

    def begin(self):
        return _NoCloseConnCM(self._conn)

@pytest_asyncio.fixture
async def db_conn():

    if db._fernet is None:

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
