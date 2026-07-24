import time
import types

import pytest
from fastapi import HTTPException
from sqlalchemy import delete as sa_delete

from backend import db
from backend.routers import oauth as oauth_router
from backend.repositories import oauth_providers as provider_repo
from backend.repositories import oauth_pending as pending_repo
from backend.repositories import oauth_identities as identity_repo
from backend.repositories import users as user_repo
from backend.schemas import OauthProvidersPutIn, OauthProviderConfigIn

pytestmark = pytest.mark.asyncio

async def _clear_providers():
    await db._w(sa_delete(db.oauth_providers))

def _request(host="storyhavenai.example", scheme="https"):
    return types.SimpleNamespace(
        url=types.SimpleNamespace(hostname=host, scheme=scheme, port=None),
        client=types.SimpleNamespace(host="1.2.3.4"))

async def test_admin_list_providers_includes_every_registry_entry(db_conn):
    result = await oauth_router.admin_list_oauth_providers({"id": "admin-1"})
    names = {p["provider"] for p in result["providers"]}
    from backend.oauth_registry import PROVIDER_REGISTRY
    assert names == set(PROVIDER_REGISTRY.keys())

async def test_admin_list_providers_reports_configured_state(db_conn):
    await provider_repo.upsert("google", "client-1", "secret-1", True)
    result = await oauth_router.admin_list_oauth_providers({"id": "admin-1"})
    google = next(p for p in result["providers"] if p["provider"] == "google")
    assert google["client_id"] == "client-1"
    assert google["has_client_secret"] is True
    assert "client_secret" not in google
    assert google["enabled"] is True

async def test_admin_list_providers_unconfigured_shows_defaults(db_conn):
    await _clear_providers()
    result = await oauth_router.admin_list_oauth_providers({"id": "admin-1"})
    github = next(p for p in result["providers"] if p["provider"] == "github")
    assert github["client_id"] == ""
    assert github["has_client_secret"] is False
    assert github["enabled"] is False

async def test_admin_put_providers_upserts(db_conn):
    body = OauthProvidersPutIn(providers={
        "discord": OauthProviderConfigIn(client_id="d-id", client_secret="d-secret", enabled=True)})
    await oauth_router.admin_put_oauth_providers(body, {"id": "admin-1", "username": "admin"})
    row = await provider_repo.get("discord")
    assert row["client_id"] == "d-id"
    assert row["enabled"] is True

async def test_admin_put_providers_rejects_unknown_provider(db_conn):
    body = OauthProvidersPutIn(providers={
        "not-a-real-provider": OauthProviderConfigIn(client_id="x", client_secret="y", enabled=True)})
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.admin_put_oauth_providers(body, {"id": "admin-1", "username": "admin"})
    assert exc_info.value.status_code == 400

async def test_public_providers_list_only_shows_enabled(db_conn):
    await _clear_providers()
    await provider_repo.upsert("google", "id", "secret", True)
    await provider_repo.upsert("github", "id", "secret", False)
    result = await oauth_router.list_public_oauth_providers()
    names = {p["provider"] for p in result["providers"]}
    assert names == {"google"}
    assert result["providers"][0] == {"provider": "google", "label": "Google"}

async def test_start_login_unknown_provider_404(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router._start_oauth_flow(_request(), "not-real", "login", None)
    assert exc_info.value.status_code == 404

async def test_start_login_disabled_provider_404(db_conn):
    await _clear_providers()
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router._start_oauth_flow(_request(), "google", "login", None)
    assert exc_info.value.status_code == 404

async def test_start_login_enabled_provider_redirects_with_state(db_conn):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)
    response = await oauth_router._start_oauth_flow(_request(), "google", "login", None)
    assert response.status_code == 307
    assert "accounts.google.com" in response.headers["location"]
    assert "state=" in response.headers["location"]
    assert "client_id=test-client-id" in response.headers["location"]

async def test_start_flow_uses_absolute_callback_url(db_conn):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)
    response = await oauth_router._start_oauth_flow(_request(host="storyhavenai.example"), "google", "login", None)
    from urllib.parse import unquote
    assert "redirect_uri=https%3A%2F%2Fstoryhavenai.example%2Fapi%2Fauth%2Foauth%2Fgoogle%2Fcallback" \
        in response.headers["location"] or \
        "https://storyhavenai.example/api/auth/oauth/google/callback" in unquote(response.headers["location"])

