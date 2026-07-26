import pytest
from fastapi import HTTPException

from backend.routers.imagegen import stream_inpaint_image, _image_gen_defaults
from backend.schemas import ImageGenInpaintIn
from backend.state import CFG

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

def test_image_gen_defaults_uses_sdxl_settings_for_non_anima(monkeypatch):
    monkeypatch.setitem(CFG, "image_gen_default_checkpoint_sdxl", "wai_illustrious_sdxl.safetensors")
    monkeypatch.setitem(CFG, "image_gen_default_sampler_sdxl", "euler")
    monkeypatch.setitem(CFG, "image_gen_default_scheduler_sdxl", "normal")

    result = _image_gen_defaults("sdxl")

    assert result == {
        "checkpoint": "wai_illustrious_sdxl.safetensors",
        "sampler": "euler",
        "scheduler": "normal",
    }

def test_image_gen_defaults_uses_anima_settings_for_anima(monkeypatch):
    monkeypatch.setitem(CFG, "image_gen_default_checkpoint_anima", "animagine_xl_4.0.safetensors")
    monkeypatch.setitem(CFG, "image_gen_default_sampler_anima", "er_sde")
    monkeypatch.setitem(CFG, "image_gen_default_scheduler_anima", "simple")

    result = _image_gen_defaults("anima")

    assert result == {
        "checkpoint": "animagine_xl_4.0.safetensors",
        "sampler": "er_sde",
        "scheduler": "simple",
    }

def test_image_gen_defaults_checkpoint_falls_back_to_none_when_unset(monkeypatch):
    monkeypatch.setitem(CFG, "image_gen_default_checkpoint_sdxl", "")

    result = _image_gen_defaults("sdxl")

    assert result["checkpoint"] is None
