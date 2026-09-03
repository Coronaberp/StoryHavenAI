import pytest

from backend import classify
from backend.routers import health as health_router

pytestmark = pytest.mark.asyncio


class FakeClassifier:
    def __init__(self, available: bool) -> None:
        self.available = available
        self.initialize_calls = 0

    async def initialize(self) -> bool:
        self.initialize_calls += 1
        return self.available

    def health_snapshot(self) -> dict[str, object]:
        return {"available": self.available, "status": "ready" if self.available else "error"}

    def metrics_snapshot(self) -> dict[str, object]:
        return {"counters": {"requests_total": 0}}


async def test_onnx_health_check_uses_local_classifier(monkeypatch):
    classifier = FakeClassifier(available=True)
    monkeypatch.setattr(health_router.classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setattr(health_router.classify, "safety_classifier", classifier)

    ok, latency_ms, error = await health_router._check_image_classify_llm()

    assert ok is True
    assert latency_ms is not None
    assert error == ""
    assert classifier.initialize_calls == 1


async def test_onnx_health_check_reports_model_failure(monkeypatch):
    classifier = FakeClassifier(available=False)
    monkeypatch.setattr(health_router.classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setattr(health_router.classify, "safety_classifier", classifier)

    ok, latency_ms, error = await health_router._check_image_classify_llm()

    assert ok is False
    assert latency_ms is None
    assert error == "error"


async def test_legacy_health_check_is_explicitly_selected(monkeypatch):
    classifier = FakeClassifier(available=False)
    monkeypatch.setattr(health_router.classify, "CLASSIFIER_BACKEND", "legacy")
    monkeypatch.setattr(health_router.classify, "safety_classifier", classifier)
    calls = []

    async def list_models(base_url, api_key):
        calls.append((base_url, api_key))
        return []

    monkeypatch.setattr(health_router.client, "list_models", list_models)

    ok, latency_ms, error = await health_router._check_image_classify_llm()

    assert ok is True
    assert latency_ms is not None
    assert error == ""
    assert calls
    assert classifier.initialize_calls == 0


async def test_admin_safety_classifier_includes_health_and_metrics(monkeypatch):
    health = {"available": True, "status": "ready"}
    metrics = {"counters": {"requests_total": 3}}
    monkeypatch.setattr(classify, "CLASSIFIER_BACKEND", "onnx_nano")
    monkeypatch.setattr(classify.safety_classifier, "health_snapshot", lambda: health)
    monkeypatch.setattr(classify.safety_classifier, "metrics_snapshot", lambda: metrics)

    result = await health_router.admin_safety_classifier(_={"id": "a", "is_admin": True})

    assert result == {"classifier": health, "metrics": metrics}
