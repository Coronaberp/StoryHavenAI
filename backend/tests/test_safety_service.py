import asyncio
import hashlib
import threading
import time

import numpy as np
import pytest

from backend.safety.config import MODEL_INPUT_SHAPE
from backend.safety.preprocess import PreprocessedImage, SafetyPreprocessError
from backend.safety.service import OnnxSafetyClassifier


class FakeInput:
    name = "pixel_values"
    shape = MODEL_INPUT_SHAPE


class FakeOutput:
    shape = (1, 5)


class FakeSession:
    def __init__(self, delay_seconds: float = 0.0, logits=None) -> None:
        self.delay_seconds = delay_seconds
        self.logits = np.array(logits or [[12.0, 0.0, 0.0, 0.0, 0.0]], dtype=np.float32)
        self.active = 0
        self.max_active = 0
        self.calls = 0
        self.started = threading.Event()

    def get_inputs(self):
        return [FakeInput()]

    def get_outputs(self):
        return [FakeOutput()]

    def run(self, output_names, inputs):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.calls += 1
        self.started.set()
        try:
            time.sleep(self.delay_seconds)
            return [self.logits]
        finally:
            self.active -= 1


def fake_preprocess(image_bytes: bytes) -> PreprocessedImage:
    return PreprocessedImage(
        tensor=np.zeros(MODEL_INPUT_SHAPE, dtype=np.float32),
        image_width=40,
        image_height=20,
    )


@pytest.mark.asyncio
async def test_classifier_reuses_one_session_and_never_runs_concurrently():
    session = FakeSession(delay_seconds=0.01)
    classifier = OnnxSafetyClassifier(
        session=session,
        preprocess_fn=fake_preprocess,
        max_pending_requests=2,
    )

    results = await asyncio.gather(
        classifier.classify(b"first", request_id="one"),
        classifier.classify(b"second", request_id="two"),
    )

    assert all(result.safe for result in results)
    assert session.calls == 2
    assert session.max_active == 1
    assert classifier.health_snapshot()["loaded"] is True
    assert classifier.metrics_snapshot()["counters"]["requests_total"] == 2


@pytest.mark.asyncio
async def test_full_bounded_queue_fails_closed_without_unbounded_waiters():
    session = FakeSession(delay_seconds=0.05)
    classifier = OnnxSafetyClassifier(
        session=session,
        preprocess_fn=fake_preprocess,
        max_pending_requests=2,
    )

    first = asyncio.create_task(classifier.classify(b"first"))
    await asyncio.sleep(0)
    second = asyncio.create_task(classifier.classify(b"second"))
    await asyncio.sleep(0)
    third = await classifier.classify(b"third")

    assert third.safe is False
    assert third.reason == "blocked_queue_full"
    assert (await first).safe is True
    assert (await second).safe is True


@pytest.mark.asyncio
async def test_inference_timeout_does_not_start_a_concurrent_replacement():
    session = FakeSession(delay_seconds=0.05)
    classifier = OnnxSafetyClassifier(
        session=session,
        preprocess_fn=fake_preprocess,
        max_pending_requests=2,
        inference_timeout_seconds=0.005,
    )

    first = await classifier.classify(b"first")
    second_task = asyncio.create_task(classifier.classify(b"second"))
    await asyncio.sleep(0.005)
    second = await second_task

    assert first.safe is False
    assert first.reason == "blocked_inference_timeout"
    assert second.safe is False
    assert second.reason == "blocked_inference_timeout"
    await asyncio.sleep(0.1)
    assert session.max_active == 1
    assert classifier.metrics_snapshot()["counters"]["timeouts_total"] == 2


@pytest.mark.asyncio
async def test_queued_request_has_a_separate_queue_timeout():
    session = FakeSession(delay_seconds=0.05)
    classifier = OnnxSafetyClassifier(
        session=session,
        preprocess_fn=fake_preprocess,
        max_pending_requests=2,
        queue_timeout_seconds=0.005,
        inference_timeout_seconds=0.5,
    )

    first = asyncio.create_task(classifier.classify(b"first"))
    await asyncio.sleep(0.005)
    second = await classifier.classify(b"second")

    assert second.safe is False
    assert second.reason == "blocked_queue_timeout"
    assert (await first).safe is True
    await asyncio.sleep(0.05)
    assert session.max_active == 1
    assert classifier.metrics_snapshot()["counters"]["queue_timeouts_total"] == 1


