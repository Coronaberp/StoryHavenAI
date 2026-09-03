import hashlib
from types import SimpleNamespace

import pytest

from backend.safety.config import CLASS_NAMES, MODEL_ID, MODEL_INPUT_SHAPE, MODEL_REVISION, PROCESSOR_METADATA
from scripts.export_safety_classifier import processor_metadata
from scripts.verify_safety_artifact import verify_manifest


def _manifest_for(model_path):
    return {
        "model_id": MODEL_ID,
        "revision": MODEL_REVISION,
        "class_names": list(CLASS_NAMES),
        "input_shape": list(MODEL_INPUT_SHAPE),
        "output_shape": [1, len(CLASS_NAMES)],
        "dtype": "float32",
        "processor": PROCESSOR_METADATA,
        "model_path": str(model_path),
        "sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
    }


def test_verify_manifest_accepts_pinned_artifact(tmp_path):
    model = tmp_path / "model.onnx"
    model.write_bytes(b"artifact")

    result = verify_manifest(_manifest_for(model))

    assert result == {"ok": True, "error": ""}


@pytest.mark.parametrize("field", ["model_id", "revision", "class_names", "sha256"])
def test_verify_manifest_rejects_changed_identity_or_checksum(tmp_path, field):
    model = tmp_path / "model.onnx"
    model.write_bytes(b"artifact")
    manifest = _manifest_for(model)
    manifest[field] = ["porn"] if field == "class_names" else "wrong"

    assert verify_manifest(manifest)["ok"] is False


def test_verify_manifest_rejects_processor_or_shape_changes(tmp_path):
    model = tmp_path / "model.onnx"
    model.write_bytes(b"artifact")
    manifest = _manifest_for(model)
    manifest["processor"] = {**PROCESSOR_METADATA, "resample": 2}
    assert verify_manifest(manifest)["ok"] is False

    manifest = _manifest_for(model)
    manifest["input_shape"] = [1, 3, 299, 299]
    assert verify_manifest(manifest)["ok"] is False


def test_verify_manifest_rejects_missing_checksum_or_model(tmp_path):
    model = tmp_path / "model.onnx"
    model.write_bytes(b"artifact")
    manifest = _manifest_for(model)
    del manifest["sha256"]
    assert verify_manifest(manifest)["ok"] is False

    manifest = _manifest_for(model)
    manifest["model_path"] = str(tmp_path / "missing.onnx")
    assert verify_manifest(manifest)["ok"] is False


def test_export_processor_metadata_matches_the_runtime_contract():
    processor = SimpleNamespace(
        do_resize=True,
        size={"height": 224, "width": 224},
        do_center_crop=False,
        crop_size={"height": 289, "width": 289},
        include_top=True,
        do_rescale=True,
        rescale_factor=1 / 255,
        do_normalize=True,
        image_mean=[0.485, 0.456, 0.406],
        image_std=[0.47853944, 0.4732864, 0.47434163],
        resample=0,
    )

    assert processor_metadata(processor) == PROCESSOR_METADATA
