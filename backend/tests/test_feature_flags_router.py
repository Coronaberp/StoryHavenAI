import pytest

from backend import feature_flags
from backend.repositories import feature_flags as feature_flags_repo
from backend.repositories import notifications as notification_repo

pytestmark = pytest.mark.asyncio

async def _current_status_for(role: str | None) -> dict:
    from backend.routers.feature_flags import _public_status
    return await _public_status(role)

def _admin_user() -> dict:
    return {"id": "u1", "username": "claude", "role": "admin"}

async def test_public_status_empty_for_dev(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["comments"], enabled=False, message="down", eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    status = await _current_status_for("dev")
    assert status == {}
    await feature_flags_repo.apply_batch(
        keys=["comments"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")

async def test_public_status_shows_disabled_features_for_non_dev(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["forum"], enabled=False, message="down for maintenance", eta_minutes=10,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    status = await _current_status_for("user")
    assert "forum" in status
    assert status["forum"]["message"] == "down for maintenance"
    assert status["forum"]["label"] == feature_flags.FEATURE_KEYS["forum"]
    await feature_flags_repo.apply_batch(
        keys=["forum"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")

async def test_public_status_omits_enabled_features(db_conn):
    status = await _current_status_for("user")
    assert "chat" not in status

async def test_admin_batch_rejects_unknown_key(db_conn):
    from backend.routers.feature_flags import FeatureFlagsBatchIn, admin_batch_feature_flags

    body = FeatureFlagsBatchIn(keys=["not_a_real_feature"], enabled=False,
                                message=None, eta_minutes=None)
    with pytest.raises(Exception) as exc_info:
        await admin_batch_feature_flags(body, _admin_user())
    assert exc_info.value.status_code == 400
    assert "not_a_real_feature" in exc_info.value.detail

async def test_admin_batch_fires_exactly_one_notification_per_call(db_conn, monkeypatch):
    from backend.routers.feature_flags import FeatureFlagsBatchIn, admin_batch_feature_flags

    calls = []

    async def _fake_notify_all_users(type, title, body="", link="", related_id=None):
        calls.append((type, title, body, related_id))
        return 0

    monkeypatch.setattr(notification_repo, "notify_all_users", _fake_notify_all_users)

    body = FeatureFlagsBatchIn(keys=["comments", "forum"], enabled=False,
                                message="down", eta_minutes=15)
    await admin_batch_feature_flags(body, _admin_user())

    assert len(calls) == 1
    assert calls[0][3] == "comments,forum"

async def test_admin_batch_updates_flag_state(db_conn):
    from backend.routers.feature_flags import FeatureFlagsBatchIn, admin_batch_feature_flags

    body = FeatureFlagsBatchIn(keys=["comments", "forum"], enabled=False,
                                message="scheduled maintenance", eta_minutes=20)
    await admin_batch_feature_flags(body, _admin_user())

    for key in ("comments", "forum"):
        row = await feature_flags_repo.get(key)
        assert row["enabled"] is False
        assert row["message"] == "scheduled maintenance"
        assert row["eta_minutes"] == 20

    restore_body = FeatureFlagsBatchIn(keys=["comments", "forum"], enabled=True,
                                        message=None, eta_minutes=None)
    await admin_batch_feature_flags(restore_body, _admin_user())

async def test_admin_list_synthesizes_default_for_untouched_key(db_conn):
    from backend.routers.feature_flags import admin_list_feature_flags

    result = await admin_list_feature_flags(_admin_user())
    assert "chat" in result
    entry = result["chat"]
    assert entry["enabled"] is True
    assert entry["message"] is None
    assert entry["eta_minutes"] is None
    assert entry["disabled_at"] is None
    assert entry["impact"] == feature_flags.FEATURE_IMPACT_DESCRIPTIONS.get("chat")

async def test_admin_list_reflects_toggled_flag_and_impact(db_conn):
    from backend.routers.feature_flags import admin_list_feature_flags

    await feature_flags_repo.apply_batch(
        keys=["forum"], enabled=False, message="down for maintenance", eta_minutes=10,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    result = await admin_list_feature_flags(_admin_user())
    assert result["forum"]["enabled"] is False
    assert result["forum"]["message"] == "down for maintenance"
    assert result["forum"]["impact"] == feature_flags.FEATURE_IMPACT_DESCRIPTIONS.get("forum")
    await feature_flags_repo.apply_batch(
        keys=["forum"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
