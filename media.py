"""Image validation/optimization and media file helpers."""
import os
import io
import asyncio

from PIL import Image
from fastapi import HTTPException

from state import MEDIA_DIR, MAX_UPLOAD_BYTES

def _optimize_image(data: bytes, ext: str) -> tuple[bytes, str]:
    """Shrink uploaded art before it's stored: phones were downloading multi-MB
    originals just to paint a 58px avatar. Static images are capped at 1024px and
    re-encoded as WebP; animated GIFs keep their animation but are downscaled to
    480px and re-optimized. If the optimized copy isn't actually smaller, the
    original is kept."""
    try:
        img = Image.open(io.BytesIO(data))
        if ext == ".gif" and getattr(img, "is_animated", False):
            frames, durations = [], []
            for i in range(img.n_frames):
                img.seek(i)
                frame = img.convert("RGBA")
                frame.thumbnail((480, 480), Image.LANCZOS)
                frames.append(frame.convert("P", palette=Image.ADAPTIVE))
                durations.append(img.info.get("duration", 80))
            buf = io.BytesIO()
            frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:],
                           duration=durations, loop=img.info.get("loop", 0),
                           optimize=True, disposal=2)
            out = buf.getvalue()
            return (out, ".gif") if len(out) < len(data) else (data, ext)
        img = img.convert("RGBA") if img.mode not in ("RGB", "RGBA") else img
        img.thumbnail((1024, 1024), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=82, method=6)
        out = buf.getvalue()
        return (out, ".webp") if len(out) < len(data) else (data, ext)
    except Exception:
        return data, ext


def _check_upload_size(data: bytes):
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")


def _write_file_sync(path: str, data: bytes):
    with open(path, "wb") as fh:
        fh.write(data)


async def _write_file(path: str, data: bytes):
    """Write bytes off the event loop so a slow disk never stalls concurrent requests."""
    await asyncio.get_running_loop().run_in_executor(None, _write_file_sync, path, data)


def _process_image_sync(data: bytes, ext: str, allow_animated: bool) -> tuple[bytes, str]:
    try:
        img = Image.open(io.BytesIO(data))
        if ext == ".gif":
            img.load()  # verify() doesn't work reliably for animated GIFs
        else:
            img.verify()
    except Exception:
        raise HTTPException(400, "not a valid image")
    if not allow_animated:
        probe = Image.open(io.BytesIO(data))
        if getattr(probe, "is_animated", False):
            raise HTTPException(400, "animated images are not allowed")
    return _optimize_image(data, ext)


async def _save_uploaded_image(data: bytes, dest_basename: str, ext: str,
                               allow_animated: bool = True) -> str:
    """Validate, optimize, and persist an uploaded image entirely in a worker thread
    (PIL decode/encode and the file write are both CPU/IO-bound and would otherwise
    block the single-worker event loop). Returns the final extension actually written,
    which may differ from `ext` (e.g. a PNG re-encoded to .webp)."""
    _check_upload_size(data)
    loop = asyncio.get_running_loop()
    out, final_ext = await loop.run_in_executor(None, _process_image_sync, data, ext, allow_animated)
    await loop.run_in_executor(None, _write_file_sync,
                               os.path.join(MEDIA_DIR, dest_basename + final_ext), out)
    return final_ext


def _delete_media_file(url: str | None):
    if url and url.startswith("/media/"):
        path = os.path.join(MEDIA_DIR, os.path.basename(url))
        if os.path.exists(path):
            os.remove(path)

