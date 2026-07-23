import io
import os

import pytest
from PIL import Image
from fastapi import HTTPException

from backend import media


def _png_bytes(width=64, height=64, color=(255, 0, 0)):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes(width=64, height=64, color=(0, 255, 0)):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="JPEG", quality=100)
    return buf.getvalue()


def _animated_gif_bytes(frames=3, width=32, height=32):
    images = [Image.new("RGBA", (width, height), (i * 30, 0, 0, 255)) for i in range(frames)]
    buf = io.BytesIO()
    images[0].save(buf, format="GIF", save_all=True, append_images=images[1:],
                    duration=80, loop=0)
    return buf.getvalue()


def _static_gif_bytes(width=32, height=32):
    buf = io.BytesIO()
    Image.new("RGBA", (width, height), (10, 20, 30, 255)).save(buf, format="GIF")
    return buf.getvalue()


def test_optimize_static_image_reencodes_to_webp():
    data = _png_bytes(2000, 2000)
    out, ext = media._optimize_image(data, ".png")
    assert ext == ".webp"
    img = Image.open(io.BytesIO(out))
    assert img.format == "WEBP"
    assert max(img.size) <= 1024


def test_optimize_static_image_respects_max_dim():
    data = _png_bytes(2000, 2000)
    out, ext = media._optimize_image(data, ".png", max_dim=200)
    img = Image.open(io.BytesIO(out))
    assert max(img.size) <= 200


def test_optimize_keeps_original_if_not_smaller():
    data = _png_bytes(4, 4)
    out, ext = media._optimize_image(data, ".png")
    assert len(out) <= len(data) or ext == ".png"


def test_optimize_animated_gif_reencodes_to_webp():
    data = _animated_gif_bytes(frames=5)
    out, ext = media._optimize_image(data, ".gif")
    img = Image.open(io.BytesIO(out))
    if ext == ".webp":
        assert getattr(img, "is_animated", False)
    else:
        assert ext == ".gif"


def test_optimize_animated_gif_downscales_to_gif_dim():
    data = _animated_gif_bytes(frames=3, width=900, height=900)
    out, ext = media._optimize_image(data, ".gif", max_dim=1024)
    img = Image.open(io.BytesIO(out))
    assert max(img.size) <= 480


def test_optimize_animated_gif_too_many_frames_raises():
    data = _animated_gif_bytes(frames=3)

    class _FakeImg:
        is_animated = True
        n_frames = media.MAX_GIF_FRAMES + 1

        def __enter__(self):
            return self

    import backend.media as media_module
    real_open = media_module.Image.open
    media_module.Image.open = lambda *_a, **_k: _FakeImg()
    try:
        with pytest.raises(HTTPException) as excinfo:
            media._optimize_image(data, ".gif")
        assert excinfo.value.status_code == 400
    finally:
        media_module.Image.open = real_open


def test_optimize_invalid_bytes_falls_back_to_original():
    data = b"not an image at all"
    out, ext = media._optimize_image(data, ".png")
    assert out == data
    assert ext == ".png"


@pytest.mark.asyncio
async def test_reencode_webp_full_resolution():
    data = _png_bytes(500, 500)
    out = await media.reencode_webp(data)
    img = Image.open(io.BytesIO(out))
    assert img.format == "WEBP"
    assert img.size == (500, 500)


@pytest.mark.asyncio
async def test_reencode_webp_falls_back_on_bad_data():
    data = b"garbage"
    out = await media.reencode_webp(data)
    assert out == data


@pytest.mark.asyncio
async def test_validate_image_accepts_valid_png():
    await media.validate_image(_png_bytes())


@pytest.mark.asyncio
async def test_validate_image_rejects_invalid_bytes():
    with pytest.raises(HTTPException) as excinfo:
        await media.validate_image(b"not an image")
    assert excinfo.value.status_code == 400


def test_check_upload_size_accepts_within_limit():
    media._check_upload_size(b"x" * 1024)


def test_check_upload_size_rejects_oversized():
    with pytest.raises(HTTPException) as excinfo:
        media._check_upload_size(b"x" * (media.MAX_UPLOAD_BYTES + 1))
    assert excinfo.value.status_code == 413


