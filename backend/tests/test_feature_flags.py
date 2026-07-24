import pytest

from backend import feature_flags
from backend.repositories import feature_flags as feature_flags_repo

pytestmark = pytest.mark.asyncio

async def test_dev_bypasses_disabled_flag(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["chat"], enabled=False, message="down", eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    check = feature_flags.require_feature_enabled("chat")
    await check(current_user={"role": "dev"})
    await feature_flags_repo.apply_batch(
        keys=["chat"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")

async def test_non_dev_blocked_when_disabled(db_conn):
    await feature_flags_repo.apply_batch(
        keys=["lora_training"], enabled=False, message="paused", eta_minutes=15,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")
    check = feature_flags.require_feature_enabled("lora_training")
    with pytest.raises(Exception) as exc_info:
        await check(current_user={"role": "admin"})
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["feature"] == "lora_training"
    assert exc_info.value.detail["message"] == "paused"
    assert exc_info.value.detail["eta_minutes"] == 15
    await feature_flags_repo.apply_batch(
        keys=["lora_training"], enabled=True, message=None, eta_minutes=None,
        updated_by="u1", updated_by_name="claude", updated_by_role="admin")

async def test_enabled_flag_passes_through(db_conn):
    check = feature_flags.require_feature_enabled("comments")
    await check(current_user={"role": "user"})

def test_feature_keys_and_impact_descriptions_have_matching_keys():
    assert set(feature_flags.FEATURE_KEYS) == set(feature_flags.FEATURE_IMPACT_DESCRIPTIONS)
