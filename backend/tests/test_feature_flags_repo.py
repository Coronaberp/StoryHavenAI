import time

import pytest

from backend.repositories import feature_flags as feature_flags_repo

pytestmark = pytest.mark.asyncio

async def test_get_returns_none_for_never_toggled_key(db_conn):
    assert await feature_flags_repo.get("kill-switch-test-never-toggled") is None

async def test_apply_batch_disables_a_single_key(db_conn):
    rows = await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-chat"], enabled=False, message="Down for maintenance",
        eta_minutes=20, updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    assert len(rows) == 1
    row = rows[0]
    assert row["key"] == "kill-switch-test-chat"
    assert row["enabled"] is False
    assert row["message"] == "Down for maintenance"
    assert row["eta_minutes"] == 20
    assert row["updated_by_name"] == "claude"
    assert row["updated_by_role"] == "admin"
    assert row["disabled_at"] is not None

    fetched = await feature_flags_repo.get("kill-switch-test-chat")
    assert fetched["enabled"] is False

async def test_apply_batch_re_enables_and_clears_message(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-lora"], enabled=False, message="paused",
        eta_minutes=5, updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    rows = await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-lora"], enabled=True, message=None,
        eta_minutes=None, updated_by="u2", updated_by_name="dev_account", updated_by_role="dev")
    row = rows[0]
    assert row["enabled"] is True
    assert row["message"] is None
    assert row["eta_minutes"] is None
    assert row["disabled_at"] is None
    assert row["updated_by_role"] == "dev"

async def test_apply_batch_applies_atomically_across_multiple_keys(db_conn):
    rows = await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-a", "kill-switch-test-b"], enabled=False, message="batch off",
        eta_minutes=None, updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    assert {r["key"] for r in rows} == {"kill-switch-test-a", "kill-switch-test-b"}
    assert all(r["enabled"] is False for r in rows)

async def test_get_all_only_returns_toggled_keys(db_conn):
    before = await feature_flags_repo.get_all()
    await feature_flags_repo.apply_batch(
        keys=["kill-switch-test-getall"], enabled=False, message=None,
        eta_minutes=None, updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    after = await feature_flags_repo.get_all()
    assert "kill-switch-test-getall" not in before
    assert "kill-switch-test-getall" in after

async def test_apply_batch_enable_never_toggled_key_no_row_created(db_conn):
    key = "kill-switch-test-never-toggled-enable"
    assert await feature_flags_repo.get(key) is None

    rows = await feature_flags_repo.apply_batch(
        keys=[key], enabled=True, message=None,
        eta_minutes=None, updated_by="u1", updated_by_name="claude", updated_by_role="admin")

    assert len(rows) == 1
    row = rows[0]
    assert row["key"] == key
    assert row["enabled"] is True
    assert row["message"] is None
    assert row["eta_minutes"] is None
    assert row["disabled_at"] is None
    assert row["updated_by_name"] == "claude"
    assert row["updated_by_role"] == "admin"

    fetched = await feature_flags_repo.get(key)
    assert fetched is None
