import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency(function_name):
    from backend.routers import oauth
    sig = inspect.signature(getattr(oauth, function_name))
    return sig.parameters["current_user"].default.dependency


async def test_list_providers_denied_without_capability(db_conn):
    from fastapi import HTTPException
    dep = _capability_dependency("admin_list_oauth_providers")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_list_providers_allowed_with_capability(db_conn):
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "system_settings.view")
    dep = _capability_dependency("admin_list_oauth_providers")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_put_providers_denied_without_capability(db_conn):
    from fastapi import HTTPException
    dep = _capability_dependency("admin_put_oauth_providers")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_put_providers_allowed_with_capability(db_conn):
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "system_settings.edit")
    dep = _capability_dependency("admin_put_oauth_providers")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}
