import pytest
from fastapi import HTTPException

from backend.routers.imagegen import stream_video
from backend.schemas import ImageGenVideoIn

pytestmark = pytest.mark.asyncio


async def test_video_rejects_missing_wan_models(db_conn, monkeypatch):
    from backend import imagegen

    async def fake_empty_list(url):
        return []
    monkeypatch.setattr(imagegen, "list_wan_unets", fake_empty_list)
    monkeypatch.setattr(imagegen, "list_wan_clip_models", fake_empty_list)
    monkeypatch.setattr(imagegen, "list_vaes", fake_empty_list)

    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenVideoIn(positive="a dog running")
    with pytest.raises(HTTPException) as exc_info:
        await stream_video(body, current_user=user)
    assert exc_info.value.status_code == 400


async def test_video_rejects_zero_fps(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenVideoIn(positive="a dog running", fps=0)
    with pytest.raises(HTTPException) as exc_info:
        await stream_video(body, current_user=user)
    assert exc_info.value.status_code == 400


async def test_video_rejects_malformed_image(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenVideoIn(positive="a dog running", image="not-a-data-url")
    with pytest.raises(HTTPException) as exc_info:
        await stream_video(body, current_user=user)
    assert exc_info.value.status_code == 400
