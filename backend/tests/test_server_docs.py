import pytest

from server import app, get_openapi_schema

def test_public_docs_and_schema_disabled():
    assert app.docs_url is None
    assert app.redoc_url is None
    assert app.openapi_url is None

@pytest.mark.asyncio
async def test_openapi_schema_endpoint_returns_real_schema():
    schema = await get_openapi_schema(_user={"id": "u1", "username": "u", "is_admin": False})
    assert "paths" in schema
    assert "info" in schema
    assert schema["info"]["title"] == "StoryHaven AI"

def test_schema_endpoint_requires_authentication():
    route = next(r for r in app.routes if getattr(r, "path", None) == "/api/openapi-schema")
    dep_calls = [d.call for d in route.dependant.dependencies]
    from backend.auth import get_current_user
    assert get_current_user in dep_calls
