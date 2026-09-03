import io

import pytest
from PIL import Image

from backend import classify
from backend.state import CFG


pytestmark = pytest.mark.asyncio


def _png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2, 2), color="white").save(output, format="PNG")
    return output.getvalue()


async def test_legacy_backend_is_only_used_when_explicitly_selected(monkeypatch):
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "legacy")
    monkeypatch.setitem(CFG, "nsfw_classification", True)

    async def fake_legacy(data_url, model, base_url=None, api_key=None):
        calls.append((data_url, model))
        return False, 87, "safe 87"

    monkeypatch.setattr(classify.vision, "classify_image_explicit", fake_legacy)

    result = await classify.classify_image_result(_png_bytes())

    assert result.safe is True
    assert result.reason == "allowed"
    assert result.safe_confidence == 0.87
    assert calls and calls[0][0].startswith("data:image/png;base64,")


async def test_legacy_backend_exceptions_are_blocking_results(monkeypatch):
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "legacy")
    monkeypatch.setitem(CFG, "nsfw_classification", True)

    async def failing_legacy(*args, **kwargs):
        raise RuntimeError("legacy unavailable")

    monkeypatch.setattr(classify.vision, "classify_image_explicit", failing_legacy)

    result = await classify.classify_image_result(_png_bytes())

    assert result.safe is False
    assert result.reason == "blocked_classifier_error"
