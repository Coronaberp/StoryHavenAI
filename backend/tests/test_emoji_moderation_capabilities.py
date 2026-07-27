import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency(func, param_name):
    sig = inspect.signature(func)
    return sig.parameters[param_name].default.dependency


async def test_list_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.emojis import admin_list_emojis
    dep = _capability_dependency(admin_list_emojis, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_list_allowed_with_capability(db_conn):
    from backend.routers.emojis import admin_list_emojis
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "emojis.view_submissions")
    dep = _capability_dependency(admin_list_emojis, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_approve_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.emojis import admin_approve_emoji
    dep = _capability_dependency(admin_approve_emoji, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_approve_allowed_with_capability(db_conn):
    from backend.routers.emojis import admin_approve_emoji
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "emojis.approve")
    dep = _capability_dependency(admin_approve_emoji, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_edit_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.emojis import admin_update_emoji
    dep = _capability_dependency(admin_update_emoji, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_edit_allowed_with_capability(db_conn):
    from backend.routers.emojis import admin_update_emoji
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "emojis.edit")
    dep = _capability_dependency(admin_update_emoji, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}