def test_process_image_sync_valid_static_image():
    data = _png_bytes(300, 300)
    out, ext = media._process_image_sync(data, ".png", allow_animated=True)
    assert ext == ".webp"
    img = Image.open(io.BytesIO(out))
    assert img.format == "WEBP"


def test_process_image_sync_invalid_bytes_raises():
    with pytest.raises(HTTPException) as excinfo:
        media._process_image_sync(b"garbage", ".png", allow_animated=True)
    assert excinfo.value.status_code == 400


def test_process_image_sync_rejects_animated_when_disallowed():
    data = _animated_gif_bytes()
    with pytest.raises(HTTPException) as excinfo:
        media._process_image_sync(data, ".gif", allow_animated=False)
    assert excinfo.value.status_code == 400
    assert "animated" in excinfo.value.detail


def test_process_image_sync_allows_animated_when_allowed():
    data = _animated_gif_bytes()
    out, ext = media._process_image_sync(data, ".gif", allow_animated=True)
    assert out


def test_process_image_sync_allows_static_gif_when_animated_disallowed():
    data = _static_gif_bytes()
    out, ext = media._process_image_sync(data, ".gif", allow_animated=False)
    assert out


@pytest.mark.asyncio
async def test_save_uploaded_image_writes_file(tmp_path, monkeypatch):
    monkeypatch.setattr(media, "MEDIA_DIR", str(tmp_path))
    data = _jpeg_bytes(300, 300)
    final_ext = await media._save_uploaded_image(data, "test-basename", ".jpg")
    assert final_ext == ".webp"
    written_path = os.path.join(str(tmp_path), "test-basename" + final_ext)
    assert os.path.exists(written_path)
    img = Image.open(written_path)
    assert img.format == "WEBP"


@pytest.mark.asyncio
async def test_save_uploaded_image_rejects_oversized(tmp_path, monkeypatch):
    monkeypatch.setattr(media, "MEDIA_DIR", str(tmp_path))
    data = b"x" * (media.MAX_UPLOAD_BYTES + 1)
    with pytest.raises(HTTPException) as excinfo:
        await media._save_uploaded_image(data, "too-big", ".png")
    assert excinfo.value.status_code == 413
    assert not os.listdir(str(tmp_path))


@pytest.mark.asyncio
async def test_save_uploaded_image_rejects_invalid_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(media, "MEDIA_DIR", str(tmp_path))
    with pytest.raises(HTTPException) as excinfo:
        await media._save_uploaded_image(b"not an image", "bad", ".png")
    assert excinfo.value.status_code == 400
    assert not os.listdir(str(tmp_path))


@pytest.mark.asyncio
async def test_save_uploaded_image_rejects_animated_gif_when_disallowed(tmp_path, monkeypatch):
    monkeypatch.setattr(media, "MEDIA_DIR", str(tmp_path))
    data = _animated_gif_bytes()
    with pytest.raises(HTTPException) as excinfo:
        await media._save_uploaded_image(data, "anim", ".gif", allow_animated=False)
    assert excinfo.value.status_code == 400
    assert not os.listdir(str(tmp_path))


@pytest.mark.asyncio
async def test_gif_blurred_preview_returns_static_webp():
    data = _animated_gif_bytes(frames=4, width=200, height=200)
    out = await media.gif_blurred_preview(data, max_dim=64)
    img = Image.open(io.BytesIO(out))
    assert img.format == "WEBP"
    assert not getattr(img, "is_animated", False)
    assert max(img.size) <= 64


def test_delete_media_file_removes_existing_file(tmp_path, monkeypatch):
    monkeypatch.setattr(media, "MEDIA_DIR", str(tmp_path))
    file_path = os.path.join(str(tmp_path), "somefile.webp")
    with open(file_path, "wb") as fh:
        fh.write(b"data")
    media._delete_media_file("/media/somefile.webp")
    assert not os.path.exists(file_path)


def test_delete_media_file_ignores_nonexistent_file(tmp_path, monkeypatch):
    monkeypatch.setattr(media, "MEDIA_DIR", str(tmp_path))
    media._delete_media_file("/media/does-not-exist.webp")


def test_delete_media_file_ignores_non_media_url(tmp_path, monkeypatch):
    monkeypatch.setattr(media, "MEDIA_DIR", str(tmp_path))
    media._delete_media_file("/static/somefile.webp")


def test_delete_media_file_handles_none():
    media._delete_media_file(None)
