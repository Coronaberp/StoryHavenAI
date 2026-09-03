import pytest

from backend.safety.config import CLASS_NAMES
from backend.safety.policy import result_from_probabilities


def test_safe_and_drawing_are_the_only_allow_classes():
    safe = result_from_probabilities(
        {"safe": 0.999, "hentai": 0.0001, "porn": 0.0001, "sexy": 0.0001, "drawing": 0.0007},
        0.995,
    )
    drawing = result_from_probabilities(
        {"safe": 0.0001, "hentai": 0.0001, "porn": 0.0001, "sexy": 0.0001, "drawing": 0.9996},
        0.995,
    )
    assert safe.safe is True
    assert safe.reason == "allowed"
    assert drawing.safe is True
    assert drawing.reason == "allowed"
    assert drawing.predicted_class == "drawing"


def test_below_threshold_and_mixed_scores_fail_closed():
    below = result_from_probabilities(
        {"safe": 0.994, "hentai": 0.001, "porn": 0.001, "sexy": 0.001, "drawing": 0.003},
        0.995,
    )
    mixed = result_from_probabilities(
        {"safe": 0.50, "hentai": 0.0, "porn": 0.0, "sexy": 0.0, "drawing": 0.50},
        0.995,
    )
    assert below.safe is False
    assert below.reason == "blocked_uncertain"
    assert mixed.safe is False
    assert mixed.reason == "blocked_uncertain"


@pytest.mark.parametrize("label", ["hentai", "porn", "sexy"])
def test_non_safe_classes_are_never_allowed(label):
    probabilities = {name: 0.001 for name in CLASS_NAMES}
    probabilities[label] = 0.996
    result = result_from_probabilities(probabilities, 0.995)
    assert result.safe is False
    assert result.reason == "blocked_nsfw"


@pytest.mark.parametrize(
    "probabilities",
    [
        {"safe": 0.5},
        {"safe": "not-a-number", "hentai": 0.0, "porn": 0.0, "sexy": 0.0, "drawing": 1.0},
        {"safe": float("nan"), "hentai": 0.0, "porn": 0.0, "sexy": 0.0, "drawing": 0.0},
        {"safe": 0.5, "hentai": 0.5, "porn": 0.0, "sexy": 0.0},
    ],
)
def test_missing_or_non_finite_probabilities_are_classifier_errors(probabilities):
    result = result_from_probabilities(probabilities, 0.995)
    assert result.safe is False
    assert result.reason == "blocked_classifier_error"
