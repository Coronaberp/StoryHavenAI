"""Central configuration for the pinned image safety classifier."""

from __future__ import annotations

import os
from pathlib import Path


BYTES_PER_MEGABYTE: int = 1024 * 1024
MODEL_ID: str = "viddexa/nsfw-detection-2-nano"
MODEL_REVISION: str = "12e57200346246b37382f746e4d94d10b014f6a1"
CLASS_NAMES: tuple[str, ...] = ("safe", "hentai", "porn", "sexy", "drawing")
SAFE_CLASS_NAMES: frozenset[str] = frozenset({"safe", "drawing"})
MODEL_INPUT_SHAPE: tuple[int, ...] = (1, 3, 224, 224)
MODEL_OUTPUT_SHAPE: tuple[int, ...] = (1, 5)
MODEL_INPUT_SIZE: tuple[int, int] = (224, 224)
PROCESSOR_RESAMPLE: int = 0
PROCESSOR_CROP_SIZE: tuple[int, int] = (289, 289)
PROCESSOR_CENTER_CROP: bool = False
PROCESSOR_INCLUDE_TOP: bool = True
PROCESSOR_RESCALE_FACTOR: float = 1.0 / 255.0
IMAGE_MEAN: tuple[float, ...] = (0.485, 0.456, 0.406)
IMAGE_STD: tuple[float, ...] = (0.47853944, 0.4732864, 0.47434163)
DEFAULT_SAFE_THRESHOLD: float = 0.995
DEFAULT_ONNX_PATH: Path = Path("./models/nsfw-detection-2-nano/model.onnx")
DEFAULT_ONNX_SHA256: str = "37f93a54c267a4bd663fac8affd63ccb4aec8c85eb3368470238e8fcdb84ced2"
DEFAULT_MAX_IMAGE_BYTES: int = 15 * BYTES_PER_MEGABYTE
DEFAULT_MAX_IMAGE_PIXELS: int = 12 * BYTES_PER_MEGABYTE
DEFAULT_MAX_IMAGE_DIMENSION: int = 4096
DEFAULT_MAX_PENDING_REQUESTS: int = 2
DEFAULT_INFERENCE_TIMEOUT_SECONDS: float = 2.0
DEFAULT_QUEUE_TIMEOUT_SECONDS: float = 2.0
DEFAULT_RUNTIME_THREADS: int = 1
DEFAULT_INTER_OP_THREADS: int = 1
DEFAULT_BACKEND: str = "onnx_nano"
DEFAULT_SHADOW_LEGACY: bool = False
DEFAULT_SHADOW_TIMEOUT_SECONDS: float = 2.0
ONNX_OPSET_VERSION: int = 18
CPU_PROVIDER: str = "CPUExecutionProvider"
CANDIDATE_THRESHOLDS: tuple[float, ...] = (0.980, 0.990, 0.995, 0.997, 0.999)
MAX_METRIC_SAMPLES: int = 5000
MODEL_HASH_CHUNK_BYTES: int = 1024 * 1024
METRIC_PERCENTILES: tuple[tuple[str, float], ...] = (("p50", 0.50), ("p95", 0.95), ("p99", 0.99))
SUPPORTED_IMAGE_FORMATS: frozenset[str] = frozenset({"JPEG", "PNG", "WEBP", "GIF"})

PROCESSOR_METADATA: dict[str, object] = {
    "do_resize": True,
    "size": {"height": MODEL_INPUT_SIZE[0], "width": MODEL_INPUT_SIZE[1]},
    "do_center_crop": PROCESSOR_CENTER_CROP,
    "crop_size": {"height": PROCESSOR_CROP_SIZE[0], "width": PROCESSOR_CROP_SIZE[1]},
    "include_top": PROCESSOR_INCLUDE_TOP,
    "do_rescale": True,
    "rescale_factor": PROCESSOR_RESCALE_FACTOR,
    "do_normalize": True,
    "image_mean": list(IMAGE_MEAN),
    "image_std": list(IMAGE_STD),
    "resample": PROCESSOR_RESAMPLE,
}


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


CLASSIFIER_BACKEND: str = os.environ.get("SAFETY_CLASSIFIER_BACKEND", DEFAULT_BACKEND).strip().lower()
SAFE_THRESHOLD: float = _env_float("NSFW_SAFE_THRESHOLD", DEFAULT_SAFE_THRESHOLD)
ONNX_PATH: Path = Path(os.environ.get("NSFW_ONNX_PATH", str(DEFAULT_ONNX_PATH)))
ONNX_SHA256: str = os.environ.get("NSFW_ONNX_SHA256", DEFAULT_ONNX_SHA256).strip().lower()
MAX_IMAGE_BYTES: int = _env_int("NSFW_MAX_IMAGE_BYTES", DEFAULT_MAX_IMAGE_BYTES)
MAX_IMAGE_PIXELS: int = _env_int("NSFW_MAX_IMAGE_PIXELS", DEFAULT_MAX_IMAGE_PIXELS)
MAX_IMAGE_DIMENSION: int = _env_int("NSFW_MAX_IMAGE_DIMENSION", DEFAULT_MAX_IMAGE_DIMENSION)
MAX_PENDING_REQUESTS: int = _env_int("NSFW_MAX_PENDING_REQUESTS", DEFAULT_MAX_PENDING_REQUESTS)
INFERENCE_TIMEOUT_SECONDS: float = _env_float(
    "NSFW_INFERENCE_TIMEOUT_SECONDS", DEFAULT_INFERENCE_TIMEOUT_SECONDS)
QUEUE_TIMEOUT_SECONDS: float = _env_float(
    "NSFW_QUEUE_TIMEOUT_SECONDS", DEFAULT_QUEUE_TIMEOUT_SECONDS)
RUNTIME_THREADS: int = _env_int("NSFW_RUNTIME_THREADS", DEFAULT_RUNTIME_THREADS)
INTER_OP_THREADS: int = _env_int("NSFW_INTER_OP_THREADS", DEFAULT_INTER_OP_THREADS)
SHADOW_LEGACY: bool = _env_bool("NSFW_SHADOW_LEGACY", DEFAULT_SHADOW_LEGACY)
SHADOW_TIMEOUT_SECONDS: float = _env_float(
    "NSFW_SHADOW_TIMEOUT_SECONDS", DEFAULT_SHADOW_TIMEOUT_SECONDS)
