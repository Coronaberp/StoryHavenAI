import json

import pytest

from scripts.benchmark_safety_classifier import (
    CANDIDATE_THRESHOLDS,
    SUPPORTED_CATEGORIES,
    empty_benchmark_result,
    load_dataset_manifest,
    threshold_table,
)


def _probabilities(**overrides):
    probabilities = {
        "safe": 0.0,
        "hentai": 0.0,
        "porn": 0.0,
        "sexy": 0.0,
        "drawing": 0.0,
    }
    probabilities.update(overrides)
    return probabilities


def test_threshold_table_counts_explicit_false_negatives():
    rows = [{
        "category": "explicit",
        "probabilities": _probabilities(safe=0.996, porn=0.004),
    }]

    table = threshold_table(rows, [0.995])

    assert table[0]["nsfw_false_negatives"] == 1
    assert table[0]["nsfw_true_positives"] == 0


def test_threshold_table_counts_safe_and_borderline_decisions():
    rows = [
        {"category": "safe_photo", "probabilities": _probabilities(safe=0.999, porn=0.001)},
        {"category": "safe_drawing", "probabilities": _probabilities(drawing=0.999, porn=0.001)},
        {"category": "borderline", "probabilities": _probabilities(safe=0.996, porn=0.004)},
        {"category": "hentai", "probabilities": _probabilities(hentai=1.0)},
    ]

    table = threshold_table(rows, [0.995])[0]

    assert table["safe_true_positives"] == 2
    assert table["safe_false_positives"] == 1
    assert table["nsfw_true_positives"] == 1
    assert table["nsfw_false_negatives"] == 1
    assert table["borderline_allowed"] == 1
    assert table["borderline_blocked"] == 0


def test_threshold_table_uses_the_exact_candidate_thresholds():
    assert CANDIDATE_THRESHOLDS == (0.980, 0.990, 0.995, 0.997, 0.999)


def test_empty_benchmark_result_contains_resource_and_latency_fields():
    result = empty_benchmark_result()

    assert {
        "rss_before_mb",
        "peak_rss_mb",
        "rss_after_mb",
        "max_active_inferences",
    } <= result["resources"].keys()
    assert {"p50_ms", "p95_ms", "p99_ms", "max_ms"} <= result["warm_inference"].keys()


def test_dataset_manifest_accepts_all_supported_categories(tmp_path):
    image_path = tmp_path / "image.bin"
    image_path.write_bytes(b"placeholder")
    manifest_path = tmp_path / "dataset.json"
    manifest_path.write_text(
        json.dumps({
            "images": [
                {"path": image_path.name, "category": category}
                for category in sorted(SUPPORTED_CATEGORIES)
            ]
        }),
        encoding="utf-8",
    )

    rows = load_dataset_manifest(manifest_path)

    assert len(rows) == len(SUPPORTED_CATEGORIES)
    assert all(row["path"] == image_path for row in rows)


@pytest.mark.parametrize("category", ["unknown", "safe", "explicit_image"])
def test_dataset_manifest_rejects_unknown_categories(tmp_path, category):
    image_path = tmp_path / "image.bin"
    image_path.write_bytes(b"placeholder")
    manifest_path = tmp_path / "dataset.json"
    manifest_path.write_text(
        json.dumps({"images": [{"path": image_path.name, "category": category}]}),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="category"):
        load_dataset_manifest(manifest_path)


def test_dataset_manifest_rejects_paths_outside_manifest_directory(tmp_path):
    outside = tmp_path.parent / "outside.bin"
    outside.write_bytes(b"placeholder")
    manifest_path = tmp_path / "dataset.json"
    manifest_path.write_text(
        json.dumps({"images": [{"path": "../outside.bin", "category": "ood"}]}),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="path"):
        load_dataset_manifest(manifest_path)
