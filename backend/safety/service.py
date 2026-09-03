"""Persistent, single-worker ONNX Runtime image safety classification."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np

from backend.safety.observability import current_correlation_ids, log_event, safe_exception
from backend.safety.config import (
    BYTES_PER_MEGABYTE,
    CLASSIFIER_BACKEND,
    CLASS_NAMES,
    CPU_PROVIDER,
    INFERENCE_TIMEOUT_SECONDS,
    INTER_OP_THREADS,
    MAX_PENDING_REQUESTS,
    MODEL_HASH_CHUNK_BYTES,
    MODEL_ID,
    MODEL_INPUT_SHAPE,
    MODEL_OUTPUT_SHAPE,
    MODEL_REVISION,
    ONNX_PATH,
    ONNX_SHA256,
    QUEUE_TIMEOUT_SECONDS,
    RUNTIME_THREADS,
    SAFE_THRESHOLD,
)
from backend.safety.contracts import SafetyResult
from backend.safety.metrics import SafetyMetrics
from backend.safety.policy import result_from_probabilities
from backend.safety.preprocess import PreprocessedImage, SafetyPreprocessError, preprocess_image
from backend.state import log


class SafetyClassifierConfigurationError(RuntimeError):
    """Identify an unavailable or unpinned classifier artifact."""


class SafetyClassifierOutputError(RuntimeError):
    """Identify an invalid model input or output tensor."""


@dataclass(frozen=True, slots=True)
class SafetySessionOptions:
    """Describe the constrained runtime options passed to an injected factory."""

    intra_op_num_threads: int
    inter_op_num_threads: int
    execution_mode: str = "ORT_SEQUENTIAL"
    graph_optimization_level: str = "ORT_ENABLE_ALL"


@dataclass(slots=True)
class _QueuedRequest:
    image_bytes: bytes
    submitted_at: float
    request_id: str | None
    started_future: asyncio.Future[None]
    future: asyncio.Future[SafetyResult]
    timed_out: bool = False


def _error_result(reason: str, queue_ms: float = 0.0) -> SafetyResult:
    return SafetyResult(
        safe=False,
        reason=reason,
        safe_confidence=0.0,
        predicted_class="unknown",
        queue_ms=max(0.0, queue_ms),
    )


class OnnxSafetyClassifier:
    """Own one CPU ONNX session and serialize all model work through one queue."""

    def __init__(
        self,
        *,
        model_path: Path = ONNX_PATH,
        expected_sha256: str = ONNX_SHA256,
        safe_threshold: float = SAFE_THRESHOLD,
        max_pending_requests: int = MAX_PENDING_REQUESTS,
        inference_timeout_seconds: float = INFERENCE_TIMEOUT_SECONDS,
        queue_timeout_seconds: float = QUEUE_TIMEOUT_SECONDS,
        runtime_threads: int = RUNTIME_THREADS,
        inter_op_threads: int = INTER_OP_THREADS,
        preprocess_fn: Callable[[bytes], PreprocessedImage] = preprocess_image,
        session: Any | None = None,
        session_factory: Callable[[Path, Any, list[str]], Any] | None = None,
        metrics: SafetyMetrics | None = None,
    ) -> None:
        self.model_path: Path = Path(model_path)
        self.expected_sha256: str = expected_sha256.strip().lower()
        self.safe_threshold: float = safe_threshold
        self.max_pending_requests: int = max(1, max_pending_requests)
        self.inference_timeout_seconds: float = max(0.001, inference_timeout_seconds)
        self.queue_timeout_seconds: float = max(0.001, queue_timeout_seconds)
        self.runtime_threads: int = max(1, runtime_threads)
        self.inter_op_threads: int = max(1, inter_op_threads)
        self.preprocess_fn: Callable[[bytes], PreprocessedImage] = preprocess_fn
        self._session_factory: Callable[[Path, Any, list[str]], Any] | None = session_factory
        self._session: Any | None = None
        self._input_name: str | None = None
        self._queue: asyncio.Queue[_QueuedRequest] | None = None
        self._worker: asyncio.Task[None] | None = None
        self._session_load_lock: asyncio.Lock | None = None
        self._admitted_count: int = 0
        self._status: str = "not_loaded"
        self._load_error: str | None = None
        self._metrics: SafetyMetrics = metrics or SafetyMetrics()
        self._closed: bool = False
        self._inference_lock = threading.Lock()
        self._active_inferences: int = 0
        self._max_active_inferences: int = 0
        if session is not None:
            self._configure_session(session)
            self._status = "ready"

    async def initialize(self) -> bool:
        """Load and validate the pinned model once for application startup."""

        if self._closed:
            return False
        try:
            await self._ensure_session()
            return True
        except Exception:
            return False

    async def close(self) -> None:
        """Stop the worker and fail any queued classifications during shutdown."""

        if self._closed:
            return
        self._closed = True
        queue = self._queue
        if queue is not None:
            while True:
                try:
                    item = queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                result = _error_result("blocked_classifier_error")
                if not item.started_future.done():
                    item.started_future.set_result(None)
                if not item.future.done():
                    item.future.set_result(result)
                if not item.timed_out:
                    self._metrics.record_result(result)
                    self._log_result(item.request_id, result)
                item.image_bytes = b""
                self._admitted_count = max(0, self._admitted_count - 1)
                queue.task_done()
        worker = self._worker
        if worker is not None and not worker.done():
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
        self._worker = None
        self._queue = None
        self._admitted_count = 0
        self._status = "closed"

    async def classify(
        self,
        image_bytes: bytes,
        *,
        request_id: str | None = None,
    ) -> SafetyResult:
        """Classify bytes and return a typed fail-closed decision."""

        submitted_at = asyncio.get_running_loop().time()
        self._metrics.record_submission()
        resolved_request_id = (
            request_id
            or current_correlation_ids().get("request_id")
            or uuid.uuid4().hex
        )
        if self._closed:
            result = _error_result("blocked_classifier_error")
            self._metrics.record_result(result)
            self._log_result(resolved_request_id, result)
            return result
        if self._admitted_count >= self.max_pending_requests:
            result = _error_result(
                "blocked_queue_full",
                (asyncio.get_running_loop().time() - submitted_at) * 1000,
            )
            self._metrics.record_queue_full()
            self._log_result(resolved_request_id, result)
            return result

        self._ensure_worker()
        loop = asyncio.get_running_loop()
        future: asyncio.Future[SafetyResult] = loop.create_future()
        item = _QueuedRequest(
            image_bytes=image_bytes,
            submitted_at=submitted_at,
            request_id=resolved_request_id,
            started_future=loop.create_future(),
            future=future,
        )
        self._admitted_count += 1
        try:
            assert self._queue is not None
            self._queue.put_nowait(item)
        except (AssertionError, asyncio.QueueFull) as exc:
            self._admitted_count -= 1
            result = _error_result(
                "blocked_queue_full",
                (asyncio.get_running_loop().time() - submitted_at) * 1000,
            )
            self._metrics.record_queue_full()
            self._log_result(resolved_request_id, result)
            if isinstance(exc, AssertionError):
                log_event(
                    log,
                    event="safety_classifier_queue_failed",
                    message="Safety classifier queue was unavailable",
                    component="safety.classifier",
                    level=logging.ERROR,
                    fields={"model_id": MODEL_ID, **safe_exception(exc)},
                    request_id=resolved_request_id,
                )
            return result

        try:
            await asyncio.wait_for(
                asyncio.shield(item.started_future),
                timeout=self.queue_timeout_seconds,
            )
            return await asyncio.wait_for(
                asyncio.shield(future),
                timeout=self.inference_timeout_seconds,
            )
        except asyncio.TimeoutError:
            latency_ms = (asyncio.get_running_loop().time() - submitted_at) * 1000
            item.timed_out = True
            if not item.started_future.done():
                result = _error_result("blocked_queue_timeout", latency_ms)
                self._metrics.record_queue_timeout(latency_ms)
            else:
                result = _error_result("blocked_inference_timeout", latency_ms)
                self._metrics.record_timeout(latency_ms)
            self._log_result(resolved_request_id, result)
            return result

    def health_snapshot(self) -> dict[str, object]:
        """Return model identity, loading state, and bounded queue state."""

        with self._inference_lock:
            active_inferences = self._active_inferences
            max_active_inferences = self._max_active_inferences
        return {
            "available": self._status == "ready",
            "status": self._status,
            "backend": CLASSIFIER_BACKEND,
            "runtime": "onnxruntime-cpu",
            "model_id": MODEL_ID,
            "model_revision": MODEL_REVISION,
            "model_path": str(self.model_path),
            "model_sha256": self.expected_sha256 or None,
            "loaded": self._session is not None,
            "input_shape": list(MODEL_INPUT_SHAPE),
            "classes": list(CLASS_NAMES),
            "safe_threshold": self.safe_threshold,
            "queue_depth": self._admitted_count,
            "queue_capacity": self.max_pending_requests,
            "active_inferences": active_inferences,
            "max_active_inferences": max_active_inferences,
            "load_error": self._load_error,
        }

    def metrics_snapshot(self) -> dict[str, object]:
        """Return bounded classifier counters and resource measurements."""

        snapshot = self._metrics.snapshot(self._admitted_count, self.max_pending_requests)
        with self._inference_lock:
            snapshot["active_inferences"] = self._active_inferences
            snapshot["max_active_inferences"] = self._max_active_inferences
        return snapshot

    async def _ensure_session(self) -> None:
        if self._session is not None:
            return
        if self._status == "error":
            raise SafetyClassifierConfigurationError(self._load_error or "model_unavailable")
        if self._session_load_lock is None:
            self._session_load_lock = asyncio.Lock()
        async with self._session_load_lock:
            if self._session is None:
                try:
                    await asyncio.to_thread(self._load_session_sync)
                except Exception as exc:
                    self._mark_load_error(exc)
                    self._log_load_failure(exc)
                    raise

    def _load_session_sync(self) -> None:
        if self._session is not None:
            return
        if self._session_factory is None:
            self._verify_artifact()
            session = self._create_onnx_session()
        else:
            session = self._session_factory(
                self.model_path,
                SafetySessionOptions(self.runtime_threads, self.inter_op_threads),
                [CPU_PROVIDER],
            )
        self._configure_session(session)
        self._status = "ready"
        self._load_error = None

    def _verify_artifact(self) -> None:
        if self.model_path.suffix.lower() != ".onnx":
            raise SafetyClassifierConfigurationError("model_path_must_be_onnx")
        if not self.model_path.is_file():
            raise SafetyClassifierConfigurationError("model_artifact_missing")
        if len(self.expected_sha256) != 64 or any(
            character not in "0123456789abcdef" for character in self.expected_sha256
        ):
            raise SafetyClassifierConfigurationError("model_checksum_missing_or_invalid")
        digest = hashlib.sha256()
        with self.model_path.open("rb") as model_file:
            while chunk := model_file.read(MODEL_HASH_CHUNK_BYTES):
                digest.update(chunk)
        if digest.hexdigest() != self.expected_sha256:
            raise SafetyClassifierConfigurationError("model_checksum_mismatch")

    def _create_onnx_session(self) -> Any:
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise SafetyClassifierConfigurationError("onnxruntime_unavailable") from exc
        options = ort.SessionOptions()
        options.intra_op_num_threads = self.runtime_threads
        options.inter_op_num_threads = self.inter_op_threads
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        return ort.InferenceSession(
            str(self.model_path),
            sess_options=options,
            providers=[CPU_PROVIDER],
        )

    def _configure_session(self, session: Any) -> None:
        inputs = session.get_inputs()
        if len(inputs) != 1:
            raise SafetyClassifierConfigurationError("model_input_count_invalid")
        input_name = getattr(inputs[0], "name", None)
        if not isinstance(input_name, str) or not input_name:
            raise SafetyClassifierConfigurationError("model_input_name_invalid")
        input_shape = getattr(inputs[0], "shape", None)
        if input_shape is not None and list(input_shape) != list(MODEL_INPUT_SHAPE):
            raise SafetyClassifierConfigurationError("model_input_shape_invalid")
        output_getter = getattr(session, "get_outputs", None)
        if callable(output_getter):
            outputs = output_getter()
            if not outputs:
                raise SafetyClassifierConfigurationError("model_output_count_invalid")
            output_shape = getattr(outputs[0], "shape", None)
            if output_shape is not None and list(output_shape) != list(MODEL_OUTPUT_SHAPE):
                raise SafetyClassifierConfigurationError("model_output_shape_invalid")
        self._session = session
        self._input_name = input_name

    def _ensure_worker(self) -> None:
        if self._worker is not None and not self._worker.done():
            return
        self._queue = asyncio.Queue(maxsize=self.max_pending_requests)
        self._worker = asyncio.create_task(self._worker_loop())

    async def _worker_loop(self) -> None:
        assert self._queue is not None
        while True:
            item = await self._queue.get()
            try:
                if not item.started_future.done():
                    item.started_future.set_result(None)
                result = await self._process(item)
                if not item.future.done():
                    item.future.set_result(result)
            except asyncio.CancelledError:
                if not item.started_future.done():
                    item.started_future.set_result(None)
                result = _error_result("blocked_classifier_error")
                if not item.future.done():
                    item.future.set_result(result)
                    if not item.timed_out:
                        self._metrics.record_result(result)
                        self._log_result(item.request_id, result)
                raise
            except Exception as exc:
                result = _error_result("blocked_classifier_error")
                if not item.timed_out:
                    self._metrics.record_result(result)
                    self._log_result(item.request_id, result, exc)
                if not item.future.done():
                    item.future.set_result(result)
            finally:
                item.image_bytes = b""
                self._admitted_count = max(0, self._admitted_count - 1)
                self._queue.task_done()

    async def _process(self, item: _QueuedRequest) -> SafetyResult:
        queue_ms = (asyncio.get_running_loop().time() - item.submitted_at) * 1000
        preprocessed: PreprocessedImage | None = None
        processing_error: BaseException | None = None
        payload = item.image_bytes
        item.image_bytes = b""
        try:
            try:
                preprocessed = await asyncio.to_thread(self.preprocess_fn, payload)
            finally:
                del payload
            if not isinstance(preprocessed, PreprocessedImage):
                raise SafetyClassifierOutputError("preprocess_result_invalid")
            self._validate_input(preprocessed.tensor)
            await self._ensure_session()
            inference_started = asyncio.get_running_loop().time()
            output = await asyncio.to_thread(self._run_session, preprocessed.tensor)
            inference_ms = (asyncio.get_running_loop().time() - inference_started) * 1000
            probabilities = self._probabilities_from_logits(output)
            result = result_from_probabilities(probabilities, self.safe_threshold)
            result = replace(
                result,
                queue_ms=queue_ms,
                inference_ms=inference_ms,
                image_width=preprocessed.image_width,
                image_height=preprocessed.image_height,
            )
        except SafetyPreprocessError as exc:
            result = _error_result(f"blocked_{exc.reason}", queue_ms)
        except SafetyClassifierConfigurationError as exc:
            result = _error_result("blocked_classifier_error", queue_ms)
            processing_error = exc
        except (SafetyClassifierOutputError, MemoryError, OSError, ValueError, TypeError) as exc:
            result = _error_result("blocked_classifier_error", queue_ms)
            processing_error = exc
        except Exception as exc:
            result = _error_result("blocked_classifier_error", queue_ms)
            processing_error = exc
        finally:
            del preprocessed
        if not item.timed_out:
            self._metrics.record_result(result)
            self._log_result(item.request_id, result, processing_error)
        return result

    def _validate_input(self, tensor: np.ndarray) -> None:
        if tensor.shape != MODEL_INPUT_SHAPE or tensor.dtype != np.float32:
            raise SafetyClassifierOutputError("model_input_shape_or_dtype_invalid")
        if not np.isfinite(tensor).all():
            raise SafetyClassifierOutputError("model_input_non_finite")

    def _run_session(self, tensor: np.ndarray) -> Any:
        with self._inference_lock:
            self._active_inferences += 1
            self._max_active_inferences = max(
                self._max_active_inferences,
                self._active_inferences,
            )
        try:
            if self._session is None or self._input_name is None:
                raise SafetyClassifierConfigurationError("model_session_unavailable")
            return self._session.run(None, {self._input_name: tensor})
        finally:
            with self._inference_lock:
                self._active_inferences = max(0, self._active_inferences - 1)

    def _probabilities_from_logits(self, outputs: Any) -> dict[str, float]:
        if not isinstance(outputs, (list, tuple)) or not outputs:
            raise SafetyClassifierOutputError("model_output_missing")
        logits = np.asarray(outputs[0], dtype=np.float32)
        if logits.size != len(CLASS_NAMES):
            raise SafetyClassifierOutputError("model_output_shape_invalid")
        flat_logits = logits.reshape(-1)
        if not np.isfinite(flat_logits).all():
            raise SafetyClassifierOutputError("model_output_non_finite")
        maximum = np.max(flat_logits)
        exponentials = np.exp(flat_logits - maximum)
        total = float(np.sum(exponentials))
        if not math.isfinite(total) or total <= 0.0:
            raise SafetyClassifierOutputError("model_output_normalization_invalid")
        return {
            name: float(value / total)
            for name, value in zip(CLASS_NAMES, exponentials, strict=True)
        }

    def _mark_load_error(self, error: BaseException) -> None:
        self._status = "error"
        self._load_error = f"{type(error).__name__}: {error}"

    def _log_load_failure(self, error: BaseException) -> None:
        log_event(
            log,
            event="safety_classifier_load_failed",
            message="Safety classifier model load failed",
            component="safety.classifier",
            level=logging.ERROR,
            fields={"model_id": MODEL_ID, "model_revision": MODEL_REVISION, **safe_exception(error)},
        )

    def _log_result(
        self,
        request_id: str | None,
        result: SafetyResult,
        error: BaseException | None = None,
    ) -> None:
        fields: dict[str, object] = {
            "model_id": MODEL_ID,
            "model_revision": MODEL_REVISION,
            "classifier_version": MODEL_REVISION,
            "runtime": "onnxruntime-cpu",
            "threshold": self.safe_threshold,
            "classes": list(CLASS_NAMES),
            "probabilities": result.probabilities,
            "predicted_class": result.predicted_class,
            "safe_confidence": result.safe_confidence,
            "decision": "allow" if result.safe else "block",
            "reason": result.reason,
            "queue_ms": round(result.queue_ms, 3),
            "inference_ms": round(result.inference_ms, 3),
            "image_width": result.image_width,
            "image_height": result.image_height,
        }
        for class_name in CLASS_NAMES:
            fields[f"{class_name}_confidence"] = result.probabilities.get(class_name)
        fields.update(self._metrics.resource_snapshot())
        rss_bytes = fields.get("rss_bytes")
        available_bytes = fields.get("system_available_memory_bytes")
        fields["rss_mb"] = (
            round(rss_bytes / BYTES_PER_MEGABYTE, 3)
            if isinstance(rss_bytes, int)
            else None
        )
        fields["available_memory_mb"] = (
            round(available_bytes / BYTES_PER_MEGABYTE, 3)
            if isinstance(available_bytes, int)
            else None
        )
        if error is not None:
            fields.update(safe_exception(error))
        log_event(
            log,
            event="safety_classifier_decision",
            message="Safety classifier decision",
            component="safety.classifier",
            level=logging.WARNING if not result.safe else logging.INFO,
            fields=fields,
            request_id=request_id,
        )
