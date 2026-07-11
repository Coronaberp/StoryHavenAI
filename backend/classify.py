"""Shared NSFW image classification: synchronous and fire-and-forget async
variants used by every image upload/save path across the app (characters,
personas, lore, comments, profile, emojis)."""
import io
import asyncio
import base64

from PIL import Image

from backend import llm
from backend.repositories import notifications as notification_repo
from backend.state import VISION_CLASSIFY, log


def _is_animated_image(raw: bytes | None) -> bool:
    """True for any multi-frame image (GIF or WebP) — not just GIF. Media uploads
    that were animated GIFs may now be stored as animated WebP (media.py re-encodes
    for size), so this can't key off format == "GIF" alone without silently letting
    animations slip past the classifier-skip gates below."""
    if not raw:
        return False
    try:
        img = Image.open(io.BytesIO(raw))
        return img.format in ("GIF", "WEBP") and getattr(img, "is_animated", False)
    except Exception:
        return False


async def classify_image_nsfw(image: bytes | str, mime: str = "image/png",
                              user_id: str | None = None, is_admin: bool = False) -> tuple[bool, int]:
    """Shared auto-NSFW classifier for every image upload/save path. `image` is
    either raw bytes or an already-built `data:image/...;base64,...` URL. Sends
    the image to the effective chat (vision) endpoint and returns
    (is_explicit, confidence_0_100). Any failure returns (False, 0) — fail-open
    on the classifier verdict itself (never blocks the save), but confidence 0
    still reads as "not confident" for callers that flag low-confidence calls.

    Animated GIFs are never actually sent to the classifier: a vision model
    is handed a single decoded frame like any other image format (there's no
    "look at the whole animation" path), so a verdict on frame 0 says nothing
    about what the other frames show. Reporting that as a confident classification
    would be worse than reporting nothing — this returns (False, 0) immediately,
    which callers already treat as "needs a human look" via on_low_confidence."""
    # Detected from the actual bytes, not the caller-supplied mime — several
    # call sites pass a hardcoded "image/png" regardless of what was actually
    # uploaded, so trusting mime here would miss real GIFs at those call sites.
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
    """Fire-and-forget NSFW classification. Runs the ~1.7s vision round-trip off
    the request path so an upload returns immediately, then calls `apply` (an
    async no-arg callable that flags the just-saved row explicit) only if the
    model flags it. The image is briefly visible unblurred until this resolves;
    acceptable because every upload is private or owner-only at save time
    (standalone images stay private until an explicit separate share, chat images
    are session-scoped, a profile/character/lore image is the owner's own), and
    the classifier was always fail-open (never a hard guarantee).
    on_done, if given, is an async callable(explicit: bool) invoked regardless
    of the outcome (including on a classification failure, with explicit=False)
    — for callers that need to know classification actually ran, not just that
    it flagged something (e.g. gating a share action on "has been rated").
    on_low_confidence, if given, is an async callable(explicit: bool, confidence:
    int) invoked only when the model's own reported confidence is below 80 —
    the verdict is still applied as usual either way (confidence never changes
    what gets stored), this is purely for surfacing a "might be worth a second
    look" flag to admins on top of that.
    review_context is a short human-readable label ("a profile avatar", "a lore
    image", ...) used only for the admin notification below — callers that
    already pass on_low_confidence with their own queue-entry logic aren't
    affected by it.

    Animated GIFs are never sent to the classifier at all (see
    classify_image_nsfw) and are never left unrated either: `apply` runs
    immediately and unconditionally, nsfw-by-default, the same way regardless
    of which upload path this was called from — an admin has to look at it
    directly and clear the flag before it's ever shown unblurred."""
    async def _run():
        explicit = False
        confidence = 0
        try:
            # GIF-decode with PIL is synchronous CPU work — deliberately done
            # here, inside the background task, not in classify_image_background's
            # own body. This function is called directly from the request
            # handler (never awaited there), so anything synchronous in its
            # body runs on the single event loop thread before the response
            # can go out, stalling every other concurrent request for the
            # decode's duration. A previous version did the check right here
            # in the sync body — every image save got visibly slower because
            # of it, this undoes that.
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
    """(bytes, mime) from a data:image/...;base64,... URL, or (None, None)."""
    if not data_url or not data_url.startswith("data:image/"):
        return None, None
    try:
        header, b64 = data_url.split(",", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0]
        return base64.b64decode(b64), mime
    except Exception:
        return None, None
