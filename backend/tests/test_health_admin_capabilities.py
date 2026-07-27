import pytest

pytestmark = pytest.mark.asyncio

async def test_refresh_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.health import admin_service_health_refresh
    with pytest.raises(HTTPException) as exc_info:
        await admin_service_health_refresh(_={"role": "member"})
    assert exc_info.value.status_code == 403

async def test_refresh_allowed_with_capability(db_conn):
    from backend.routers import health
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "service_health.refresh")
    result = await health.admin_service_health_refresh(_={"role": "member"})
    assert result is not None

async def test_view_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.health import admin_service_health
    with pytest.raises(HTTPException) as exc_info:
        await admin_service_health(hours=24, _={"role": "member"})
    assert exc_info.value.status_code == 403

async def test_view_allowed_with_capability(db_conn):
    from backend.routers import health
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "service_health.view")
    result = await health.admin_service_health(hours=24, _={"role": "member"})
    assert result is not None
