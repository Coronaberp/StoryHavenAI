import pytest
from fastapi import HTTPException

from backend import guest_quota
from backend.repositories import users as user_repo

pytestmark = pytest.mark.asyncio


def test_full_tier_never_limited():
    guest_quota.check({"tier": "full", "guest_tokens_used": 10**9}, "tokens")


def test_guest_under_limit_passes():
    guest_quota.check({"tier": "guest", "guest_tokens_used": 999_999}, "tokens")


def test_guest_at_limit_blocked():
    for kind, field, limit in [("tokens", "guest_tokens_used", 1_000_000),
                               ("images", "guest_images_used", 400),
                               ("videos", "guest_videos_used", 8)]:
        with pytest.raises(HTTPException) as exc_info:
            guest_quota.check({"tier": "guest", field: limit}, kind)
        assert exc_info.value.status_code == 403


async def test_record_increments_only_for_guests(db_conn):
    guest = await user_repo.create_user("quota-guest", "pw12345678", tier="guest")
    full = await user_repo.create_user("quota-full", "pw12345678")
    await guest_quota.record(guest, "images", 3)
    await guest_quota.record(full, "images", 3)
    assert (await user_repo.get_user_by_id(guest["id"]))["guest_images_used"] == 3
    assert (await user_repo.get_user_by_id(full["id"]))["guest_images_used"] == 0


async def test_guest_register_and_invite_tier(db_conn):
    import types
    from backend.auth import register
    from backend.schemas import RegisterIn
    from backend.repositories import invite_codes as invite_code_repo

    request = types.SimpleNamespace(client=types.SimpleNamespace(host="10.8.8.1"))
    result = await register(RegisterIn(username="quota-guest-reg", password="pw12345678",
                                       guest=True), request)
    assert result["pending"] is False
    user = await user_repo.get_user_by_username(result["username"])
    assert user["status"] == "active" and user["tier"] == "guest"

    code = await invite_code_repo.create("admin-1", tier="guest")
    assert len(code["code"]) == 36 and code["code"].count("-") == 4
    request2 = types.SimpleNamespace(client=types.SimpleNamespace(host="10.8.8.2"))
    await register(RegisterIn(username="quota-invited-guest", password="pw12345678",
                              invite_code=code["code"]), request2)
    invited = await user_repo.get_user_by_username("quota-invited-guest")
    assert invited["tier"] == "guest" and invited["status"] == "active"


def test_require_full_blocks_guests_only():
    guest_quota.require_full({"tier": "full"}, "create characters")
    with pytest.raises(HTTPException) as exc_info:
        guest_quota.require_full({"tier": "guest"}, "create characters")
    assert exc_info.value.status_code == 403


async def test_guest_register_gets_generated_username(db_conn):
    import types
    from backend.auth import register
    from backend.schemas import RegisterIn

    request = types.SimpleNamespace(client=types.SimpleNamespace(host="10.8.8.3"))
    result = await register(RegisterIn(username="prettynamewanted", password="pw12345678",
                                       guest=True), request)
    assert len(result["username"]) == 16
    assert all(c.islower() or c.isdigit() for c in result["username"])
    assert await user_repo.get_user_by_username("prettynamewanted") is None
