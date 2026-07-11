"""Image validation/optimization and media file helpers."""
import os
import io
import asyncio

from PIL import Image, ImageFilter
from fastapi import HTTPException

from backend.state import MEDIA_DIR, MAX_UPLOAD_BYTES, log

# GIF's per-frame LZW compression makes a small file with tens of thousands of
# frames cheap to craft — without a cap, re-encoding every frame (RGBA
# convert + thumbnail + re-palettize) is an easy CPU/memory exhaustion DoS
# against the single-worker event loop's executor pool for a file that passed
# MAX_UPLOAD_BYTES with room to spare.
MAX_GIF_FRAMES = 500

def _optimize_image(data: bytes, ext: str, max_dim: int = 1024) -> tuple[bytes, str]:
    """Shrink uploaded art before it's stored: phones were downloading multi-MB
    originals just to paint a 58px avatar. Static images are capped at max_dim
    (1024px by default; callers with much smaller display sizes — e.g. custom
    emoji — pass a tighter cap) and re-encoded as WebP; animated GIFs keep
    their animation but are downscaled to min(480, max_dim) and re-optimized.
    If the optimized copy isn't actually smaller, the original is kept."""
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
            # Lossless WebP, not GIF: GIF forces a 256-color-per-frame palette and
            # only LZW-compresses each frame independently, so real-world avatar/
            # emoji GIFs were coming out several MB even after the downscale above.
            # Lossless WebP keeps full RGBA color depth (strictly equal or better
            # fidelity than GIF's palette) and inter-frame delta compression, which
            # is why it comes out smaller for the same pixels — not a quality trade.
            # method=4, not 6: still fully lossless (method only trades encoder
            # search effort for size, never fidelity) but method=6 measured at
            # ~200s for a 131-frame animation vs ~2s at method=4, for under 1%
            # extra size reduction — 6 would make every animated upload hang.
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
    """Re-encode to WebP at full resolution (no thumbnailing — unlike
    _optimize_image, this exists specifically for a 4x-upscaled result, where
    shrinking the dimensions back down would undo the whole point of
    upscaling). A raw PNG straight out of ComfyUI's upscale node easily blows
    past MAX_UPLOAD_BYTES for a detailed 4096px+ image; WebP at this quality
    is visually near-identical and typically 60-80% smaller. Falls back to
    the original bytes on any decode/encode failure — never blocks the
    upscale result on a re-encode problem."""
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
    """Confirm bytes decode as a real image without re-encoding — used where an
    upload is stored as-is rather than routed through _save_uploaded_image."""
    await asyncio.get_running_loop().run_in_executor(None, _validate_image_sync, data)


def _check_upload_size(data: bytes):
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")


def _write_file_sync(path: str, data: bytes):
    with open(path, "wb") as fh:
        fh.write(data)


async def _write_file(path: str, data: bytes):
    """Write bytes off the event loop so a slow disk never stalls concurrent requests."""
    await asyncio.get_running_loop().run_in_executor(None, _write_file_sync, path, data)


def _process_image_sync(data: bytes, ext: str, allow_animated: bool, max_dim: int = 1024) -> tuple[bytes, str]:
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
    return _optimize_image(data, ext, max_dim)


async def _save_uploaded_image(data: bytes, dest_basename: str, ext: str,
                               allow_animated: bool = True, max_dim: int = 1024) -> str:
    """Validate, optimize, and persist an uploaded image entirely in a worker thread
    (PIL decode/encode and the file write are both CPU/IO-bound and would otherwise
    block the single-worker event loop). Returns the final extension actually written,
    which may differ from `ext` (e.g. a PNG re-encoded to .webp)."""
    _check_upload_size(data)
    loop = asyncio.get_running_loop()
    out, final_ext = await loop.run_in_executor(None, _process_image_sync, data, ext, allow_animated, max_dim)
    await loop.run_in_executor(None, _write_file_sync,
                               os.path.join(MEDIA_DIR, dest_basename + final_ext), out)
    return final_ext


def _gif_blurred_preview_sync(data: bytes, max_dim: int = 128) -> bytes:
    """A single, heavily-blurred static frame (webp) standing in for an
    animated GIF while it's pending admin review — see emojis.py. Frame 0
    only (an animation's other frames are exactly what the classifier can't
    see, so this is a display-only placeholder, not a claim that frame 0 is
    representative) and blurred on top of that, since a GIF is small/emoji-
    sized to begin with and a plain unblurred single frame could still be
    identifiable at that size."""
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

