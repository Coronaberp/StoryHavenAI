import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency(fn, param_name="_"):
    sig = inspect.signature(fn)
    return sig.parameters[param_name].default.dependency

async def test_refresh_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.health import admin_service_health_refresh
    dep = _capability_dependency(admin_service_health_refresh)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403

async def test_refresh_allowed_with_capability(db_conn):
    from backend.routers import health
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "service_health.refresh")
    dep = _capability_dependency(health.admin_service_health_refresh)
    result = await dep(current_user={"role": "member"})
    assert result is not None

async def test_view_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.health import admin_service_health
    dep = _capability_dependency(admin_service_health)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403

async def test_view_allowed_with_capability(db_conn):
    from backend.routers import health
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "service_health.view")
    dep = _capability_dependency(health.admin_service_health)
    result = await dep(current_user={"role": "member"})
    assert result is not None
