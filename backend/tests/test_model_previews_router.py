import io

import pytest
from fastapi import HTTPException, UploadFile

from backend.auth import get_admin
from backend.repositories import checkpoints, loras, samplers, schedulers, upscalers
from backend.routers import model_previews
from backend.schemas import LoraPublishIn, ModelMetaIn

pytestmark = pytest.mark.asyncio

ADMIN = {"id": "u_mp_admin", "username": "mpadmin", "is_admin": True, "role": "admin"}
PLAIN_USER = {"id": "u_mp_user", "username": "mpuser", "is_admin": False, "role": "user"}

_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000c4944415478da63646060601a01000005000103d18f7c8f0000000049454e44ae426082")

def _upload(filename="preview.png", data=_PNG_BYTES):
    return UploadFile(file=io.BytesIO(data), filename=filename)

async def test_admin_only_routes_reject_plain_user():
    with pytest.raises(HTTPException) as exc_info:
        await get_admin(current_user=PLAIN_USER)
    assert exc_info.value.status_code == 403

async def test_checkpoint_meta_route_sets_and_returns_meta(db_conn):
    body = ModelMetaIn(display_name="My Checkpoint", description="a nice checkpoint",
                       model_type="sdxl", default_steps=25)

    result = await model_previews.set_checkpoint_meta_route("ckpt-a.safetensors", body, current_user=ADMIN)

    assert result["display_name"] == "My Checkpoint"
    stored = await checkpoints.list_previews()
    assert stored["ckpt-a.safetensors"]["model_type"] == "sdxl"

async def test_checkpoint_preview_upload_and_clear(db_conn, monkeypatch):
    monkeypatch.setattr(model_previews, "MEDIA_DIR", "/tmp")
    monkeypatch.setattr(model_previews, "_delete_media_file", lambda path: None)
    async def _fake_save(data, basename, ext, allow_animated=False):
        return ".png"
    monkeypatch.setattr(model_previews, "_save_uploaded_image", _fake_save)

    result = await model_previews.set_checkpoint_preview("ckpt-b.safetensors", file=_upload(), current_user=ADMIN)
    assert result["checkpoint_name"] == "ckpt-b.safetensors"
    assert (await checkpoints.get_preview("ckpt-b.safetensors")) is not None

    cleared = await model_previews.clear_checkpoint_preview("ckpt-b.safetensors", current_user=ADMIN)
    assert cleared == {"cleared": True}
    assert (await checkpoints.get_preview("ckpt-b.safetensors")) is None

async def test_get_imagegen_checkpoints_wraps_comfyui_errors(db_conn, monkeypatch):
    from backend import imagegen
    async def _boom(url):
        raise RuntimeError("connection refused")
    monkeypatch.setattr(imagegen, "list_checkpoints", _boom)

    with pytest.raises(HTTPException) as exc_info:
        await model_previews.get_imagegen_checkpoints(current_user=PLAIN_USER)

    assert exc_info.value.status_code == 502

async def test_get_imagegen_checkpoints_returns_list(db_conn, monkeypatch):
    from backend import imagegen
    async def _fake_list(url):
        return ["ckpt-a.safetensors", "ckpt-b.safetensors"]
    monkeypatch.setattr(imagegen, "list_checkpoints", _fake_list)

    result = await model_previews.get_imagegen_checkpoints(current_user=PLAIN_USER)

    assert result == ["ckpt-a.safetensors", "ckpt-b.safetensors"]

async def test_get_imagegen_loras_hides_unpublished_for_plain_user(db_conn, monkeypatch):
    from backend import imagegen
    async def _fake_list(url):
        return ["public-lora.safetensors", "gated-lora.safetensors"]
    monkeypatch.setattr(imagegen, "list_loras", _fake_list)
    await loras.gate_visibility("gated-lora.safetensors", "u_mp_admin")

    result = await model_previews.get_imagegen_loras(current_user=PLAIN_USER)

    assert result == ["public-lora.safetensors"]

async def test_get_imagegen_loras_shows_everything_for_admin(db_conn, monkeypatch):
    from backend import imagegen
    async def _fake_list(url):
        return ["public-lora.safetensors", "gated-lora-2.safetensors"]
    monkeypatch.setattr(imagegen, "list_loras", _fake_list)
    await loras.gate_visibility("gated-lora-2.safetensors", "u_mp_admin")

    result = await model_previews.get_imagegen_loras(current_user=ADMIN)

    assert set(result) == {"public-lora.safetensors", "gated-lora-2.safetensors"}

async def test_lora_meta_route_rejects_invalid_category(db_conn):
    body = ModelMetaIn(display_name="X", model_category=["not-a-real-category"])

    with pytest.raises(HTTPException) as exc_info:
        await model_previews.set_lora_meta_route("lora-x.safetensors", body, current_user=ADMIN)

    assert exc_info.value.status_code == 400

async def test_lora_meta_route_accepts_valid_category(db_conn):
    body = ModelMetaIn(display_name="X", model_category=["sdxl", "pony"], keywords=["my trigger"])

    result = await model_previews.set_lora_meta_route("lora-y.safetensors", body, current_user=ADMIN)

    assert result["model_category"] == ["sdxl", "pony"]

