"""In-process metrics for image safety classification."""

from __future__ import annotations

import os
import threading
from collections import deque
from collections.abc import Iterable

from backend.safety.config import CLASS_NAMES, MAX_METRIC_SAMPLES, METRIC_PERCENTILES
from backend.safety.contracts import SafetyResult


_COUNTER_NAMES: tuple[str, ...] = (
    "requests_total",
    "decisions_total",
    "allowed_total",
    "blocked_total",
    "errors_total",
    "timeouts_total",
    "queue_timeouts_total",
    "queue_full_total",
    "preprocess_rejections_total",
)


def _percentile(values: Iterable[float], fraction: float) -> float | None:
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * weight


def _process_rss_bytes() -> int | None:
    try:
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        with open("/proc/self/statm", encoding="utf-8") as stream:
            resident_pages = int(stream.read().split()[1])
        return resident_pages * page_size
    except (IndexError, OSError, ValueError):
        return None


def _system_available_memory_bytes() -> int | None:
    try:
        with open("/proc/meminfo", encoding="utf-8") as stream:
            for line in stream:
                name, separator, value = line.partition(":")
                if name == "MemAvailable" and separator:
                    return int(value.strip().split()[0]) * 1024
    except (IndexError, OSError, ValueError):
        return None
    return None


class SafetyMetrics:
    """Keep bounded counters, latency samples, and score distributions in memory."""

    def __init__(self, max_samples: int = MAX_METRIC_SAMPLES) -> None:
        self._lock = threading.Lock()
        self._counters: dict[str, int] = {name: 0 for name in _COUNTER_NAMES}
        self._latencies_ms: deque[float] = deque(maxlen=max_samples)
        self._scores: deque[float] = deque(maxlen=max_samples)
        self._class_scores: dict[str, deque[float]] = {
            name: deque(maxlen=max_samples) for name in CLASS_NAMES
        }

    def increment(self, counter: str) -> None:
        with self._lock:
            self._counters[counter] = self._counters.get(counter, 0) + 1

    def record_submission(self) -> None:
        self.increment("requests_total")

    def record_queue_full(self) -> None:
        with self._lock:
            self._counters["queue_full_total"] += 1
            self._counters["decisions_total"] += 1
            self._counters["blocked_total"] += 1

    def record_timeout(self, latency_ms: float) -> None:
        with self._lock:
            self._counters["timeouts_total"] += 1
            self._counters["decisions_total"] += 1
            self._counters["blocked_total"] += 1
            self._latencies_ms.append(max(0.0, latency_ms))

    def record_queue_timeout(self, latency_ms: float) -> None:
        with self._lock:
            self._counters["queue_timeouts_total"] += 1
            self._counters["timeouts_total"] += 1
            self._counters["decisions_total"] += 1
            self._counters["blocked_total"] += 1
            self._latencies_ms.append(max(0.0, latency_ms))

    def record_result(self, result: SafetyResult) -> None:
        with self._lock:
            self._counters["decisions_total"] += 1
            if result.safe:
                self._counters["allowed_total"] += 1
            else:
                self._counters["blocked_total"] += 1
            if result.reason == "blocked_classifier_error":
                self._counters["errors_total"] += 1
            if result.reason.startswith("blocked_") and result.reason not in {
                "blocked_nsfw",
                "blocked_uncertain",
                "blocked_classifier_error",
                "blocked_inference_timeout",
                "blocked_queue_full",
            }:
                self._counters["preprocess_rejections_total"] += 1
            self._latencies_ms.append(max(0.0, result.queue_ms + result.inference_ms))
            if 0.0 <= result.safe_confidence <= 1.0:
                self._scores.append(result.safe_confidence)
            for name in CLASS_NAMES:
                score = result.probabilities.get(name)
                if score is not None and 0.0 <= score <= 1.0:
                    self._class_scores[name].append(score)

    def resource_snapshot(self) -> dict[str, int | None]:
        """Return current process RSS and system memory availability."""

        return {
            "rss_bytes": _process_rss_bytes(),
            "system_available_memory_bytes": _system_available_memory_bytes(),
        }

    def snapshot(self, queue_depth: int, queue_capacity: int) -> dict[str, object]:
        with self._lock:
            counters = dict(self._counters)
            latencies = tuple(self._latencies_ms)
            scores = tuple(self._scores)
            class_scores = {
                name: tuple(values) for name, values in self._class_scores.items()
            }
        resources = self.resource_snapshot()
        return {
            "counters": counters,
            "latency_ms": {
                name: _percentile(latencies, fraction)
                for name, fraction in METRIC_PERCENTILES
            },
            "safe_score": {
                name: _percentile(scores, fraction)
                for name, fraction in METRIC_PERCENTILES
            },
            "score_distributions": {
                class_name: {
                    name: _percentile(values, fraction)
                    for name, fraction in METRIC_PERCENTILES
                }
                for class_name, values in class_scores.items()
            },
            "queue_depth": queue_depth,
            "queue_capacity": queue_capacity,
            **resources,
        }
