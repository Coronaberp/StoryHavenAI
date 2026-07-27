import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency():
    from backend.routers.imagegen import upscale_standalone_image
    sig = inspect.signature(upscale_standalone_image)
    return sig.parameters["current_user"].default.dependency


async def test_upscale_denied_without_capability(db_conn):
    from fastapi import HTTPException
    dep = _capability_dependency()
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_upscale_allowed_with_capability(db_conn):
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "system_settings.edit")
    dep = _capability_dependency()
    result = await dep(current_user={"role": "member"})
    assert result == {"role": "member"}
