import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

import backend.routers.misc  # noqa: F401
from backend.routers.misc import _compute_missing_translations, SUPPORTED_UI_LANGUAGES
from backend.state import api

pytestmark = pytest.mark.asyncio


async def test_compute_missing_translations_returns_all_languages(db_conn):
    result = await _compute_missing_translations({"greeting": "Hello"})
    assert set(result.keys()) == set(SUPPORTED_UI_LANGUAGES)
    assert all(isinstance(v, list) for v in result.values())


async def test_status_endpoint_requires_dev_role():
    app = FastAPI()
    app.include_router(api)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/admin/dev/ui-translations-status", json={"strings": {"a": "b"}})
        assert r.status_code in (401, 403)
