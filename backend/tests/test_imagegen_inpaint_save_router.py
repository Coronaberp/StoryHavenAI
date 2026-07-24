import base64

import pytest

from backend.routers.imagegen import save_inpaint_image
from backend.schemas import ImageGenSaveIn

pytestmark = pytest.mark.asyncio

def _tiny_png_b64():
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (255, 0, 0)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

async def test_inpaint_save_creates_variant_without_source_id(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenSaveIn(image=f"data:image/png;base64,{_tiny_png_b64()}",
                          positive="a dog", negative="")

    saved = await save_inpaint_image(body, current_user=user)

    assert saved["source_image_id"] is None
    assert saved["media_type"] == "image"
    assert saved["is_img2img"] is True
