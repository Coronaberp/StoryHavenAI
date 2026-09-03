"""Export and validate the pinned safety model as a static FP32 ONNX graph."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import platform
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


_REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY_ROOT))

from backend.safety.config import (
    CLASS_NAMES,
    DEFAULT_SAFE_THRESHOLD,
    MODEL_HASH_CHUNK_BYTES,
    MODEL_ID,
    MODEL_INPUT_SHAPE,
    MODEL_INPUT_SIZE,
    MODEL_OUTPUT_SHAPE,
    MODEL_REVISION,
    ONNX_OPSET_VERSION,
    PROCESSOR_CROP_SIZE,
    PROCESSOR_INCLUDE_TOP,
    PROCESSOR_METADATA,
)
from backend.safety.policy import result_from_probabilities
from backend.safety.preprocess import preprocess_image


_MODEL_SOURCE_FILES: list[str] = [
    "config.json",
    "preprocessor_config.json",
    "model.safetensors",
]
_MODEL_FILENAME: str = "model.onnx"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(MODEL_HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def _size_dict(value: Any) -> dict[str, int]:
    if isinstance(value, dict):
        height = value.get("height")
        width = value.get("width")
    else:
        height = getattr(value, "height", None)
        width = getattr(value, "width", None)
    if height is None or width is None:
        raise ValueError("processor size is not a height/width mapping")
    return {"height": int(height), "width": int(width)}


def processor_metadata(processor: Any) -> dict[str, object]:
    """Extract only the processor fields that are part of the runtime contract."""

    metadata = {
        "do_resize": bool(processor.do_resize),
        "size": _size_dict(processor.size),
        "do_center_crop": bool(getattr(processor, "do_center_crop", False)),
        "crop_size": _size_dict(processor.crop_size),
        "include_top": bool(getattr(processor, "include_top", False)),
        "do_rescale": bool(processor.do_rescale),
        "rescale_factor": float(processor.rescale_factor),
        "do_normalize": bool(processor.do_normalize),
        "image_mean": [float(value) for value in processor.image_mean],
        "image_std": [float(value) for value in processor.image_std],
        "resample": int(processor.resample),
    }
    if metadata != PROCESSOR_METADATA or metadata["include_top"] != PROCESSOR_INCLUDE_TOP:
        raise ValueError(f"processor metadata mismatch: {metadata!r}")
    return metadata


def _validate_class_map(model: Any) -> None:
    raw_map = getattr(model.config, "id2label", {})
    try:
        class_map = {int(index): str(label).strip().lower() for index, label in raw_map.items()}
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError("model class map is malformed") from exc
    expected = {index: label for index, label in enumerate(CLASS_NAMES)}
    if class_map != expected:
        raise ValueError(f"model class map mismatch: {class_map!r}")


def _image_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _validate_graph(model: Any) -> None:
    import onnx

    onnx.checker.check_model(model)
    if len(model.graph.input) != 1 or len(model.graph.output) < 1:
        raise ValueError("exported graph has an invalid input/output count")
    input_shape = [dimension.dim_value for dimension in model.graph.input[0].type.tensor_type.shape.dim]
    output_shape = [dimension.dim_value for dimension in model.graph.output[0].type.tensor_type.shape.dim]
    if input_shape != list(MODEL_INPUT_SHAPE):
        raise ValueError(f"exported input shape mismatch: {input_shape!r}")
    if output_shape != list(MODEL_OUTPUT_SHAPE):
        raise ValueError(f"exported output shape mismatch: {output_shape!r}")


def _fix_static_output_shape(model: Any) -> None:
    output_dimensions = model.graph.output[0].type.tensor_type.shape.dim
    output_dimensions[0].dim_value = MODEL_OUTPUT_SHAPE[0]
    output_dimensions[0].ClearField("dim_param")


def _softmax(logits: np.ndarray) -> np.ndarray:
    values = np.asarray(logits, dtype=np.float32).reshape(-1)
    shifted = values - np.max(values)
    exponentials = np.exp(shifted)
    return exponentials / np.sum(exponentials)


def _probabilities(logits: np.ndarray) -> dict[str, float]:
    values = _softmax(logits)
    return {
        name: float(value)
        for name, value in zip(CLASS_NAMES, values, strict=True)
    }


def _validation_paths(manifest_path: Path) -> list[Path]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"validation manifest unreadable: {type(exc).__name__}") from exc
    if not isinstance(manifest, dict) or not isinstance(manifest.get("images"), list):
        raise ValueError("validation manifest images must be a list")
    base = manifest_path.resolve().parent
    paths: list[Path] = []
    for index, row in enumerate(manifest["images"]):
        if not isinstance(row, dict) or not isinstance(row.get("path"), str):
            raise ValueError(f"validation row {index} path is invalid")
        candidate = Path(row["path"])
        if candidate.is_absolute():
            raise ValueError(f"validation row {index} path must be relative")
        resolved = (base / candidate).resolve()
        try:
            resolved.relative_to(base)
        except ValueError as exc:
            raise ValueError(f"validation row {index} path escapes manifest directory") from exc
        if not resolved.is_file():
            raise ValueError(f"validation row {index} image is missing")
        paths.append(resolved)
    if not paths:
        raise ValueError("validation manifest contains no images")
    return paths


def validate_reference_parity(
    validation_manifest: Path,
    processor: Any,
    wrapper: Any,
    session: Any,
    torch: Any,
) -> None:
    """Compare preprocessing, probabilities, labels, and policy decisions on a dataset."""

    for image_path in _validation_paths(validation_manifest):
        image_bytes = image_path.read_bytes()
        prepared = preprocess_image(image_bytes)
        with Image.open(io.BytesIO(image_bytes)) as image:
            processor_output = processor(images=image, return_tensors="np")["pixel_values"]
        np.testing.assert_allclose(prepared.tensor, processor_output, rtol=0.0, atol=1e-6)
        pixel_values = torch.from_numpy(prepared.tensor)
        with torch.no_grad():
            reference_logits = wrapper(pixel_values).detach().cpu().numpy()
        onnx_logits = session.run(["logits"], {"pixel_values": prepared.tensor})[0]
        np.testing.assert_allclose(reference_logits, onnx_logits, rtol=1e-3, atol=1e-4)
        reference_result = result_from_probabilities(
            _probabilities(reference_logits),
            DEFAULT_SAFE_THRESHOLD,
        )
        onnx_result = result_from_probabilities(
            _probabilities(onnx_logits),
            DEFAULT_SAFE_THRESHOLD,
        )
        if reference_result.predicted_class != onnx_result.predicted_class:
            raise ValueError(f"validation class mismatch for {image_path.name}")
        if reference_result.safe != onnx_result.safe:
            raise ValueError(f"validation policy mismatch for {image_path.name}")


def export_model(output_dir: Path, validation_manifest: Path | None = None) -> Path:
    """Download the pinned source, export the graph, smoke-test it, and write its manifest."""

    import onnx
    import onnxruntime as ort
    import torch
    from huggingface_hub import snapshot_download
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    output_dir.mkdir(parents=True, exist_ok=True)
    snapshot_dir = Path(
        snapshot_download(
            repo_id=MODEL_ID,
            revision=MODEL_REVISION,
            allow_patterns=_MODEL_SOURCE_FILES,
        )
    )
    processor = AutoImageProcessor.from_pretrained(snapshot_dir)
    model = AutoModelForImageClassification.from_pretrained(snapshot_dir)
    model.eval()
    model.to("cpu")
    metadata = processor_metadata(processor)
    _validate_class_map(model)
    if tuple(metadata["crop_size"].values()) != PROCESSOR_CROP_SIZE:
        raise ValueError("processor crop size mismatch")

    reference_image = Image.new("RGB", (313, 197), (37, 101, 173))
    reference_bytes = _image_bytes(reference_image)
    prepared = preprocess_image(reference_bytes)
    processor_output = processor(images=reference_image, return_tensors="np")["pixel_values"]
    np.testing.assert_allclose(prepared.tensor, processor_output, rtol=0.0, atol=1e-6)
    pixel_values = torch.from_numpy(prepared.tensor)

    class LogitsWrapper(torch.nn.Module):
        def __init__(self, wrapped_model: Any) -> None:
            super().__init__()
            self.wrapped_model = wrapped_model

        def forward(self, pixel_input: Any) -> Any:
            return self.wrapped_model(pixel_values=pixel_input).logits

    wrapper = LogitsWrapper(model)
    wrapper.eval()
    with torch.no_grad():
        reference_logits = wrapper(pixel_values).detach().cpu().numpy()
    output_path = output_dir / _MODEL_FILENAME
    export_kwargs = {
        "input_names": ["pixel_values"],
        "output_names": ["logits"],
        "opset_version": ONNX_OPSET_VERSION,
        "do_constant_folding": True,
        "dynamo": False,
    }
    try:
        torch.onnx.export(wrapper, (pixel_values,), str(output_path), **export_kwargs)
    except TypeError as exc:
        if "dynamo" not in str(exc):
            raise
        export_kwargs.pop("dynamo")
        torch.onnx.export(wrapper, (pixel_values,), str(output_path), **export_kwargs)

    exported_model = onnx.load(str(output_path))
    _fix_static_output_shape(exported_model)
    onnx.save(exported_model, str(output_path))
    _validate_graph(exported_model)
    session = ort.InferenceSession(str(output_path), providers=["CPUExecutionProvider"])
    onnx_logits = session.run(["logits"], {"pixel_values": prepared.tensor})[0]
    np.testing.assert_allclose(reference_logits, onnx_logits, rtol=1e-3, atol=1e-4)
    if validation_manifest is not None:
        validate_reference_parity(validation_manifest, processor, wrapper, session, torch)

    manifest = {
        "model_id": MODEL_ID,
        "revision": MODEL_REVISION,
        "class_names": list(CLASS_NAMES),
        "input_shape": list(MODEL_INPUT_SHAPE),
        "output_shape": list(MODEL_OUTPUT_SHAPE),
        "dtype": "float32",
        "processor": metadata,
        "onnx_file": _MODEL_FILENAME,
        "sha256": _sha256(output_path),
        "opset": ONNX_OPSET_VERSION,
        "tool_versions": {
            "python": platform.python_version(),
            "torch": str(torch.__version__),
            "transformers": str(__import__("transformers").__version__),
            "onnx": str(onnx.__version__),
            "onnxruntime": str(ort.__version__),
        },
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return output_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--validation-manifest", type=Path)
    args = parser.parse_args(argv)
    export_model(args.output_dir, args.validation_manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
