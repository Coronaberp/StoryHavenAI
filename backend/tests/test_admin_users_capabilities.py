import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency(func, param_name):
    sig = inspect.signature(func)
    return sig.parameters[param_name].default.dependency


async def test_list_users_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_list_users
    dep = _capability_dependency(admin_list_users, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_list_users_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_list_users
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.view")
    dep = _capability_dependency(admin_list_users, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_delete_user_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_delete_user
    dep = _capability_dependency(admin_delete_user, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_delete_user_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_delete_user
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.delete")
    dep = _capability_dependency(admin_delete_user, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_change_role_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_update_role
    dep = _capability_dependency(admin_update_role, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_change_role_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_update_role
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.change_role")
    dep = _capability_dependency(admin_update_role, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_suspend_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_suspend_user
    dep = _capability_dependency(admin_suspend_user, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_suspend_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_suspend_user
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.suspend")
    dep = _capability_dependency(admin_suspend_user, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_unsuspend_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_unsuspend_user
    dep = _capability_dependency(admin_unsuspend_user, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_unsuspend_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_unsuspend_user
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.suspend")
    dep = _capability_dependency(admin_unsuspend_user, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_edit_notes_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_add_user_note
    dep = _capability_dependency(admin_add_user_note, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_edit_notes_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_add_user_note
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.edit_notes")
    dep = _capability_dependency(admin_add_user_note, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_delete_note_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_delete_user_note
    dep = _capability_dependency(admin_delete_user_note, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_delete_note_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_delete_user_note
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.edit_notes")
    dep = _capability_dependency(admin_delete_user_note, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_set_identity_label_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_set_identity_label
    dep = _capability_dependency(admin_set_identity_label, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_set_identity_label_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_set_identity_label
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.edit_identity")
    dep = _capability_dependency(admin_set_identity_label, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_invite_codes_view_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_list_invite_codes
    dep = _capability_dependency(admin_list_invite_codes, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_invite_codes_view_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_list_invite_codes
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "invite_codes.view")
    dep = _capability_dependency(admin_list_invite_codes, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_invite_codes_manage_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_create_invite_code
    dep = _capability_dependency(admin_create_invite_code, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_invite_codes_manage_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_create_invite_code
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "invite_codes.manage")
    dep = _capability_dependency(admin_create_invite_code, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_disable_invite_code_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_disable_invite_code
    dep = _capability_dependency(admin_disable_invite_code, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_disable_invite_code_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_disable_invite_code
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "invite_codes.manage")
    dep = _capability_dependency(admin_disable_invite_code, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_delete_invite_code_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_delete_invite_code
    dep = _capability_dependency(admin_delete_invite_code, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_delete_invite_code_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_delete_invite_code
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "invite_codes.manage")
    dep = _capability_dependency(admin_delete_invite_code, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_set_user_tier_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_set_user_tier
    dep = _capability_dependency(admin_set_user_tier, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_set_user_tier_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_set_user_tier
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.edit_tier")
    dep = _capability_dependency(admin_set_user_tier, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_create_user_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_create_user
    dep = _capability_dependency(admin_create_user, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_create_user_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_create_user
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.create")
    dep = _capability_dependency(admin_create_user, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_reset_password_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_reset_password
    dep = _capability_dependency(admin_reset_password, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_reset_password_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_reset_password
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.reset_password")
    dep = _capability_dependency(admin_reset_password, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_approve_user_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_approve_user
    dep = _capability_dependency(admin_approve_user, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_approve_user_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_approve_user
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.approve_signup")
    dep = _capability_dependency(admin_approve_user, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_deny_user_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_deny_user
    dep = _capability_dependency(admin_deny_user, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_deny_user_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_deny_user
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.approve_signup")
    dep = _capability_dependency(admin_deny_user, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_clear_totp_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_clear_user_totp
    dep = _capability_dependency(admin_clear_user_totp, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_clear_totp_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_clear_user_totp
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.clear_totp")
    dep = _capability_dependency(admin_clear_user_totp, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_list_user_notes_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_list_user_notes
    dep = _capability_dependency(admin_list_user_notes, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_list_user_notes_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_list_user_notes
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "users.view")
    dep = _capability_dependency(admin_list_user_notes, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_model_requests_view_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_test_model_request_host, admin_list_model_requests
    for func in (admin_test_model_request_host, admin_list_model_requests):
        dep = _capability_dependency(func, "current_user")
        with pytest.raises(HTTPException) as exc_info:
            await dep(current_user={"role": "member"})
        assert exc_info.value.status_code == 403


async def test_model_requests_view_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_test_model_request_host, admin_list_model_requests
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "model_requests.view")
    for func in (admin_test_model_request_host, admin_list_model_requests):
        dep = _capability_dependency(func, "current_user")
        result = await dep(current_user={"role": "member"})
        assert result == {"role": "member"}


async def test_model_requests_decide_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import (
        admin_approve_model_request,
        admin_reject_model_request,
        admin_reopen_model_request,
        admin_complete_model_request,
    )
    for func in (
        admin_approve_model_request,
        admin_reject_model_request,
        admin_reopen_model_request,
        admin_complete_model_request,
    ):
        dep = _capability_dependency(func, "current_user")
        with pytest.raises(HTTPException) as exc_info:
            await dep(current_user={"role": "member"})
        assert exc_info.value.status_code == 403


async def test_model_requests_decide_allowed_with_capability(db_conn):
    from backend.routers.admin import (
        admin_approve_model_request,
        admin_reject_model_request,
        admin_reopen_model_request,
        admin_complete_model_request,
    )
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "model_requests.decide")
    for func in (
        admin_approve_model_request,
        admin_reject_model_request,
        admin_reopen_model_request,
        admin_complete_model_request,
    ):
        dep = _capability_dependency(func, "current_user")
        result = await dep(current_user={"role": "member"})
        assert result == {"role": "member"}
