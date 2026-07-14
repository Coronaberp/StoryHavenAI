import types

import pytest
import pyotp

from backend.auth import totp_provision, _TOTP_PROVISIONS
from backend.schemas import RegisterIn, TotpProvisionIn


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
    from fastapi import HTTPException

    _TOTP_PROVISIONS._hits.clear()
    ip = "10.0.0.5"
    for _ in range(5):
        await totp_provision(TotpProvisionIn(username="kael"), _fake_request(ip))
    with pytest.raises(HTTPException) as excinfo:
        await totp_provision(TotpProvisionIn(username="kael"), _fake_request(ip))
    assert excinfo.value.status_code == 429
