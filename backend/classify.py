"""Application-facing content safety facade and legacy rollback adapter."""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import uuid

from PIL import Image, UnidentifiedImageError

from backend import llm
from backend.repositories import notifications as notification_repo
from backend.safety.config import (
    CLASSIFIER_BACKEND,
    SHADOW_LEGACY,
    SHADOW_TIMEOUT_SECONDS,
)
from backend.safety.contracts import SafetyResult
from backend.safety.observability import current_correlation_ids, log_event, safe_exception
from backend.safety.service import OnnxSafetyClassifier
from backend.state import CFG, VISION_CLASSIFY, log


safety_classifier = OnnxSafetyClassifier()
vision = llm
_LOW_CONFIDENCE_PERCENT: int = 80
_PERCENT_SCALE: int = 100


def _is_animated_image(raw: bytes | None) -> bool:
    if not raw:
        return False
    try:
        with Image.open(io.BytesIO(raw)) as image:
            return image.format in ("GIF", "WEBP") and getattr(image, "is_animated", False)
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        ValueError,
    ):
        return False


def _data_url_to_bytes(data_url: str) -> tuple[bytes, str] | tuple[None, None]:
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        return None, None
    try:
        header, encoded = data_url.split(",", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0]
        if not mime.startswith("image/"):
            return None, None
        return base64.b64decode(encoded, validate=True), mime
    except (binascii.Error, IndexError, UnicodeError, ValueError):
        return None, None


def _coerce_image_bytes(image: bytes | str) -> bytes | None:
    if isinstance(image, bytes):
        return image
    if isinstance(image, bytearray):
        return bytes(image)
    if isinstance(image, str):
        image_bytes, _mime = _data_url_to_bytes(image)
        return image_bytes
    return None


def _confidence_percent(result: SafetyResult) -> int:
    confidence = max(0.0, min(1.0, result.safe_confidence))
    return int(round(confidence * _PERCENT_SCALE))


def _blocked_result(reason: str) -> SafetyResult:
    return SafetyResult(
        safe=False,
        reason=reason,
        safe_confidence=0.0,
        predicted_class="unknown",
    )


def safety_health_snapshot() -> dict[str, object]:
    """Describe the configured classifier without exposing image content."""

    if CLASSIFIER_BACKEND == "legacy":
        return {
            "available": True,
            "status": "legacy_configured",
            "backend": "legacy",
            "runtime": "remote_vision",
            "model_id": VISION_CLASSIFY["model"],
            "model_revision": None,
            "model_sha256": None,
        }
    return safety_classifier.health_snapshot()


def safety_metrics_snapshot() -> dict[str, object]:
    """Return classifier metrics for an internal health view."""

    return safety_classifier.metrics_snapshot()


def safety_health_summary() -> dict[str, object]:
    """Return the non-secret readiness fields suitable for general health output."""

    snapshot = safety_health_snapshot()
    ready = bool(snapshot.get("available", False))
    return {
        "backend": snapshot.get("backend"),
        "ready": ready,
        "model_id": snapshot.get("model_id"),
        "model_revision": snapshot.get("model_revision"),
        "contract_valid": bool(snapshot.get("loaded", ready)),
        "error": None if ready else "unavailable",
    }


async def initialize_safety_classifier() -> bool:
    """Initialize the local backend while leaving the legacy rollback lazy."""

    if CLASSIFIER_BACKEND == "legacy":
        return True
    return await safety_classifier.initialize()


async def _classify_legacy(image_bytes: bytes, mime: str) -> SafetyResult:
    if _is_animated_image(image_bytes):
        return _blocked_result("blocked_animated_image")
    data_url = f"data:{mime};base64," + base64.b64encode(image_bytes).decode()
    try:
        flagged, confidence, raw = await vision.classify_image_explicit(
            data_url,
            VISION_CLASSIFY["model"],
            base_url=VISION_CLASSIFY["base_url"],
            api_key=VISION_CLASSIFY["api_key"],
        )
    except Exception:
        log.exception("legacy nsfw classifier failed")
        return _blocked_result("blocked_classifier_error")
    if not raw or raw.strip().lower().startswith("<error:"):
        return _blocked_result("blocked_classifier_error")
    bounded_confidence = max(0, min(_PERCENT_SCALE, int(confidence)))
    safe = not bool(flagged)
    return SafetyResult(
        safe=safe,
        reason="allowed" if safe else "blocked_nsfw",
        safe_confidence=bounded_confidence / _PERCENT_SCALE,
        predicted_class="legacy_safe" if safe else "legacy_explicit",
    )