async def test_public_start_route_signature_has_provider_and_request():
    import inspect
    sig = inspect.signature(oauth_router.start_oauth)
    assert set(sig.parameters) == {"request", "provider"}

async def test_callback_missing_state_redirects_with_error(db_conn):
    resp = await oauth_router.oauth_callback(_request(), "google", code="abc", state="never-issued")
    assert resp.status_code == 302
    assert resp.headers["location"] == oauth_router._LOGIN_ERROR_REDIRECT

async def test_callback_login_new_identity_creates_guest_account(db_conn, monkeypatch):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)

    async def fake_exchange(request, provider, entry, code, code_verifier):
        return "fake-access-token"

    async def fake_fetch(provider, entry, access_token):
        return {"sub": "google-new-user-12345", "name": "Test Person"}

    monkeypatch.setattr(oauth_router, "_exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(oauth_router, "_fetch_identity", fake_fetch)

    await pending_repo.create("state-new", "google", "login", None, None)
    result = await oauth_router.oauth_callback(_request(), "google", code="fake-code", state="state-new")
    assert result.status_code == 302
    assert result.headers["location"] == oauth_router._LOGIN_SUCCESS_REDIRECT
    assert "set-cookie" in result.headers
    identity = await identity_repo.get_by_provider_identity("google", "google-new-user-12345")
    assert identity is not None
    user = await user_repo.get_user_by_id(identity["user_id"])
    assert user["tier"] == "guest"
    assert user["status"] == "active"

async def test_callback_route_accepts_real_http_request_shape(db_conn, monkeypatch):
    from httpx import AsyncClient, ASGITransport
    try:
        from server import app
    except OSError as e:
        pytest.skip(f"full server app needs the container filesystem: {e}")

    await provider_repo.upsert("google", "test-client-id", "test-secret", True)

    async def fake_exchange(request, provider, entry, code, code_verifier):
        return "fake-access-token"

    async def fake_fetch(provider, entry, access_token):
        return {"sub": "google-http-test-user", "name": "HTTP Test"}

    monkeypatch.setattr(oauth_router, "_exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(oauth_router, "_fetch_identity", fake_fetch)

    await pending_repo.create("state-http-test", "google", "login", None, None)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/auth/oauth/google/callback",
                                params={"code": "fake-code", "state": "state-http-test"},
                                follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == oauth_router._LOGIN_SUCCESS_REDIRECT
    assert "sh_access" in resp.headers.get("set-cookie", "")

async def test_callback_login_existing_identity_reuses_account(db_conn, monkeypatch):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)
    existing_user = await user_repo.create_user("oauth-repeat-user", "pw12345678", tier="guest")
    await identity_repo.create("google", "google-existing-999", existing_user["id"])

    async def fake_exchange(request, provider, entry, code, code_verifier):
        return "fake-access-token"

    async def fake_fetch(provider, entry, access_token):
        return {"sub": "google-existing-999", "name": "Test Person"}

    monkeypatch.setattr(oauth_router, "_exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(oauth_router, "_fetch_identity", fake_fetch)

    await pending_repo.create("state-repeat", "google", "login", None, None)
    result = await oauth_router.oauth_callback(_request(), "google", code="fake-code", state="state-repeat")
    assert result.status_code == 302
    assert result.headers["location"] == oauth_router._LOGIN_SUCCESS_REDIRECT
    remaining = await identity_repo.list_for_user(existing_user["id"])
    assert len(remaining) == 1

async def test_callback_link_success_redirects_to_settings(db_conn, monkeypatch):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)
    user = await user_repo.create_user("oauth-link-user", "pw12345678")

    async def fake_exchange(request, provider, entry, code, code_verifier):
        return "fake-access-token"

    async def fake_fetch(provider, entry, access_token):
        return {"sub": "google-link-user-1", "name": "Link Person"}

    monkeypatch.setattr(oauth_router, "_exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(oauth_router, "_fetch_identity", fake_fetch)

    await pending_repo.create("state-link", "google", "link", user["id"], None)
    result = await oauth_router.oauth_callback(_request(), "google", code="fake-code", state="state-link")
    assert result.status_code == 302
    assert result.headers["location"] == oauth_router._LINK_SUCCESS_REDIRECT
    identity = await identity_repo.get_by_provider_identity("google", "google-link-user-1")
    assert identity["user_id"] == user["id"]

async def test_callback_link_conflict_redirects_with_error(db_conn, monkeypatch):
    await provider_repo.upsert("google", "test-client-id", "test-secret", True)
    owner = await user_repo.create_user("oauth-link-owner", "pw12345678")
    other = await user_repo.create_user("oauth-link-other", "pw12345678")
    await identity_repo.create("google", "google-link-conflict-1", owner["id"])

    async def fake_exchange(request, provider, entry, code, code_verifier):
        return "fake-access-token"

    async def fake_fetch(provider, entry, access_token):
        return {"sub": "google-link-conflict-1", "name": "Conflict Person"}

    monkeypatch.setattr(oauth_router, "_exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(oauth_router, "_fetch_identity", fake_fetch)

    await pending_repo.create("state-link-conflict", "google", "link", other["id"], None)
    result = await oauth_router.oauth_callback(_request(), "google", code="fake-code", state="state-link-conflict")
    assert result.status_code == 302
    assert result.headers["location"] == oauth_router._LINK_ERROR_REDIRECT

async def test_start_link_requires_login(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.start_oauth_link(_request(), "google", {"id": None})
    assert exc_info.value.status_code == 401

async def test_list_my_oauth_identities(db_conn):
    user = await user_repo.create_user("oauth-list-user", "pw12345678")
    await identity_repo.create("google", "sub-list-1", user["id"], "Display Name")
    result = await oauth_router.list_my_oauth_identities({"id": user["id"]})
    assert len(result) == 1
    assert result[0]["provider"] == "google"
    assert result[0]["display_name"] == "Display Name"
    assert "provider_user_id" not in result[0]

async def test_unlink_removes_identity(db_conn):
    user = await user_repo.create_user("oauth-unlink-user", "pw12345678")
    iid = await identity_repo.create("google", "sub-unlink-1", user["id"])
    result = await oauth_router.unlink_oauth_identity(iid, {"id": user["id"]})
    assert result == {"deleted": True}
    assert await identity_repo.list_for_user(user["id"]) == []

async def test_unlink_missing_404(db_conn):
    user = await user_repo.create_user("oauth-unlink-missing", "pw12345678")
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.unlink_oauth_identity("not-a-real-id", {"id": user["id"]})
    assert exc_info.value.status_code == 404

async def test_unlink_wrong_owner_404(db_conn):
    owner = await user_repo.create_user("oauth-unlink-owner", "pw12345678")
    other = await user_repo.create_user("oauth-unlink-other", "pw12345678")
    iid = await identity_repo.create("google", "sub-unlink-2", owner["id"])
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.unlink_oauth_identity(iid, {"id": other["id"]})
    assert exc_info.value.status_code == 404

async def test_unlink_blocked_when_only_signin_method_and_guest_tier(db_conn):
    user = await user_repo.create_user("oauth-unlink-lockout", "randompassword", tier="guest")
    iid = await identity_repo.create("google", "sub-unlink-lockout-1", user["id"])
    with pytest.raises(HTTPException) as exc_info:
        await oauth_router.unlink_oauth_identity(iid, {"id": user["id"]})
    assert exc_info.value.status_code == 409
    assert await identity_repo.list_for_user(user["id"])

async def test_unlink_allowed_when_second_identity_exists(db_conn):
    user = await user_repo.create_user("oauth-unlink-second", "randompassword", tier="guest")
    first = await identity_repo.create("google", "sub-unlink-second-1", user["id"])
    await identity_repo.create("discord", "sub-unlink-second-2", user["id"])
    result = await oauth_router.unlink_oauth_identity(first, {"id": user["id"]})
    assert result == {"deleted": True}
    remaining = await identity_repo.list_for_user(user["id"])
    assert len(remaining) == 1
    assert remaining[0]["provider"] == "discord"

async def test_unlink_allowed_when_full_tier_has_real_password(db_conn):
    user = await user_repo.create_user("oauth-unlink-realpw", "pw12345678", tier="full")
    iid = await identity_repo.create("google", "sub-unlink-realpw-1", user["id"])
    result = await oauth_router.unlink_oauth_identity(iid, {"id": user["id"]})
    assert result == {"deleted": True}
