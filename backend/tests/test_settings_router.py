import pytest

from backend.routers.settings import get_my_settings
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
