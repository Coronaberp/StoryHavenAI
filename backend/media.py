import os
import io
import asyncio

from PIL import Image, ImageFilter
from fastapi import HTTPException

from backend.state import MEDIA_DIR, MAX_UPLOAD_BYTES, log

MAX_GIF_FRAMES = 500

def _optimize_image(data: bytes, ext: str, max_dim: int = 1024) -> tuple[bytes, str]:
    try:
        img = Image.open(io.BytesIO(data))
        if ext == ".gif" and getattr(img, "is_animated", False):
            if img.n_frames > MAX_GIF_FRAMES:
                raise HTTPException(400, f"animated GIF has too many frames (max {MAX_GIF_FRAMES})")
            gif_dim = min(480, max_dim)
            frames, durations = [], []
            for i in range(img.n_frames):
                img.seek(i)
                frame = img.convert("RGBA")
                frame.thumbnail((gif_dim, gif_dim), Image.LANCZOS)
                frames.append(frame)
                durations.append(img.info.get("duration", 80))

            buf = io.BytesIO()
            frames[0].save(buf, format="WEBP", save_all=True, append_images=frames[1:],
                           duration=durations, loop=img.info.get("loop", 0),
                           lossless=True, quality=100, method=4)
            out = buf.getvalue()
            return (out, ".webp") if len(out) < len(data) else (data, ext)
        img = img.convert("RGBA") if img.mode not in ("RGB", "RGBA") else img
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=82, method=6)
        out = buf.getvalue()
        return (out, ".webp") if len(out) < len(data) else (data, ext)
    except HTTPException:
        raise
    except Exception as e:
        log.warning("media: optimize failed, storing original ext=%s size=%d error=%s", ext, len(data), e)
        return data, ext

def _reencode_webp_sync(data: bytes, quality: int = 90) -> bytes:
    try:
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGBA") if img.mode not in ("RGB", "RGBA") else img
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=quality, method=6)
        out = buf.getvalue()
        return out if len(out) < len(data) else data
    except Exception as e:
        log.warning("media: re-encode failed, keeping original size=%d error=%s", len(data), e)
        return data

async def reencode_webp(data: bytes, quality: int = 90) -> bytes:
    return await asyncio.get_running_loop().run_in_executor(None, _reencode_webp_sync, data, quality)

def _validate_image_sync(data: bytes):
    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        raise HTTPException(400, "not a valid image")

async def validate_image(data: bytes):
    await asyncio.get_running_loop().run_in_executor(None, _validate_image_sync, data)

def _check_upload_size(data: bytes):
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")

def _write_file_sync(path: str, data: bytes):
    with open(path, "wb") as fh:
        fh.write(data)

async def _write_file(path: str, data: bytes):
    await asyncio.get_running_loop().run_in_executor(None, _write_file_sync, path, data)

def _process_image_sync(data: bytes, ext: str, allow_animated: bool, max_dim: int = 1024) -> tuple[bytes, str]:
    try:
        img = Image.open(io.BytesIO(data))
        if ext == ".gif":
            img.load()
        else:
            img.verify()
    except Exception:
        raise HTTPException(400, "not a valid image")
    if not allow_animated:
        probe = Image.open(io.BytesIO(data))
        if getattr(probe, "is_animated", False):
            raise HTTPException(400, "animated images are not allowed")
    return _optimize_image(data, ext, max_dim)

async def _save_uploaded_image(data: bytes, dest_basename: str, ext: str,
                               allow_animated: bool = True, max_dim: int = 1024) -> str:
    _check_upload_size(data)
    loop = asyncio.get_running_loop()
    out, final_ext = await loop.run_in_executor(None, _process_image_sync, data, ext, allow_animated, max_dim)
    await loop.run_in_executor(None, _write_file_sync,
                               os.path.join(MEDIA_DIR, dest_basename + final_ext), out)
    return final_ext

def _gif_blurred_preview_sync(data: bytes, max_dim: int = 128) -> bytes:
    img = Image.open(io.BytesIO(data))
    img.seek(0)
    frame = img.convert("RGBA")
    frame.thumbnail((max_dim, max_dim), Image.LANCZOS)
    frame = frame.filter(ImageFilter.GaussianBlur(radius=max(4, max_dim // 12)))
    buf = io.BytesIO()
    frame.save(buf, format="WEBP", quality=70, method=6)
    return buf.getvalue()

async def gif_blurred_preview(data: bytes, max_dim: int = 128) -> bytes:
    return await asyncio.get_running_loop().run_in_executor(
        None, _gif_blurred_preview_sync, data, max_dim)

def _delete_media_file(url: str | None):
    if url and url.startswith("/media/"):
        path = os.path.join(MEDIA_DIR, os.path.basename(url))
        if os.path.exists(path):
            os.remove(path)

