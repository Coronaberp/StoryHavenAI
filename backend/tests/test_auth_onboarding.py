import types

import pytest
import pyotp
from fastapi import HTTPException

from backend.auth import totp_provision, _TOTP_PROVISIONS, register
from backend.schemas import RegisterIn, TotpProvisionIn
from backend.repositories import users as user_repo


def _fake_request(ip="127.0.0.1"):
    return types.SimpleNamespace(client=types.SimpleNamespace(host=ip))


def test_register_in_allows_optional_totp_fields():
    body = RegisterIn(username="kael", password="s3cret-pw")
    assert body.totp_secret is None
    assert body.totp_code is None

    body_with_totp = RegisterIn(
        username="kael", password="s3cret-pw",
        totp_secret="JBSWY3DPEHPK3PXP", totp_code="123456")
    assert body_with_totp.totp_code == "123456"


def test_register_in_rejects_malformed_totp_code():
    with pytest.raises(ValueError):
        RegisterIn(username="kael", password="s3cret-pw", totp_code="12a456")


def test_totp_provision_in_requires_username():
    body = TotpProvisionIn(username="kael")
    assert body.username == "kael"


@pytest.mark.asyncio
async def test_totp_provision_returns_secret_and_uri():
    _TOTP_PROVISIONS._hits.clear()
    result = await totp_provision(TotpProvisionIn(username="kael"), _fake_request())
    assert len(result["secret"]) >= 16
    assert result["otpauth_uri"].startswith("otpauth://totp/")
    assert pyotp.TOTP(result["secret"]).verify(pyotp.TOTP(result["secret"]).now())


@pytest.mark.asyncio
async def test_totp_provision_is_rate_limited_per_ip():
    _TOTP_PROVISIONS._hits.clear()
    ip = "10.0.0.5"
    for _ in range(5):
        await totp_provision(TotpProvisionIn(username="kael"), _fake_request(ip))
    with pytest.raises(HTTPException) as excinfo:
        await totp_provision(TotpProvisionIn(username="kael"), _fake_request(ip))
    assert excinfo.value.status_code == 429


@pytest.mark.asyncio
async def test_register_without_totp_still_works(db_conn):
    body = RegisterIn(username="onboard_test_notp", password="s3cret-password")
    result = await register(body, _fake_request("10.0.1.1"))
    assert result["ok"] is True
    assert result["pending"] is True
    assert result.get("backup_codes") is None
    user = await user_repo.get_user_by_username("onboard_test_notp")
    assert user["status"] == "pending"
    assert not user["totp_enabled"]


@pytest.mark.asyncio
async def test_register_with_valid_totp_binds_and_returns_backup_codes(db_conn):
    secret = pyotp.random_base32()
    code = pyotp.TOTP(secret).now()
    body = RegisterIn(username="onboard_test_totp", password="s3cret-password",
                      totp_secret=secret, totp_code=code)
    result = await register(body, _fake_request("10.0.1.2"))
    assert result["ok"] is True
    assert len(result["backup_codes"]) == 8
    user = await user_repo.get_user_by_username("onboard_test_totp")
    assert user["status"] == "pending"
    assert user["totp_enabled"]


@pytest.mark.asyncio
async def test_register_with_invalid_totp_code_creates_no_user(db_conn):
    secret = pyotp.random_base32()
    body = RegisterIn(username="onboard_test_bad", password="s3cret-password",
                      totp_secret=secret, totp_code="000000")
    with pytest.raises(HTTPException) as excinfo:
        await register(body, _fake_request("10.0.1.3"))
    assert excinfo.value.status_code == 400
    assert await user_repo.get_user_by_username("onboard_test_bad") is None
