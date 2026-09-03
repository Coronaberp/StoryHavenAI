"""Fail-closed policy evaluation for classifier probabilities."""

from __future__ import annotations

import math
from collections.abc import Mapping

from backend.safety.config import CLASS_NAMES, SAFE_CLASS_NAMES
from backend.safety.contracts import SafetyResult


_PROBABILITY_TOLERANCE: float = 1e-6


def _classifier_error() -> SafetyResult:
    return SafetyResult(
        safe=False,
        reason="blocked_classifier_error",
        safe_confidence=0.0,
        predicted_class="unknown",
    )


def result_from_probabilities(
    probabilities: Mapping[str, float],
    threshold: float,
) -> SafetyResult:
    """Allow only an explicitly safe class whose probability reaches threshold."""

    if not math.isfinite(threshold) or not 0.0 <= threshold <= 1.0:
        return _classifier_error()
    if set(probabilities) != set(CLASS_NAMES):
        return _classifier_error()

    try:
        values = {name: float(probabilities[name]) for name in CLASS_NAMES}
    except (TypeError, ValueError):
        return _classifier_error()
    if any(not math.isfinite(value) or value < 0.0 for value in values.values()):
        return _classifier_error()
    total = sum(values.values())
    if not math.isfinite(total) or total <= 0.0 or abs(total - 1.0) > _PROBABILITY_TOLERANCE:
        return _classifier_error()

    predicted_class = max(CLASS_NAMES, key=values.__getitem__)
    safe_confidence = max(values["safe"], values["drawing"])
    if predicted_class in SAFE_CLASS_NAMES and safe_confidence >= threshold:
        reason = "allowed"
        safe = True
    elif predicted_class in SAFE_CLASS_NAMES:
        reason = "blocked_uncertain"
        safe = False
    else:
        reason = "blocked_nsfw"
        safe = False
    return SafetyResult(
        safe=safe,
        reason=reason,
        safe_confidence=safe_confidence,
        predicted_class=predicted_class,
        probabilities=values,
    )
