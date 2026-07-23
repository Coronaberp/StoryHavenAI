import types

import pytest
from fastapi import HTTPException

from backend.routers import webauthn as wa
from backend.repositories import webauthn_credentials as creds
from backend.repositories import users as user_repo
from backend.schemas import WebauthnLoginVerifyIn, PasskeyRequiredIn

pytestmark = pytest.mark.asyncio


def _request(host="storyhavenai.example"):
    return types.SimpleNamespace(
        url=types.SimpleNamespace(hostname=host, scheme="https", port=None),
        client=types.SimpleNamespace(host="1.2.3.4"))


def test_take_challenge_is_single_use():
    challenge_id = wa._store_challenge(b"chal", "login", None)
    assert wa._take_challenge(challenge_id, "login") == (b"chal", None)
    with pytest.raises(HTTPException):
        wa._take_challenge(challenge_id, "login")


def test_take_challenge_rejects_wrong_purpose():
    challenge_id = wa._store_challenge(b"chal", "register", "u1")
    with pytest.raises(HTTPException):
        wa._take_challenge(challenge_id, "login")


def test_rp_id_prefers_config(monkeypatch):
    monkeypatch.setitem(wa.CFG, "webauthn_rp_id", "configured.example")
    assert wa._rp_id(_request()) == "configured.example"
    monkeypatch.setitem(wa.CFG, "webauthn_rp_id", "")
    assert wa._rp_id(_request()) == "storyhavenai.example"


async def test_login_verify_unknown_credential_401(db_conn, monkeypatch):
    challenge_id = wa._store_challenge(b"chal", "login", None)
    body = WebauthnLoginVerifyIn(challenge_id=challenge_id, credential={"id": "missing"})
    with pytest.raises(HTTPException) as exc_info:
        await wa.login_verify(body, _request(), types.SimpleNamespace(set_cookie=lambda **kw: None))
    assert exc_info.value.status_code == 401


async def test_login_verify_success_issues_session(db_conn, monkeypatch):
    user = await user_repo.create_user("wa-user", "pw12345678")
    await creds.create(user["id"], "cred-ok", "cHVibGljLWtleQ", 1, "internal", "", "phone")

    monkeypatch.setattr(wa, "verify_authentication_response",
                        lambda **kw: types.SimpleNamespace(new_sign_count=2))

    async def fake_issue(uid):
        return {"access_token": "at", "refresh_token": "rt", "access_jti": "j1", "refresh_jti": "j2"}

    monkeypatch.setattr(wa, "_issue_tokens", fake_issue)
    monkeypatch.setattr(wa, "_set_auth_cookies", lambda *a, **kw: None)
    challenge_id = wa._store_challenge(b"chal", "login", None)
    body = WebauthnLoginVerifyIn(challenge_id=challenge_id, credential={"id": "cred-ok"})
    out = await wa.login_verify(body, _request(), types.SimpleNamespace())
    assert out["username"] == "wa-user" and out["access_token"] == "at"
    stored = await creds.get_by_credential_id("cred-ok")
    assert stored["sign_count"] == 2


async def test_passkey_required_needs_a_credential(db_conn):
    user = await user_repo.create_user("wa-strict", "pw12345678")
    with pytest.raises(HTTPException) as exc_info:
        await wa.set_passkey_required(PasskeyRequiredIn(value=True), current_user=user)
    assert exc_info.value.status_code == 400


async def test_delete_last_passkey_blocked_under_strict_mode(db_conn):
    user = await user_repo.create_user("wa-locked", "pw12345678")
    cid = await creds.create(user["id"], "cred-last", "pk", 0, "", "", "")
    await wa.set_passkey_required(PasskeyRequiredIn(value=True), current_user=user)
    with pytest.raises(HTTPException) as exc_info:
        await wa.delete_passkey(cid, current_user=user)
    assert exc_info.value.status_code == 400
    await wa.set_passkey_required(PasskeyRequiredIn(value=False), current_user=user)
    assert (await wa.delete_passkey(cid, current_user=user))["deleted"] is True
