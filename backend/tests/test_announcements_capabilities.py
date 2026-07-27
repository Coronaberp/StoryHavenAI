import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency(func, param_name):
    sig = inspect.signature(func)
    return sig.parameters[param_name].default.dependency


async def test_announce_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.announcements import admin_announce
    dep = _capability_dependency(admin_announce, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_announce_allowed_with_capability(db_conn):
    from backend.routers.announcements import admin_announce
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "announcements.post")
    dep = _capability_dependency(admin_announce, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_generate_toned_notification_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.announcements import admin_generate_toned_notification
    dep = _capability_dependency(admin_generate_toned_notification, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_generate_toned_notification_allowed_with_capability(db_conn):
    from backend.routers.announcements import admin_generate_toned_notification
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "announcements.post")
    dep = _capability_dependency(admin_generate_toned_notification, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_send_targeted_notification_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.announcements import admin_send_targeted_notification
    dep = _capability_dependency(admin_send_targeted_notification, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_send_targeted_notification_allowed_with_capability(db_conn):
    from backend.routers.announcements import admin_send_targeted_notification
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "announcements.post")
    dep = _capability_dependency(admin_send_targeted_notification, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_set_banner_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.announcements import set_site_banner
    dep = _capability_dependency(set_site_banner, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_set_banner_allowed_with_capability(db_conn):
    from backend.routers.announcements import set_site_banner
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "announcements.set_banner")
    dep = _capability_dependency(set_site_banner, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_clear_banner_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.announcements import clear_site_banner
    dep = _capability_dependency(clear_site_banner, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_clear_banner_allowed_with_capability(db_conn):
    from backend.routers.announcements import clear_site_banner
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "announcements.set_banner")
    dep = _capability_dependency(clear_site_banner, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}
