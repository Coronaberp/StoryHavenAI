import pytest
from fastapi import HTTPException

from backend.auth import get_experimental_user

pytestmark = pytest.mark.asyncio


async def test_get_experimental_user_allows_when_enabled():
    user = {"id": "u1", "experimental_features_enabled": True}
    result = await get_experimental_user(user)
    assert result == user


async def test_get_experimental_user_404s_when_disabled():
    user = {"id": "u1", "experimental_features_enabled": False}
    with pytest.raises(HTTPException) as exc_info:
        await get_experimental_user(user)
    assert exc_info.value.status_code == 404


async def test_get_experimental_user_404s_when_missing():
    user = {"id": "u1"}
    with pytest.raises(HTTPException) as exc_info:
        await get_experimental_user(user)
    assert exc_info.value.status_code == 404
