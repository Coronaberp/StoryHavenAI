import base64
import io

import pytest
from PIL import Image

from backend import classify
from backend.safety.contracts import SafetyResult
from backend.state import CFG

pytestmark = pytest.mark.asyncio


def png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (4, 4), color="red").save(output, format="PNG")
    return output.getvalue()


class FakeSafetyClassifier:
    def __init__(self, result: SafetyResult | None = None) -> None:
        self.result = result or SafetyResult(
            safe=True,
            reason="allowed",
            safe_confidence=0.999,
            predicted_class="safe",
        )
        self.calls: list[bytes] = []

    async def classify(self, image_bytes: bytes, *, request_id=None) -> SafetyResult:
        self.calls.append(image_bytes)
        return self.result


async def test_onnx_facade_sends_raw_bytes_to_the_new_classifier(monkeypatch):
    fake = FakeSafetyClassifier()
    monkeypatch.setattr(classify, "safety_classifier", fake)
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setitem(CFG, "nsfw_classification", True)

    explicit, confidence = await classify.classify_image_nsfw(png_bytes(), "image/png")

    assert (explicit, confidence) == (False, 100)
    assert fake.calls == [png_bytes()]


@pytest.mark.parametrize("image", ["https://example.com/image.png", ""])
async def test_invalid_inputs_fail_closed_without_classifier_call(monkeypatch, image):
    fake = FakeSafetyClassifier()
    monkeypatch.setattr(classify, "safety_classifier", fake)
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setitem(CFG, "nsfw_classification", True)

    explicit, confidence = await classify.classify_image_nsfw(image)

    assert (explicit, confidence) == (True, 0)
    assert fake.calls == []


async def test_malformed_raw_bytes_are_sent_to_the_classifier_for_rejection(monkeypatch):
    fake = FakeSafetyClassifier(
        SafetyResult(
            safe=False,
            reason="blocked_invalid_image",
            safe_confidence=0.0,
            predicted_class="unknown",
        )
    )
    monkeypatch.setattr(classify, "safety_classifier", fake)
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setitem(CFG, "nsfw_classification", True)

    explicit, confidence = await classify.classify_image_nsfw(b"not-an-image")

    assert (explicit, confidence) == (True, 0)
    assert fake.calls == [b"not-an-image"]


async def test_classifier_error_is_a_blocking_compatibility_verdict(monkeypatch):
    fake = FakeSafetyClassifier(
        SafetyResult(
            safe=False,
            reason="blocked_classifier_error",
            safe_confidence=0.0,
            predicted_class="unknown",
        )
    )
    monkeypatch.setattr(classify, "safety_classifier", fake)
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setitem(CFG, "nsfw_classification", True)

    explicit, confidence = await classify.classify_image_nsfw(png_bytes(), "image/png")

    assert (explicit, confidence) == (True, 0)


async def test_legacy_is_authoritative_during_shadow_comparison(monkeypatch):
    fake = FakeSafetyClassifier()
    legacy_calls = []
    monkeypatch.setattr(classify, "safety_classifier", fake)
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setattr(classify, "SHADOW_LEGACY", True)
    monkeypatch.setitem(CFG, "nsfw_classification", True)

    async def fake_legacy(data_url, model, base_url=None, api_key=None):
        legacy_calls.append((data_url, model))
        return True, 90, "legacy explicit"

    monkeypatch.setattr(classify.vision, "classify_image_explicit", fake_legacy)

    result = await classify.classify_image_result(png_bytes())

    assert result.safe is False
    assert result.reason == "blocked_nsfw"
    assert legacy_calls and legacy_calls[0][0].startswith("data:image/png;base64,")
    assert legacy_calls[0][1] == classify.VISION_CLASSIFY["model"]


async def test_health_summary_contains_only_non_secret_readiness_fields(monkeypatch):
    monkeypatch.setattr(classify, "safety_health_snapshot", lambda: {
        "available": True,
        "loaded": True,
        "backend": "onnx_nano",
        "model_id": "pinned-model",
        "model_revision": "pinned-revision",
        "model_path": "/private/model.onnx",
        "model_sha256": "private-checksum",
    })

    summary = classify.safety_health_summary()

    assert summary == {
        "backend": "onnx_nano",
        "ready": True,
        "model_id": "pinned-model",
        "model_revision": "pinned-revision",
        "contract_valid": True,
        "error": None,
    }


async def test_legacy_backend_is_explicit_and_only_selected_by_configuration(monkeypatch):
    raw = png_bytes()
    data_url = "data:image/png;base64," + base64.b64encode(raw).decode()
    fake = FakeSafetyClassifier()
    monkeypatch.setattr(classify, "safety_classifier", fake)
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "legacy")
    monkeypatch.setitem(CFG, "nsfw_classification", True)
    calls = []

    async def fake_legacy(image_data_url, model, base_url=None, api_key=None):
        calls.append((image_data_url, model, base_url, api_key))
        return False, 91, "no 91"

    monkeypatch.setattr(classify.vision, "classify_image_explicit", fake_legacy)

    explicit, confidence = await classify.classify_image_nsfw(data_url)

    assert (explicit, confidence) == (False, 91)
    assert calls[0][0] == data_url
    assert fake.calls == []


async def test_legacy_errors_fail_closed(monkeypatch):
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "legacy")
    monkeypatch.setitem(CFG, "nsfw_classification", True)

    async def fake_legacy(*args, **kwargs):
        return False, 0, "<error: unavailable>"

    monkeypatch.setattr(classify.vision, "classify_image_explicit", fake_legacy)

    explicit, confidence = await classify.classify_image_nsfw(png_bytes())

    assert (explicit, confidence) == (True, 0)


async def test_background_classifier_errors_apply_fail_closed_and_finish(monkeypatch):
    fake = FakeSafetyClassifier(
        SafetyResult(
            safe=False,
            reason="blocked_classifier_error",
            safe_confidence=0.0,
            predicted_class="unknown",
        )
    )
    monkeypatch.setattr(classify, "safety_classifier", fake)
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setitem(CFG, "nsfw_classification", True)
    applied = []
    finished = []

    async def apply():
        applied.append(True)

    async def on_done(explicit):
        finished.append(explicit)

    classify.classify_image_background(
        png_bytes(),
        "image/png",
        "user1",
        False,
        apply,
        on_done=on_done,
    )
    await classify._bg_classify_tasks.copy().pop()

    assert applied == [True]
    assert finished == [True]