async def test_publish_lora_route_requires_gated_lora(db_conn):
    body = LoraPublishIn(published=True)

    with pytest.raises(HTTPException) as exc_info:
        await model_previews.publish_lora_route("never-gated.safetensors", body, current_user=ADMIN)

    assert exc_info.value.status_code == 404

async def test_publish_lora_route_publishes_gated_lora(db_conn):
    await loras.gate_visibility("gated-for-publish.safetensors", "u_mp_admin")
    body = LoraPublishIn(published=True)

    result = await model_previews.publish_lora_route("gated-for-publish.safetensors", body, current_user=ADMIN)

    assert result["is_published"] is True

async def test_delete_model_file_rejects_unsupported_kind(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await model_previews.delete_model_file("nope", "some-file.safetensors", current_user=ADMIN)

    assert exc_info.value.status_code == 400

async def test_delete_model_file_missing_file_404s(db_conn, monkeypatch, tmp_path):
    monkeypatch.setitem(model_previews._DELETABLE_MODEL_DIRS, "ckpt", str(tmp_path))

    with pytest.raises(HTTPException) as exc_info:
        await model_previews.delete_model_file("ckpt", "missing-file.safetensors", current_user=ADMIN)

    assert exc_info.value.status_code == 404

async def test_delete_model_file_removes_file_and_preview(db_conn, monkeypatch, tmp_path):
    target = tmp_path / "real-ckpt.safetensors"
    target.write_bytes(b"fake weights")
    monkeypatch.setitem(model_previews._DELETABLE_MODEL_DIRS, "ckpt", str(tmp_path))
    await checkpoints.set_preview("real-ckpt.safetensors", "data:image/png;base64,abc")

    result = await model_previews.delete_model_file("ckpt", "real-ckpt.safetensors", current_user=ADMIN)

    assert result == {"deleted": True}
    assert not target.exists()
    assert (await checkpoints.get_preview("real-ckpt.safetensors")) is None

async def test_sampler_meta_and_preview_roundtrip(db_conn, monkeypatch):
    async def _fake_save(data, basename, ext, allow_animated=False):
        return ".png"
    monkeypatch.setattr(model_previews, "_save_uploaded_image", _fake_save)
    monkeypatch.setattr(model_previews, "_delete_media_file", lambda path: None)

    body = ModelMetaIn(display_name="Euler A", description="a sampler")
    meta_result = await model_previews.set_sampler_meta_route("euler_a", body, current_user=ADMIN)
    assert meta_result["display_name"] == "Euler A"

    preview_result = await model_previews.set_sampler_preview("euler_a", file=_upload(), current_user=ADMIN)
    assert preview_result["sampler_name"] == "euler_a"

    previews = await model_previews.get_sampler_previews(current_user=PLAIN_USER)
    assert previews["euler_a"]["display_name"] == "Euler A"

    cleared = await model_previews.clear_sampler_preview("euler_a", current_user=ADMIN)
    assert cleared == {"cleared": True}

async def test_scheduler_meta_and_preview_roundtrip(db_conn, monkeypatch):
    async def _fake_save(data, basename, ext, allow_animated=False):
        return ".png"
    monkeypatch.setattr(model_previews, "_save_uploaded_image", _fake_save)
    monkeypatch.setattr(model_previews, "_delete_media_file", lambda path: None)

    body = ModelMetaIn(display_name="Karras", description="a scheduler")
    await model_previews.set_scheduler_meta_route("karras", body, current_user=ADMIN)
    await model_previews.set_scheduler_preview("karras", file=_upload(), current_user=ADMIN)

    previews = await model_previews.get_scheduler_previews(current_user=PLAIN_USER)
    assert previews["karras"]["display_name"] == "Karras"

    cleared = await model_previews.clear_scheduler_preview("karras", current_user=ADMIN)
    assert cleared == {"cleared": True}

async def test_upscaler_meta_and_preview_roundtrip(db_conn, monkeypatch):
    async def _fake_save(data, basename, ext, allow_animated=False):
        return ".png"
    monkeypatch.setattr(model_previews, "_save_uploaded_image", _fake_save)
    monkeypatch.setattr(model_previews, "_delete_media_file", lambda path: None)

    body = ModelMetaIn(display_name="4x-UltraSharp", description="an upscaler")
    await model_previews.set_upscaler_meta_route("4x-ultrasharp", body, current_user=ADMIN)
    await model_previews.set_upscaler_preview("4x-ultrasharp", file=_upload(), current_user=ADMIN)

    previews = await model_previews.get_upscaler_previews(current_user=PLAIN_USER)
    assert previews["4x-ultrasharp"]["display_name"] == "4x-UltraSharp"

    cleared = await model_previews.clear_upscaler_preview("4x-ultrasharp", current_user=ADMIN)
    assert cleared == {"cleared": True}

async def test_get_imagegen_upscalers_wraps_comfyui_errors(db_conn, monkeypatch):
    from backend import imagegen
    async def _boom(url):
        raise RuntimeError("connection refused")
    monkeypatch.setattr(imagegen, "list_upscalers", _boom)

    with pytest.raises(HTTPException) as exc_info:
        await model_previews.get_imagegen_upscalers(current_user=PLAIN_USER)

    assert exc_info.value.status_code == 502
