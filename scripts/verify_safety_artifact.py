"""Verify a provisioned safety classifier manifest and artifact checksum."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Mapping


_REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY_ROOT))

from backend.safety.config import (
    CLASS_NAMES,
    MODEL_HASH_CHUNK_BYTES,
    MODEL_ID,
    MODEL_INPUT_SHAPE,
    MODEL_OUTPUT_SHAPE,
    MODEL_REVISION,
    PROCESSOR_METADATA,
)


_SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


def _failure(error: str) -> dict[str, object]:
    return {"ok": False, "error": error}


def _model_path_from_manifest(
    manifest: Mapping[str, object],
    manifest_path: Path | None,
) -> Path | None:
    raw_path = manifest.get("model_path") or manifest.get("onnx_file")
    if not isinstance(raw_path, str) or not raw_path:
        return None
    candidate = Path(raw_path)
    if manifest_path is not None and not candidate.is_absolute():
        base = manifest_path.resolve().parent
        resolved = (base / candidate).resolve()
        try:
            resolved.relative_to(base)
        except ValueError:
            return None
        return resolved
    return candidate


def _artifact_sha256(model_path: Path) -> str:
    digest = hashlib.sha256()
    with model_path.open("rb") as model_file:
        while chunk := model_file.read(MODEL_HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def verify_manifest(
    manifest: Mapping[str, object],
    manifest_path: Path | None = None,
) -> dict[str, object]:
    """Validate identity, preprocessing contract, path, and artifact checksum."""

    if manifest.get("model_id") != MODEL_ID:
        return _failure("model_id_mismatch")
    if manifest.get("revision") != MODEL_REVISION:
        return _failure("revision_mismatch")
    if manifest.get("class_names") != list(CLASS_NAMES):
        return _failure("class_names_mismatch")
    if manifest.get("input_shape") != list(MODEL_INPUT_SHAPE):
        return _failure("input_shape_mismatch")
    if manifest.get("output_shape") != list(MODEL_OUTPUT_SHAPE):
        return _failure("output_shape_mismatch")
    if manifest.get("dtype") != "float32":
        return _failure("dtype_mismatch")
    if manifest.get("processor") != PROCESSOR_METADATA:
        return _failure("processor_mismatch")

    expected_sha256 = manifest.get("sha256")
    if not isinstance(expected_sha256, str) or not _SHA256_PATTERN.fullmatch(expected_sha256):
        return _failure("sha256_missing_or_invalid")
    model_path = _model_path_from_manifest(manifest, manifest_path)
    if model_path is None or model_path.suffix.lower() != ".onnx":
        return _failure("model_path_invalid")
    if not model_path.is_file():
        return _failure("model_file_missing")
    try:
        actual_sha256 = _artifact_sha256(model_path)
    except (OSError, ValueError):
        return _failure("model_file_unreadable")
    if actual_sha256.lower() != expected_sha256.lower():
        return _failure("sha256_mismatch")
    return {"ok": True, "error": ""}


def _verify_onnx_graph(model_path: Path) -> str:
    try:
        import onnx
    except ImportError:
        return "onnx_unavailable"
    try:
        model = onnx.load(str(model_path))
        onnx.checker.check_model(model)
    except (OSError, ValueError, RuntimeError) as exc:
        return f"onnx_invalid:{type(exc).__name__}"
    inputs = model.graph.input
    outputs = model.graph.output
    if len(inputs) != 1 or len(outputs) < 1:
        return "onnx_io_count_invalid"
    input_shape = [dimension.dim_value for dimension in inputs[0].type.tensor_type.shape.dim]
    if input_shape != list(MODEL_INPUT_SHAPE):
        return "onnx_input_shape_mismatch"
    output_shape = [dimension.dim_value for dimension in outputs[0].type.tensor_type.shape.dim]
    if output_shape != list(MODEL_OUTPUT_SHAPE):
        return "onnx_output_shape_mismatch"
    return ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        with args.manifest.open(encoding="utf-8") as stream:
            manifest = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps(_failure(f"manifest_unreadable:{type(exc).__name__}")))
        return 1
    result = verify_manifest(manifest, args.manifest)
    if result["ok"]:
        model_path = _model_path_from_manifest(manifest, args.manifest)
        if model_path is None:
            result = _failure("model_path_invalid")
        else:
            graph_error = _verify_onnx_graph(model_path)
            if graph_error:
                result = _failure(graph_error)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
