"""Small structured-logging helpers used by the safety classifier."""

from __future__ import annotations

import contextvars
import logging
import re
from typing import Any


_REQUEST_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "safety_request_id",
    default=None,
)
_SENSITIVE_KEYS: frozenset[str] = frozenset({
    "api_key",
    "authorization",
    "base64",
    "content",
    "cookie",
    "image_data",
    "messages",
    "password",
    "prompt",
    "request_body",
    "secret",
    "token",
})
_SECRET_PATTERN: re.Pattern[str] = re.compile(
    r"(?i)(api[_-]?key|authorization|password|secret|token)\s*[=:]\s*\S+"
)
_MAX_MESSAGE_LENGTH: int = 500
_MAX_DEPTH: int = 5
_REDACTED: str = "[REDACTED]"


def bind_request_id(value: str) -> contextvars.Token[str | None]:
    """Bind a request identifier to the current async context."""

    return _REQUEST_ID.set(value)


def reset_request_id(token: contextvars.Token[str | None]) -> None:
    """Restore the request identifier that preceded a request context."""

    _REQUEST_ID.reset(token)


def current_correlation_ids() -> dict[str, str]:
    """Return correlation identifiers available to classifier events."""

    request_id = _REQUEST_ID.get()
    return {"request_id": request_id} if request_id else {}


def safe_exception(exc: BaseException) -> dict[str, str]:
    """Return a bounded exception description with secret-like values redacted."""

    message = _SECRET_PATTERN.sub(r"\1=[REDACTED]", str(exc))
    if len(message) > _MAX_MESSAGE_LENGTH:
        message = message[:_MAX_MESSAGE_LENGTH] + "...[truncated]"
    return {
        "exception_type": type(exc).__name__,
        "exception_message": message,
    }


def _normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def _sanitize_value(key: str, value: Any, depth: int) -> Any:
    if depth > _MAX_DEPTH:
        return _REDACTED
    normalized_key = _normalize_key(key)
    if normalized_key in {_normalize_key(item) for item in _SENSITIVE_KEYS}:
        return _REDACTED
    if isinstance(value, dict):
        return {
            str(child_key): _sanitize_value(str(child_key), child_value, depth + 1)
            for child_key, child_value in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_sanitize_value("", item, depth + 1) for item in value[:50]]
    if isinstance(value, str):
        if len(value) > _MAX_MESSAGE_LENGTH:
            return value[:_MAX_MESSAGE_LENGTH] + "...[truncated]"
        return value
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return str(value)[:_MAX_MESSAGE_LENGTH]


def log_event(
    logger: logging.Logger,
    event: str,
    message: str,
    component: str,
    *,
    level: int | None = None,
    fields: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> None:
    """Emit a bounded structured event through the application logger."""

    correlation_id = request_id or current_correlation_ids().get("request_id")
    structured: dict[str, Any] = {
        "component": component,
        "event": event,
    }
    if correlation_id:
        structured["request_id"] = correlation_id
    if fields:
        structured["fields"] = {
            str(key): _sanitize_value(str(key), value, 0)
            for key, value in fields.items()
        }
    logger.log(level if level is not None else logging.INFO, message, extra={"structured": structured})
