"""Evaluate safety thresholds and bounded ONNX classifier resources."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections.abc import Iterable, Mapping
from pathlib import Path


_REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY_ROOT))

from backend.safety.config import (
    BYTES_PER_MEGABYTE,
    CANDIDATE_THRESHOLDS,
    CLASS_NAMES,
    DEFAULT_QUEUE_TIMEOUT_SECONDS,
    DEFAULT_INFERENCE_TIMEOUT_SECONDS,
)
from backend.safety.policy import result_from_probabilities
from backend.safety.contracts import SafetyResult
from backend.safety.service import OnnxSafetyClassifier
from scripts.verify_safety_artifact import verify_manifest


SUPPORTED_CATEGORIES: frozenset[str] = frozenset({
    "safe_photo",
    "safe_drawing",
    "borderline",
    "explicit",
    "hentai",
    "ood",
})
SAFE_CATEGORIES: frozenset[str] = frozenset({"safe_photo", "safe_drawing"})
DEFAULT_WARM_REQUESTS: int = 100
DEFAULT_SUSTAINED_SECONDS: float = 180.0
DEFAULT_QUEUE_REQUESTS: int = 8


def _empty_latency() -> dict[str, float | int | None]:
    return {
        "requests": 0,
        "p50_ms": None,
        "p95_ms": None,
        "p99_ms": None,
        "max_ms": None,
        "timeouts": 0,
        "errors": 0,
    }


def empty_benchmark_result() -> dict[str, object]:
    """Return a JSON-shaped result with every operational measurement field."""

    return {
        "threshold_table": [],
        "dataset_evaluation": {"images": 0},
        "cold_start": {
            "ready": False,
            "init_ms": None,
            "rss_before_mb": None,
            "rss_after_mb": None,
            "available_memory_before_mb": None,
            "available_memory_after_mb": None,
        },
        "warm_inference": _empty_latency(),
        "sustained": {"duration_seconds": 0.0, **_empty_latency()},
        "queue_test": {
            "requests": 0,
            "p50_ms": None,
            "p95_ms": None,
            "p99_ms": None,
            "max_ms": None,
            "queue_p50_ms": None,
            "queue_p95_ms": None,
            "queue_p99_ms": None,
            "max_queue_depth": 0,
            "max_active_inferences": 0,
            "timeouts": 0,
            "errors": 0,
        },
        "resources": {
            "rss_before_mb": None,
            "peak_rss_mb": None,
            "rss_after_mb": None,
            "available_memory_before_mb": None,
            "available_memory_after_mb": None,
            "max_active_inferences": 0,
        },
        "score_distributions": {
            class_name: {"p50": None, "p95": None, "p99": None}
            for class_name in CLASS_NAMES
        },
    }


def _percentile(values: Iterable[float], fraction: float) -> float | None:
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * weight


def _latency_summary(latencies: list[float]) -> dict[str, float | int | None]:
    return {
        "requests": len(latencies),
        "p50_ms": _percentile(latencies, 0.50),
        "p95_ms": _percentile(latencies, 0.95),
        "p99_ms": _percentile(latencies, 0.99),
        "max_ms": max(latencies) if latencies else None,
    }


def _resource_mb(value: object) -> float | None:
    if not isinstance(value, int):
        return None
    return round(value / BYTES_PER_MEGABYTE, 3)


def _resource_snapshot(classifier: OnnxSafetyClassifier) -> dict[str, object]:
    snapshot = classifier.metrics_snapshot()
    return {
        "rss_bytes": snapshot.get("rss_bytes"),
        "system_available_memory_bytes": snapshot.get("system_available_memory_bytes"),
        "active_inferences": snapshot.get("active_inferences", 0),
        "max_active_inferences": snapshot.get("max_active_inferences", 0),
        "queue_depth": snapshot.get("queue_depth", 0),
    }


def _update_resources(resources: dict[str, object], snapshot: Mapping[str, object]) -> None:
    rss_bytes = snapshot.get("rss_bytes")
    if isinstance(rss_bytes, int):
        current_peak = resources.get("_peak_rss_bytes")
        if not isinstance(current_peak, int) or rss_bytes > current_peak:
            resources["_peak_rss_bytes"] = rss_bytes
    max_active = snapshot.get("max_active_inferences")
    if isinstance(max_active, int):
        resources["max_active_inferences"] = max(
            int(resources.get("max_active_inferences") or 0),
            max_active,
        )


def _result_error_count(result: SafetyResult) -> tuple[int, int]:
    timeout = int("timeout" in result.reason)
    error = int(result.reason == "blocked_classifier_error")
    return timeout, error


def threshold_table(
    rows: Iterable[Mapping[str, object]],
    thresholds: Iterable[float],
) -> list[dict[str, object]]:
    """Re-evaluate classifier probabilities at each candidate safety threshold."""

    materialized_rows = list(rows)
    output: list[dict[str, object]] = []
    for threshold in thresholds:
        safe_true_positives = 0
        safe_false_positives = 0
        nsfw_true_positives = 0
        nsfw_false_negatives = 0
        borderline_allowed = 0
        borderline_blocked = 0
        for row in materialized_rows:
            category = row.get("category")
            probabilities = row.get("probabilities")
            if not isinstance(category, str) or not isinstance(probabilities, Mapping):
                result = result_from_probabilities({}, float(threshold))
            else:
                result = result_from_probabilities(probabilities, float(threshold))
            if category in SAFE_CATEGORIES:
                if result.safe:
                    safe_true_positives += 1
            else:
                if result.safe:
                    safe_false_positives += 1
                    nsfw_false_negatives += 1
                else:
                    nsfw_true_positives += 1
                if category == "borderline":
                    if result.safe:
                        borderline_allowed += 1
                    else:
                        borderline_blocked += 1
        output.append({
            "threshold": float(threshold),
            "safe_true_positives": safe_true_positives,
            "safe_false_positives": safe_false_positives,
            "nsfw_true_positives": nsfw_true_positives,
            "nsfw_false_negatives": nsfw_false_negatives,
            "borderline_allowed": borderline_allowed,
            "borderline_blocked": borderline_blocked,
        })
    return output


def load_dataset_manifest(manifest_path: Path) -> list[dict[str, object]]:
    """Load and validate relative image paths and required dataset categories."""

    try:
        raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"dataset manifest unreadable: {type(exc).__name__}") from exc
    if not isinstance(raw_manifest, dict) or not isinstance(raw_manifest.get("images"), list):
        raise ValueError("dataset manifest images must be a list")
    base = manifest_path.resolve().parent
    rows: list[dict[str, object]] = []
    for index, raw_row in enumerate(raw_manifest["images"]):
        if not isinstance(raw_row, dict):
            raise ValueError(f"dataset row {index} is not an object")
        raw_path = raw_row.get("path")
        category = raw_row.get("category")
        if not isinstance(raw_path, str) or not raw_path:
            raise ValueError(f"dataset row {index} path is invalid")
        if not isinstance(category, str) or category not in SUPPORTED_CATEGORIES:
            raise ValueError(f"dataset row {index} category is invalid")
        relative_path = Path(raw_path)
        if relative_path.is_absolute():
            raise ValueError(f"dataset row {index} path must be relative")
        resolved_path = (base / relative_path).resolve()
        try:
            resolved_path.relative_to(base)
        except ValueError as exc:
            raise ValueError(f"dataset row {index} path escapes manifest directory") from exc
        if not resolved_path.is_file():
            raise ValueError(f"dataset row {index} path does not exist")
        rows.append({"path": resolved_path, "category": category})
    if not rows:
        raise ValueError("dataset manifest contains no images")
    return rows


async def _classify_file(
    classifier: OnnxSafetyClassifier,
    image_path: Path,
) -> tuple[SafetyResult, float]:
    started = time.perf_counter()
    image_bytes = image_path.read_bytes()
    try:
        result = await classifier.classify(image_bytes)
    finally:
        del image_bytes
    return result, (time.perf_counter() - started) * 1000


async def _evaluate_dataset(
    classifier: OnnxSafetyClassifier,
    dataset_rows: list[dict[str, object]],
    resources: dict[str, object],
) -> tuple[list[dict[str, object]], list[float]]:
    evaluated: list[dict[str, object]] = []
    latencies: list[float] = []
    for row in dataset_rows:
        image_path = row["path"]
        if not isinstance(image_path, Path):
            raise ValueError("dataset row path is invalid after validation")
        result, latency_ms = await _classify_file(classifier, image_path)
        evaluated.append({
            "category": row["category"],
            "probabilities": result.probabilities,
        })
        latencies.append(latency_ms)
        _update_resources(resources, _resource_snapshot(classifier))
    return evaluated, latencies


async def _run_repeated(
    classifier: OnnxSafetyClassifier,
    dataset_rows: list[dict[str, object]],
    request_count: int,
    resources: dict[str, object],
) -> tuple[list[float], list[SafetyResult]]:
    latencies: list[float] = []
    results: list[SafetyResult] = []
    for index in range(request_count):
        image_path = dataset_rows[index % len(dataset_rows)]["path"]
        if not isinstance(image_path, Path):
            raise ValueError("dataset row path is invalid after validation")
        result, latency_ms = await _classify_file(classifier, image_path)
        latencies.append(latency_ms)
        results.append(result)
        _update_resources(resources, _resource_snapshot(classifier))
    return latencies, results


def _add_result_counts(summary: dict[str, object], results: Iterable[SafetyResult]) -> None:
    timeouts = 0
    errors = 0
    for result in results:
        timeout, error = _result_error_count(result)
        timeouts += timeout
        errors += error
    summary["timeouts"] = timeouts
    summary["errors"] = errors


async def _run_queue_test(
    classifier: OnnxSafetyClassifier,
    dataset_rows: list[dict[str, object]],
    request_count: int,
    resources: dict[str, object],
) -> dict[str, object]:
    async def run_one(index: int) -> tuple[SafetyResult, float]:
        image_path = dataset_rows[index % len(dataset_rows)]["path"]
        if not isinstance(image_path, Path):
            raise ValueError("dataset row path is invalid after validation")
        return await _classify_file(classifier, image_path)

    tasks = [asyncio.create_task(run_one(index)) for index in range(request_count)]
    await asyncio.sleep(0)
    max_queue_depth = int(classifier.health_snapshot().get("queue_depth") or 0)
    pairs = await asyncio.gather(*tasks)
    results = [pair[0] for pair in pairs]
    latencies = [pair[1] for pair in pairs]
    queue_latencies = [result.queue_ms for result in results]
    _update_resources(resources, _resource_snapshot(classifier))
    summary = {
        "requests": request_count,
        **_latency_summary(latencies),
        "queue_p50_ms": _percentile(queue_latencies, 0.50),
        "queue_p95_ms": _percentile(queue_latencies, 0.95),
        "queue_p99_ms": _percentile(queue_latencies, 0.99),
        "max_queue_depth": max_queue_depth,
        "max_active_inferences": int(
            classifier.health_snapshot().get("max_active_inferences") or 0
        ),
    }
    _add_result_counts(summary, results)
    return summary


def _score_distributions(rows: Iterable[Mapping[str, object]]) -> dict[str, dict[str, float | None]]:
    scores: dict[str, list[float]] = {name: [] for name in CLASS_NAMES}
    for row in rows:
        probabilities = row.get("probabilities")
        if not isinstance(probabilities, Mapping):
            continue
        for name in CLASS_NAMES:
            score = probabilities.get(name)
            if isinstance(score, (int, float)):
                scores[name].append(float(score))
    return {
        name: {
            "p50": _percentile(values, 0.50),
            "p95": _percentile(values, 0.95),
            "p99": _percentile(values, 0.99),
        }
        for name, values in scores.items()
    }


async def run_benchmark(
    manifest_path: Path,
    dataset_path: Path,
    *,
    warm_requests: int = DEFAULT_WARM_REQUESTS,
    sustained_seconds: float = DEFAULT_SUSTAINED_SECONDS,
    queue_requests: int = DEFAULT_QUEUE_REQUESTS,
) -> dict[str, object]:
    """Run threshold, cold-start, warm, sustained, and queue measurements."""

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, Mapping):
        raise ValueError("artifact manifest must be an object")
    verification = verify_manifest(manifest, manifest_path)
    if not verification["ok"]:
        raise ValueError(f"artifact verification failed: {verification['error']}")
    raw_model_path = manifest.get("onnx_file") or manifest.get("model_path")
    if not isinstance(raw_model_path, str):
        raise ValueError("artifact manifest has no model path")
    model_path = Path(raw_model_path)
    if not model_path.is_absolute():
        model_path = (manifest_path.resolve().parent / model_path).resolve()
    expected_sha256 = manifest.get("sha256")
    if not isinstance(expected_sha256, str):
        raise ValueError("artifact manifest has no checksum")
    dataset_rows = load_dataset_manifest(dataset_path)
    if warm_requests < 0 or queue_requests < 1 or sustained_seconds < 0:
        raise ValueError("benchmark request counts and duration must be non-negative")

    classifier = OnnxSafetyClassifier(
        model_path=model_path,
        expected_sha256=expected_sha256,
        inference_timeout_seconds=DEFAULT_INFERENCE_TIMEOUT_SECONDS,
        queue_timeout_seconds=DEFAULT_QUEUE_TIMEOUT_SECONDS,
    )
    result = empty_benchmark_result()
    result["artifact"] = {
        "model_id": manifest.get("model_id"),
        "revision": manifest.get("revision"),
        "sha256": expected_sha256,
    }
    resources = result["resources"]
    if not isinstance(resources, dict):
        raise ValueError("benchmark resource result is malformed")
    before = _resource_snapshot(classifier)
    _update_resources(resources, before)
    resources["rss_before_mb"] = _resource_mb(before.get("rss_bytes"))
    resources["available_memory_before_mb"] = _resource_mb(
        before.get("system_available_memory_bytes")
    )
    cold_start = result["cold_start"]
    if not isinstance(cold_start, dict):
        raise ValueError("benchmark cold-start result is malformed")
    cold_start["rss_before_mb"] = resources["rss_before_mb"]
    cold_start["available_memory_before_mb"] = resources["available_memory_before_mb"]
    init_started = time.perf_counter()
    try:
        ready = await classifier.initialize()
        cold_start["ready"] = ready
        cold_start["init_ms"] = (time.perf_counter() - init_started) * 1000
        after_init = _resource_snapshot(classifier)
        _update_resources(resources, after_init)
        cold_start["rss_after_mb"] = _resource_mb(after_init.get("rss_bytes"))
        cold_start["available_memory_after_mb"] = _resource_mb(
            after_init.get("system_available_memory_bytes")
        )
        if not ready:
            raise ValueError("classifier failed to initialize")

        evaluated_rows, _evaluation_latencies = await _evaluate_dataset(
            classifier,
            dataset_rows,
            resources,
        )
        result["dataset_evaluation"] = {"images": len(evaluated_rows)}
        result["threshold_table"] = threshold_table(evaluated_rows, CANDIDATE_THRESHOLDS)
        result["score_distributions"] = _score_distributions(evaluated_rows)

        warm_latencies, warm_results = await _run_repeated(
            classifier,
            dataset_rows,
            warm_requests,
            resources,
        )
        warm_summary = _latency_summary(warm_latencies)
        _add_result_counts(warm_summary, warm_results)
        result["warm_inference"] = warm_summary

        sustained_started = time.perf_counter()
        sustained_latencies: list[float] = []
        sustained_results: list[SafetyResult] = []
        while time.perf_counter() - sustained_started < sustained_seconds:
            sustained_index = len(sustained_latencies) % len(dataset_rows)
            image_path = dataset_rows[sustained_index]["path"]
            if not isinstance(image_path, Path):
                raise ValueError("dataset row path is invalid after validation")
            sustained_result, latency_ms = await _classify_file(classifier, image_path)
            sustained_latencies.append(latency_ms)
            sustained_results.append(sustained_result)
            _update_resources(resources, _resource_snapshot(classifier))
        sustained_summary = {
            "duration_seconds": time.perf_counter() - sustained_started,
            **_latency_summary(sustained_latencies),
        }
        _add_result_counts(sustained_summary, sustained_results)
        result["sustained"] = sustained_summary

        result["queue_test"] = await _run_queue_test(
            classifier,
            dataset_rows,
            queue_requests,
            resources,
        )
        resources["max_active_inferences"] = max(
            int(resources.get("max_active_inferences") or 0),
            int(classifier.health_snapshot().get("max_active_inferences") or 0),
        )
        if resources["max_active_inferences"] > 1:
            raise ValueError("classifier exceeded one concurrent inference")
    finally:
        after = _resource_snapshot(classifier)
        _update_resources(resources, after)
        resources["rss_after_mb"] = _resource_mb(after.get("rss_bytes"))
        resources["available_memory_after_mb"] = _resource_mb(
            after.get("system_available_memory_bytes")
        )
        peak_rss = resources.pop("_peak_rss_bytes", None)
        resources["peak_rss_mb"] = _resource_mb(peak_rss)
        await classifier.close()
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--warm-requests", type=int, default=DEFAULT_WARM_REQUESTS)
    parser.add_argument("--sustained-seconds", type=float, default=DEFAULT_SUSTAINED_SECONDS)
    parser.add_argument("--queue-requests", type=int, default=DEFAULT_QUEUE_REQUESTS)
    args = parser.parse_args(argv)
    try:
        result = asyncio.run(run_benchmark(
            args.manifest,
            args.dataset,
            warm_requests=args.warm_requests,
            sustained_seconds=args.sustained_seconds,
            queue_requests=args.queue_requests,
        ))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
