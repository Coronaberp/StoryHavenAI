import pytest

pytestmark = pytest.mark.asyncio

async def test_role_capabilities_table_exists():
    from backend.db import role_capabilities
    assert role_capabilities.name == "role_capabilities"
    cols = {c.name for c in role_capabilities.columns}
    assert cols == {"role", "capability"}

from backend.repositories import role_capabilities as rc

async def test_grant_and_has(db_conn):
    await rc.grant("member", "comments.delete_any")
    assert await rc.has("member", "comments.delete_any") is True

async def test_has_missing_grant_returns_false(db_conn):
    assert await rc.has("guest", "users.delete") is False

async def test_grant_is_idempotent(db_conn):
    await rc.grant("member", "comments.delete_any")
    await rc.grant("member", "comments.delete_any")
    caps = await rc.list_for_role("member")
    assert caps.count("comments.delete_any") == 1

async def test_revoke(db_conn):
    await rc.grant("member", "comments.delete_any")
    await rc.revoke("member", "comments.delete_any")
    assert await rc.has("member", "comments.delete_any") is False

async def test_revoke_missing_grant_is_a_noop(db_conn):
    await rc.revoke("member", "comments.delete_any")
    assert await rc.has("member", "comments.delete_any") is False

async def test_list_for_role(db_conn):
    # Uses an unseeded role name rather than "admin" — seed_defaults() grants admin
    # every capability currently in CAPABILITY_REGISTRY, which grows as more routers
    # register capabilities at import time, so asserting an exact set for "admin"
    # is order-dependent on how many capabilities happen to be registered this run.
    from backend.repositories import roles as roles_repo
    await roles_repo.create("moderator_test_role", "Moderator Test Role")
    await rc.grant("moderator_test_role", "users.view")
    await rc.grant("moderator_test_role", "users.delete")
    assert set(await rc.list_for_role("moderator_test_role")) == {"users.view", "users.delete"}

async def test_set_all_replaces_existing_grants(db_conn):
    await rc.grant("member", "comments.delete_any")
    await rc.set_all("member", ["users.view"])
    assert set(await rc.list_for_role("member")) == {"users.view"}

async def test_set_all_empty_list_clears_role(db_conn):
    await rc.grant("member", "comments.delete_any")
    await rc.set_all("member", [])
    assert await rc.list_for_role("member") == []


async def _reset_seeded_marker(*role_names):
    from sqlalchemy import update
    from backend.db import roles, _w
    for role in role_names:
        await _w(update(roles).where(roles.c.name == role).values(capabilities_seeded=False))


async def test_seed_defaults_first_run_grants_everything(db_conn):
    # Reset guest/member/admin to genuinely unseeded within this test's own
    # transaction first — in the shared test database they're already seeded
    # by the app-startup db.init() call that ran before any test executed, so
    # without this reset they would never be "first run" from seed_defaults()'s
    # point of view and this test would be asserting against stale state.
    from backend.auth import CAPABILITY_REGISTRY
    for role in ("guest", "member", "admin"):
        for cap in await rc.list_for_role(role):
            await rc.revoke(role, cap)
    await _reset_seeded_marker("guest", "member", "admin")
    await rc.seed_defaults()
    admin_caps = set(await rc.list_for_role("admin"))
    assert admin_caps == set(CAPABILITY_REGISTRY)
    assert await rc.list_for_role("guest") == ["test_site.toggle_own"]
    assert await rc.list_for_role("member") == ["test_site.toggle_own"]


async def test_seed_defaults_leaves_non_empty_role_untouched(db_conn):
    # Same reasoning as above: clear member's pre-existing seeded rows first so
    # that granting a single capability below genuinely represents "a role with
    # exactly one Dev-curated grant", not "the seeded defaults plus one extra".
    # The marker is left alone (already seeded), which is exactly what should
    # stop seed_defaults() from touching this role again.
    for cap in await rc.list_for_role("member"):
        await rc.revoke("member", cap)
    await rc.grant("member", "users.view")
    await rc.seed_defaults()
    caps = await rc.list_for_role("member")
    assert caps == ["users.view"]
    assert "test_site.toggle_own" not in caps


async def test_seed_defaults_does_not_resurrect_revoked_admin_capability(db_conn):
    from backend.auth import CAPABILITY_REGISTRY
    any_capability = next(iter(CAPABILITY_REGISTRY))
    await _reset_seeded_marker("admin")
    await rc.seed_defaults()
    await rc.revoke("admin", any_capability)
    assert await rc.has("admin", any_capability) is False
    await rc.seed_defaults()
    assert await rc.has("admin", any_capability) is False


async def test_seed_defaults_does_not_resurrect_revoked_guest_default(db_conn):
    # Guest/member only ever have a single default capability, so revoking it
    # drops the role to zero rows — indistinguishable from "never seeded" if
    # the gate were still row-count based. The capabilities_seeded marker must
    # be what prevents re-granting here.
    await _reset_seeded_marker("guest")
    await rc.seed_defaults()
    assert await rc.list_for_role("guest") == ["test_site.toggle_own"]
    await rc.revoke("guest", "test_site.toggle_own")
    assert await rc.list_for_role("guest") == []
    await rc.seed_defaults()
    assert await rc.list_for_role("guest") == []
