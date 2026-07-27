import pytest

pytestmark = pytest.mark.asyncio

async def test_require_capability_registers_on_call():
    from backend.auth import require_capability, CAPABILITY_REGISTRY
    require_capability("test_ns.some_action", "Do the test thing.")
    assert CAPABILITY_REGISTRY["test_ns.some_action"] == "Do the test thing."

async def test_dev_bypasses_require_capability(db_conn):
    from backend.auth import require_capability
    dep = require_capability("test_ns.gated_action", "Gated for the test.")
    result = await dep(current_user={"role": "dev"})
    assert result == {"role": "dev"}

async def test_require_capability_denies_without_grant(db_conn):
    from fastapi import HTTPException
    from backend.auth import require_capability
    dep = require_capability("test_ns.needs_grant", "Needs a grant.")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403

async def test_require_capability_allows_with_grant(db_conn):
    from backend.auth import require_capability
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "test_ns.granted_action")
    dep = require_capability("test_ns.granted_action", "Granted for the test.")
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}

async def test_has_capability_registers_and_checks(db_conn):
    from backend.auth import has_capability, CAPABILITY_REGISTRY
    from backend.repositories import role_capabilities as rc
    assert await has_capability("member", "test_ns.own_check", "Own-check test.") is False
    assert CAPABILITY_REGISTRY["test_ns.own_check"] == "Own-check test."
    await rc.grant("member", "test_ns.own_check")
    assert await has_capability("member", "test_ns.own_check", "Own-check test.") is True

async def test_dev_bypasses_has_capability():
    from backend.auth import has_capability
    assert await has_capability("dev", "test_ns.anything", "Anything.") is True
