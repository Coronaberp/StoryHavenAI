import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency():
    from backend.routers.misc import admin_resync_ui_translations
    sig = inspect.signature(admin_resync_ui_translations)
    return sig.parameters["current_user"].default.dependency


async def test_resync_denied_without_capability(db_conn):
    from fastapi import HTTPException
    dep = _capability_dependency()
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_resync_allowed_with_capability(db_conn, monkeypatch):
    from backend.routers import misc
    from backend.repositories import role_capabilities as rc
    from backend.schemas import ResyncUiTranslationsIn
    await rc.grant("member", "system_settings.manage")
    dep = _capability_dependency()
    assert await dep(current_user={"role": "member"}) == {"role": "member"}

    async def _fake_resync(*args, **kwargs):
        return None
    monkeypatch.setattr(misc, "_run_ui_translation_resync", _fake_resync)
    result = await misc.admin_resync_ui_translations(
        ResyncUiTranslationsIn(strings={"hello": "world"}),
        current_user={"role": "member", "username": "u1"})
    assert result is not None
