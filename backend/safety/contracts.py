"""Typed values exchanged by the image safety classifier."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class SafetyResult:
    """Describe a classification decision and the diagnostics needed to audit it."""

    safe: bool
    reason: str
    safe_confidence: float
    predicted_class: str
    probabilities: dict[str, float] = field(default_factory=dict)
    queue_ms: float = 0.0
    inference_ms: float = 0.0
    image_width: int | None = None
    image_height: int | None = None
