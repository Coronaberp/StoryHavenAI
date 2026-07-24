import pytest
from fastapi import HTTPException

from backend.routers.imagegen import stream_inpaint_image
from backend.schemas import ImageGenInpaintIn

pytestmark = pytest.mark.asyncio

async def test_inpaint_rejects_malformed_mask(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenInpaintIn(image="data:image/png;base64,AAAA", mask="not-a-data-url",
                             positive="a cat", negative="")
    with pytest.raises(HTTPException) as exc_info:
        await stream_inpaint_image(body, current_user=user)
    assert exc_info.value.status_code == 400

async def test_inpaint_rejects_malformed_image(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenInpaintIn(image="not-a-data-url", mask="data:image/png;base64,AAAA",
                             positive="a cat", negative="")
    with pytest.raises(HTTPException) as exc_info:
        await stream_inpaint_image(body, current_user=user)
    assert exc_info.value.status_code == 400
