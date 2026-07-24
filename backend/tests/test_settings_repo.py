import pytest

from backend.repositories import settings as global_settings_repo

pytestmark = pytest.mark.asyncio

async def test_set_and_all_settings_roundtrip(db_conn):
    await global_settings_repo.set_settings({"chat_model": "test-model", "gen_temp": 0.5})
    out = await global_settings_repo.all_settings()
    assert out["chat_model"] == "test-model"
    assert out["gen_temp"] == 0.5

async def test_set_settings_upserts_existing_key(db_conn):
    await global_settings_repo.set_settings({"chat_model": "first-model"})
    await global_settings_repo.set_settings({"chat_model": "second-model"})
    out = await global_settings_repo.all_settings()
    assert out["chat_model"] == "second-model"

async def test_set_settings_supports_list_values(db_conn):
    await global_settings_repo.set_settings({"model_request_hosts": [{"host": "example.com", "api_key": ""}]})
    out = await global_settings_repo.all_settings()
    assert out["model_request_hosts"] == [{"host": "example.com", "api_key": ""}]
