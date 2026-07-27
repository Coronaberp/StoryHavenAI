import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency(func, param_name):
    sig = inspect.signature(func)
    return sig.parameters[param_name].default.dependency


async def test_list_flags_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.feature_flags import admin_list_feature_flags
    dep = _capability_dependency(admin_list_feature_flags, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_list_flags_allowed_with_capability(db_conn):
    from backend.routers.feature_flags import admin_list_feature_flags
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "feature_flags.view")
    dep = _capability_dependency(admin_list_feature_flags, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_batch_toggle_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.feature_flags import admin_batch_feature_flags
    dep = _capability_dependency(admin_batch_feature_flags, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_batch_toggle_allowed_with_capability(db_conn):
    from backend.routers.feature_flags import admin_batch_feature_flags
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "feature_flags.toggle")
    dep = _capability_dependency(admin_batch_feature_flags, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_active_user_count_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.feature_flags import admin_feature_flags_active_user_count
    dep = _capability_dependency(admin_feature_flags_active_user_count, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_active_user_count_allowed_with_capability(db_conn):
    from backend.routers.feature_flags import admin_feature_flags_active_user_count
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "feature_flags.view")
    dep = _capability_dependency(admin_feature_flags_active_user_count, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}
