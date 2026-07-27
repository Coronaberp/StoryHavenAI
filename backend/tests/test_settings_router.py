import pytest

from backend.repositories import users as user_repo
from backend.routers.settings import (
    get_my_settings, get_settings, put_my_experimental_features, put_settings,
    put_my_test_site_access,
)
from backend.schemas import ExperimentalFeaturesIn, SettingsIn, TestSiteAccessIn
from backend.state import CFG

pytestmark = pytest.mark.asyncio

async def test_get_my_settings_never_leaks_raw_api_key_in_defaults(db_conn, monkeypatch):
    monkeypatch.setitem(CFG, "api_key", "sk-real-secret-value")
    user = {"id": "user-a", "username": "user-a", "is_admin": False}

    result = await get_my_settings(current_user=user)

    assert "api_key" not in result["defaults"]
    assert result["defaults"].get("has_api_key") is True

async def test_get_my_settings_defaults_has_api_key_false_when_unset(db_conn, monkeypatch):
    monkeypatch.setitem(CFG, "api_key", "")
    user = {"id": "user-a", "username": "user-a", "is_admin": False}

    result = await get_my_settings(current_user=user)

    assert "api_key" not in result["defaults"]
    assert result["defaults"].get("has_api_key") is False

async def test_put_my_experimental_features_returns_updated_state(db_conn):
    user = await user_repo.create_user("repo_test_settings_experimental_user", "s3cret-password")

    result = await put_my_experimental_features(
        ExperimentalFeaturesIn(enabled=True), current_user=user)

    assert result == {"experimental_features_enabled": True}

async def test_put_test_site_access_sets_acknowledged(db_conn):
    user = await user_repo.create_user("testsiterouter1", "s3cret-password")

    result = await put_my_test_site_access(TestSiteAccessIn(acknowledged=True), current_user=user)

    assert result == {"test_site_warning_acknowledged": True}

async def test_get_and_put_settings_return_same_has_key_fields(db_conn):
    admin_user = {"id": "admin-a", "username": "admin-a", "is_admin": True}

    get_result = await get_settings(current_user=admin_user)
    put_result = await put_settings(SettingsIn(), current_user=admin_user)

    has_key_fields = {k for k in get_result if k.startswith("has_")}
    for field in has_key_fields:
        assert field in put_result, f"{field} present in GET /settings but missing from PUT /settings"

async def test_image_gen_defaults_round_trip_through_settings(db_conn):
    admin_user = {"id": "admin-b", "username": "admin-b", "is_admin": True}

    put_result = await put_settings(SettingsIn(
        image_gen_default_checkpoint_sdxl="wai_illustrious_sdxl.safetensors",
        image_gen_default_sampler_sdxl="euler",
        image_gen_default_scheduler_sdxl="normal",
        image_gen_default_steps_sdxl=25,
        image_gen_default_cfg_sdxl=6.5,
        image_gen_default_checkpoint_anima="animagine_xl_4.0.safetensors",
        image_gen_default_sampler_anima="res_multistep",
        image_gen_default_scheduler_anima="beta",
        image_gen_default_steps_anima=18,
        image_gen_default_cfg_anima=3.5,
    ), current_user=admin_user)

    assert put_result["image_gen_default_checkpoint_sdxl"] == "wai_illustrious_sdxl.safetensors"
    assert put_result["image_gen_default_sampler_sdxl"] == "euler"
    assert put_result["image_gen_default_scheduler_sdxl"] == "normal"
    assert put_result["image_gen_default_steps_sdxl"] == 25
    assert put_result["image_gen_default_cfg_sdxl"] == 6.5
    assert put_result["image_gen_default_checkpoint_anima"] == "animagine_xl_4.0.safetensors"
    assert put_result["image_gen_default_sampler_anima"] == "res_multistep"
    assert put_result["image_gen_default_scheduler_anima"] == "beta"
    assert put_result["image_gen_default_steps_anima"] == 18
    assert put_result["image_gen_default_cfg_anima"] == 3.5

    get_result = await get_settings(current_user=admin_user)
    assert get_result["image_gen_default_checkpoint_sdxl"] == "wai_illustrious_sdxl.safetensors"
    assert get_result["image_gen_default_cfg_anima"] == 3.5