@pytest.mark.asyncio
async def test_preprocessing_and_malformed_output_fail_closed():
    def reject_image(image_bytes: bytes) -> PreprocessedImage:
        raise SafetyPreprocessError("image_too_many_pixels")

    rejected = OnnxSafetyClassifier(
        session=FakeSession(),
        preprocess_fn=reject_image,
    )
    result = await rejected.classify(b"bad")
    assert result.safe is False
    assert result.reason == "blocked_image_too_many_pixels"
    assert result.predicted_class == "unknown"

    malformed_session = FakeSession(logits=[[1.0, 2.0, 3.0, 4.0]])
    malformed = OnnxSafetyClassifier(
        session=malformed_session,
        preprocess_fn=fake_preprocess,
    )
    malformed_result = await malformed.classify(b"bad-output")
    assert malformed_result.safe is False
    assert malformed_result.reason == "blocked_classifier_error"


@pytest.mark.asyncio
async def test_model_loading_requires_a_pinned_onnx_checksum(tmp_path):
    model_path = tmp_path / "model.onnx"
    model_path.write_bytes(b"not-a-real-model")
    classifier = OnnxSafetyClassifier(
        model_path=model_path,
        expected_sha256="",
        preprocess_fn=fake_preprocess,
    )

    assert await classifier.initialize() is False
    assert classifier.health_snapshot()["status"] == "error"
    assert classifier.health_snapshot()["load_error"].endswith(
        "model_checksum_missing_or_invalid"
    )
    result = await classifier.classify(b"after-load-failure")
    assert result.safe is False
    assert result.reason == "blocked_classifier_error"


@pytest.mark.asyncio
async def test_model_loading_rejects_checksum_mismatch_and_missing_artifact(tmp_path):
    model_path = tmp_path / "model.onnx"
    model_path.write_bytes(b"model")
    classifier = OnnxSafetyClassifier(
        model_path=model_path,
        expected_sha256=hashlib.sha256(b"different").hexdigest(),
    )
    assert await classifier.initialize() is False
    assert classifier.health_snapshot()["load_error"].endswith("model_checksum_mismatch")

    missing = OnnxSafetyClassifier(
        model_path=tmp_path / "missing.onnx",
        expected_sha256=hashlib.sha256(b"model").hexdigest(),
    )
    assert await missing.initialize() is False
    assert missing.health_snapshot()["load_error"].endswith("model_artifact_missing")


@pytest.mark.asyncio
async def test_lazy_model_loading_is_persistent():
    calls = 0
    factory_args = []

    def session_factory(path, options, providers):
        nonlocal calls
        calls += 1
        factory_args.append((path, options, providers))
        return FakeSession()

    classifier = OnnxSafetyClassifier(
        session_factory=session_factory,
        preprocess_fn=fake_preprocess,
    )

    assert (await classifier.classify(b"first")).safe is True
    assert (await classifier.classify(b"second")).safe is True
    assert calls == 1
    assert factory_args[0][1].intra_op_num_threads == 1
    assert factory_args[0][1].inter_op_num_threads == 1
    assert factory_args[0][2] == ["CPUExecutionProvider"]


@pytest.mark.asyncio
async def test_close_fails_queued_work_and_prevents_new_inference():
    session = FakeSession(delay_seconds=0.05)
    classifier = OnnxSafetyClassifier(
        session=session,
        preprocess_fn=fake_preprocess,
        max_pending_requests=2,
    )

    first = asyncio.create_task(classifier.classify(b"first"))
    assert await asyncio.to_thread(session.started.wait, 1.0)
    second = asyncio.create_task(classifier.classify(b"second"))
    await asyncio.sleep(0)
    await classifier.close()

    assert (await first).safe is False
    assert (await second).safe is False
    assert classifier.health_snapshot()["status"] == "closed"
    assert (await classifier.classify(b"after-close")).reason == "blocked_classifier_error"
    await asyncio.sleep(0.06)
    assert session.max_active == 1


def test_metrics_include_bounded_per_class_score_distributions():
    from backend.safety.contracts import SafetyResult
    from backend.safety.metrics import SafetyMetrics

    metrics = SafetyMetrics(max_samples=2)
    metrics.record_result(SafetyResult(
        safe=True,
        reason="allowed",
        safe_confidence=0.999,
        predicted_class="safe",
        probabilities={
            "safe": 0.999,
            "hentai": 0.0001,
            "porn": 0.0001,
            "sexy": 0.0001,
            "drawing": 0.0007,
        },
    ))

    scores = metrics.snapshot(0, 2)["score_distributions"]

    assert scores["safe"]["p50"] == 0.999
    assert scores["porn"]["p50"] == 0.0001