async def classify_image_result(
    image: bytes | str,
    mime: str = "image/png",
    user_id: str | None = None,
    is_admin: bool = False,
) -> SafetyResult:
    """Return the typed fail-closed decision for one uploaded image."""

    del user_id, is_admin
    if not CFG.get("nsfw_classification", True):
        return SafetyResult(
            safe=True,
            reason="classification_disabled",
            safe_confidence=0.0,
            predicted_class="disabled",
        )
    image_bytes = _coerce_image_bytes(image)
    if image_bytes is None:
        return _blocked_result("blocked_invalid_image")
    if CLASSIFIER_BACKEND == "legacy":
        return await _classify_legacy(image_bytes, mime)
    if CLASSIFIER_BACKEND != "onnx_nano":
        log.error("nsfw-classify: unsupported backend=%s", CLASSIFIER_BACKEND)
        return _blocked_result("blocked_classifier_error")
    try:
        request_id = current_correlation_ids().get("request_id") or uuid.uuid4().hex
        if SHADOW_LEGACY:
            onnx_task = asyncio.create_task(
                safety_classifier.classify(image_bytes, request_id=request_id)
            )
            legacy_task = asyncio.create_task(_run_legacy_shadow(image_bytes, mime))
            try:
                onnx_result, legacy_result = await asyncio.gather(
                    onnx_task,
                    legacy_task,
                )
            except Exception as exc:
                onnx_task.cancel()
                legacy_task.cancel()
                await asyncio.gather(onnx_task, legacy_task, return_exceptions=True)
                log_event(
                    log,
                    event="safety_classifier_shadow_failed",
                    message="Legacy safety shadow comparison failed",
                    component="safety.classifier",
                    fields=safe_exception(exc),
                    request_id=request_id,
                )
                return _blocked_result("blocked_classifier_error")
            _log_shadow_comparison(onnx_result, legacy_result, request_id)
            return legacy_result
        return await safety_classifier.classify(image_bytes, request_id=request_id)
    except Exception:
        log.exception("nsfw-classify: safety classifier call failed")
        return _blocked_result("blocked_classifier_error")


async def classify_image_nsfw(
    image: bytes | str,
    mime: str = "image/png",
    user_id: str | None = None,
    is_admin: bool = False,
) -> tuple[bool, int]:
    """Return the historical explicit/confidence tuple for existing callers."""

    result = await classify_image_result(image, mime, user_id, is_admin)
    explicit = not result.safe
    confidence = _confidence_percent(result)
    log.info(
        "nsfw-classify user=%s backend=%s explicit=%s confidence=%s reason=%s",
        user_id,
        CLASSIFIER_BACKEND,
        explicit,
        confidence,
        result.reason,
    )
    return explicit, confidence


_bg_classify_tasks: set[asyncio.Task[None]] = set()
_shadow_semaphore = asyncio.Semaphore(1)


async def _run_legacy_shadow(image_bytes: bytes, mime: str) -> SafetyResult:
    async with _shadow_semaphore:
        return await asyncio.wait_for(
            _classify_legacy(image_bytes, mime),
            timeout=max(0.001, SHADOW_TIMEOUT_SECONDS),
        )


def _log_shadow_comparison(
    new_result: SafetyResult,
    legacy_result: SafetyResult,
    request_id: str | None = None,
) -> None:
    log_event(
        log,
        event="safety_classifier_shadow_comparison",
        message="Compared ONNX safety decision with legacy classifier",
        component="safety.classifier",
        fields={
            "new_decision": "allow" if new_result.safe else "block",
            "new_reason": new_result.reason,
            "new_safe_confidence": new_result.safe_confidence,
            "legacy_decision": "allow" if legacy_result.safe else "block",
            "legacy_reason": legacy_result.reason,
            "legacy_safe_confidence": legacy_result.safe_confidence,
            "disagreement": new_result.safe != legacy_result.safe,
        },
        request_id=request_id,
    )


def classify_image_background(
    image: bytes | str,
    mime: str,
    user_id: str | None,
    is_admin: bool,
    apply,
    on_done=None,
    on_low_confidence=None,
    review_context: str = "an uploaded image",
) -> asyncio.Task[None]:
    async def _run() -> None:
        explicit = False
        confidence = 0
        apply_attempted = False
        if not CFG.get("nsfw_classification", True):
            if on_done:
                try:
                    await on_done(False)
                except Exception:
                    log.exception("background nsfw classify on_done failed while disabled")
            return
        try:
            result = await classify_image_result(image, mime, user_id, is_admin)
            explicit = not result.safe
            confidence = _confidence_percent(result)
            if explicit:
                apply_attempted = True
                await apply()
                if result.reason == "blocked_animated_image":
                    await notification_repo.notify_admins(
                        "admin_image_report",
                        "Animated GIF needs manual rating",
                        f"{review_context.capitalize()} was uploaded as an animated GIF — "
                        "the NSFW classifier can't reliably judge animations, so it was "
                        "pre-flagged NSFW and blurred pending your review.",
                        "/admin/moderation",
                    )
            if confidence < _LOW_CONFIDENCE_PERCENT and on_low_confidence:
                try:
                    await on_low_confidence(explicit, confidence)
                except Exception:
                    log.exception("background nsfw classify low-confidence callback failed")
        except Exception:
            log.exception("background nsfw classify failed")
            explicit = True
            if not apply_attempted:
                try:
                    await apply()
                except Exception:
                    log.exception("background nsfw fail-closed apply failed")
        if on_done:
            try:
                await on_done(explicit)
            except Exception:
                log.exception("background nsfw classify on_done failed")

    task = asyncio.create_task(_run())
    _bg_classify_tasks.add(task)
    task.add_done_callback(_bg_classify_tasks.discard)
    return task
