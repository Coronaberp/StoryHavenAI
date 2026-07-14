import pytest

from backend.schemas import RegisterIn, TotpProvisionIn

pytestmark = pytest.mark.asyncio


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
