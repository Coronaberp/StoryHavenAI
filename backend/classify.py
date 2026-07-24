import io
import asyncio
import base64

from PIL import Image

from backend import llm
from backend.repositories import notifications as notification_repo
from backend.state import CFG, VISION_CLASSIFY, log

def _is_animated_image(raw: bytes | None) -> bool:
    if not raw:
        return False
    try:
        img = Image.open(io.BytesIO(raw))
        return img.format in ("GIF", "WEBP") and getattr(img, "is_animated", False)
    except Exception:
        return False

async def classify_image_nsfw(image: bytes | str, mime: str = "image/png",
                              user_id: str | None = None, is_admin: bool = False) -> tuple[bool, int]:

    if not CFG.get("nsfw_classification", True):
        log.info("nsfw-classify user=%s: skipped, classification disabled in settings", user_id)
        return False, 0
    if isinstance(image, (bytes, bytearray)) and _is_animated_image(bytes(image)):
        log.info("nsfw-classify user=%s: animated GIF, skipping unreliable single-frame classification", user_id)
        return False, 0
    if isinstance(image, (bytes, bytearray)):
        data_url = f"data:{mime};base64," + base64.b64encode(bytes(image)).decode()
    else:
        data_url = image
    if not data_url or not data_url.startswith("data:image/"):
        return False, 0
    flagged, confidence, raw = await llm.classify_image_explicit(
        data_url, VISION_CLASSIFY["model"],
        base_url=VISION_CLASSIFY["base_url"], api_key=VISION_CLASSIFY["api_key"])
    log.info("nsfw-classify user=%s flagged=%s confidence=%s raw=%r", user_id, flagged, confidence, (raw or "")[:60])
    return flagged, confidence

_bg_classify_tasks: set = set()

def classify_image_background(image: bytes | str, mime: str, user_id: str | None,
                             is_admin: bool, apply, on_done=None, on_low_confidence=None,
                             review_context: str = "an uploaded image"):
    async def _run():
        explicit = False
        confidence = 0
        if not CFG.get("nsfw_classification", True):
            if on_done:
                try:
                    await on_done(False)
                except Exception as e:
                    log.warning("background nsfw classify on_done failed: %s", e)
            return
        try:

            is_animated = isinstance(image, (bytes, bytearray)) and _is_animated_image(bytes(image))
            if is_animated:
                explicit = True
                await apply()
                await notification_repo.notify_admins(
                    "admin_image_report", "Animated GIF needs manual rating",
                    f"{review_context.capitalize()} was uploaded as an animated GIF — "
                    "the NSFW classifier can't reliably judge animations, so it was "
                    "pre-flagged NSFW and blurred pending your review.",
                    "/admin/moderation")
            else:
                explicit, confidence = await classify_image_nsfw(image, mime, user_id, is_admin)
                if explicit:
                    await apply()
                if confidence < 80 and on_low_confidence:
                    await on_low_confidence(explicit, confidence)
        except Exception as e:
            log.warning("background nsfw classify failed: %s", e)
        if on_done:
            try:
                await on_done(explicit)
            except Exception as e:
                log.warning("background nsfw classify on_done failed: %s", e)
    task = asyncio.create_task(_run())
    _bg_classify_tasks.add(task)
    task.add_done_callback(_bg_classify_tasks.discard)

def _data_url_to_bytes(data_url: str) -> tuple[bytes, str] | tuple[None, None]:
    if not data_url or not data_url.startswith("data:image/"):
        return None, None
    try:
        header, b64 = data_url.split(",", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0]
        return base64.b64decode(b64), mime
    except Exception:
        return None, None
