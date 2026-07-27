import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _test_site_toggle_dependency():
    from backend.routers.settings import put_my_test_site_access
    sig = inspect.signature(put_my_test_site_access)
    return sig.parameters["current_user"].default.dependency


def _put_settings_dependency():
    from backend.routers.settings import put_settings
    sig = inspect.signature(put_settings)
    return sig.parameters["current_user"].default.dependency


async def test_test_site_toggle_denied_without_capability(db_conn):
    from fastapi import HTTPException
    dep = _test_site_toggle_dependency()
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "banned"})
    assert exc_info.value.status_code == 403


async def test_test_site_toggle_allowed_with_capability(db_conn):
    from backend.repositories import role_capabilities as rc
    await rc.grant("banned", "test_site.toggle_own")
    dep = _test_site_toggle_dependency()
    result = await dep(current_user={"role": "banned"})
    assert result == {"role": "banned"}


async def test_put_settings_denied_without_capability(db_conn):
    from fastapi import HTTPException
    dep = _put_settings_dependency()
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_put_settings_allowed_with_capability(db_conn):
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "system_settings.manage")
    dep = _put_settings_dependency()
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}
