import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency(func, param_name):
    sig = inspect.signature(func)
    return sig.parameters[param_name].default.dependency


async def test_view_reports_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_list_image_reports
    dep = _capability_dependency(admin_list_image_reports, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_view_reports_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_list_image_reports
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.view_reports")
    dep = _capability_dependency(admin_list_image_reports, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_resolve_image_report_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_resolve_image_report
    dep = _capability_dependency(admin_resolve_image_report, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_resolve_image_report_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_resolve_image_report
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.resolve")
    dep = _capability_dependency(admin_resolve_image_report, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_server_logs_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_logs
    dep = _capability_dependency(admin_logs, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_server_logs_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_logs
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "server_logs.view")
    dep = _capability_dependency(admin_logs, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_content_reports_view_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_list_content_reports
    dep = _capability_dependency(admin_list_content_reports, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_content_reports_view_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_list_content_reports
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.view_reports")
    dep = _capability_dependency(admin_list_content_reports, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_resolve_content_report_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_resolve_content_report
    dep = _capability_dependency(admin_resolve_content_report, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_resolve_content_report_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_resolve_content_report
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.resolve")
    dep = _capability_dependency(admin_resolve_content_report, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_flagged_endpoints_view_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_list_flagged_endpoints
    dep = _capability_dependency(admin_list_flagged_endpoints, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_flagged_endpoints_view_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_list_flagged_endpoints
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.view_reports")
    dep = _capability_dependency(admin_list_flagged_endpoints, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_block_flagged_endpoint_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_block_flagged_endpoint
    dep = _capability_dependency(admin_block_flagged_endpoint, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_block_flagged_endpoint_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_block_flagged_endpoint
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.resolve")
    dep = _capability_dependency(admin_block_flagged_endpoint, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_allow_flagged_endpoint_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_allow_flagged_endpoint
    dep = _capability_dependency(admin_allow_flagged_endpoint, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_allow_flagged_endpoint_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_allow_flagged_endpoint
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.resolve")
    dep = _capability_dependency(admin_allow_flagged_endpoint, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_password_reset_requests_view_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_list_password_reset_requests
    dep = _capability_dependency(admin_list_password_reset_requests, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_password_reset_requests_view_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_list_password_reset_requests
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.view_reports")
    dep = _capability_dependency(admin_list_password_reset_requests, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_approve_password_reset_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_approve_password_reset
    dep = _capability_dependency(admin_approve_password_reset, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_approve_password_reset_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_approve_password_reset
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.resolve")
    dep = _capability_dependency(admin_approve_password_reset, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_deny_password_reset_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_deny_password_reset
    dep = _capability_dependency(admin_deny_password_reset, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_deny_password_reset_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_deny_password_reset
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.resolve")
    dep = _capability_dependency(admin_deny_password_reset, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_title_requests_view_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_list_title_requests
    dep = _capability_dependency(admin_list_title_requests, "_")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_title_requests_view_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_list_title_requests
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.view_reports")
    dep = _capability_dependency(admin_list_title_requests, "_")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_approve_title_request_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_approve_title_request
    dep = _capability_dependency(admin_approve_title_request, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_approve_title_request_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_approve_title_request
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.resolve")
    dep = _capability_dependency(admin_approve_title_request, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}


async def test_reject_title_request_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_reject_title_request
    dep = _capability_dependency(admin_reject_title_request, "current_user")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_reject_title_request_allowed_with_capability(db_conn):
    from backend.routers.admin import admin_reject_title_request
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "moderation.resolve")
    dep = _capability_dependency(admin_reject_title_request, "current_user")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}
