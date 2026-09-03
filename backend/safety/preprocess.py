"""Bounded image decoding and processor-compatible tensor construction."""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps, UnidentifiedImageError

from backend.safety.config import (
    IMAGE_MEAN,
    IMAGE_STD,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS,
    MODEL_INPUT_SIZE,
    PROCESSOR_INCLUDE_TOP,
    PROCESSOR_RESCALE_FACTOR,
    PROCESSOR_RESAMPLE,
    SUPPORTED_IMAGE_FORMATS,
)


class SafetyPreprocessError(ValueError):
    """Identify an image that cannot be safely passed to the classifier."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason: str = reason


@dataclass(frozen=True, slots=True)
class PreprocessedImage:
    """Hold the bounded model input and dimensions after orientation handling."""

    tensor: NDArray[np.float32]
    image_width: int
    image_height: int


def _validate_dimensions(
    width: int,
    height: int,
    max_image_pixels: int,
    max_image_dimension: int,
) -> None:
    if width <= 0 or height <= 0:
        raise SafetyPreprocessError("invalid_dimensions")
    if width > max_image_dimension or height > max_image_dimension:
        raise SafetyPreprocessError("image_dimension_too_large")
    if width * height > max_image_pixels:
        raise SafetyPreprocessError("image_too_many_pixels")


def _open_image(image_bytes: bytes) -> Image.Image:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            return Image.open(io.BytesIO(image_bytes))
        except (
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            MemoryError,
            OSError,
            SyntaxError,
            UnidentifiedImageError,
            ValueError,
        ) as exc:
            raise SafetyPreprocessError("invalid_image") from exc


def preprocess_image(
    image_bytes: bytes,
    *,
    max_image_bytes: int = MAX_IMAGE_BYTES,
    max_image_pixels: int = MAX_IMAGE_PIXELS,
    max_image_dimension: int = MAX_IMAGE_DIMENSION,
) -> PreprocessedImage:
    """Decode and normalize one image without retaining its source pixels."""

    if not isinstance(image_bytes, bytes):
        raise SafetyPreprocessError("invalid_image_bytes")
    if len(image_bytes) == 0:
        raise SafetyPreprocessError("invalid_image")
    if len(image_bytes) > max_image_bytes:
        raise SafetyPreprocessError("image_too_large")

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        image = _open_image(image_bytes)
        try:
            image_format = image.format
            if image_format not in SUPPORTED_IMAGE_FORMATS:
                raise SafetyPreprocessError("unsupported_format")
            _validate_dimensions(
                image.width,
                image.height,
                max_image_pixels,
                max_image_dimension,
            )
            if getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) > 1:
                raise SafetyPreprocessError("animated_image")

            oriented = ImageOps.exif_transpose(image)
            try:
                _validate_dimensions(
                    oriented.width,
                    oriented.height,
                    max_image_pixels,
                    max_image_dimension,
                )
                with oriented.convert("RGB") as rgb_image:
                    with rgb_image.resize(MODEL_INPUT_SIZE, resample=PROCESSOR_RESAMPLE) as resized:
                        pixels: NDArray[np.float32] = np.asarray(
                            resized,
                            dtype=np.float32,
                        )
                pixels *= np.float32(PROCESSOR_RESCALE_FACTOR)
                pixels -= np.asarray(IMAGE_MEAN, dtype=np.float32)
                pixels /= np.asarray(IMAGE_STD, dtype=np.float32)
                if PROCESSOR_INCLUDE_TOP:
                    pixels /= np.asarray(IMAGE_STD, dtype=np.float32)
                tensor: NDArray[np.float32] = np.ascontiguousarray(
                    np.transpose(pixels, (2, 0, 1))[np.newaxis, ...],
                    dtype=np.float32,
                )
                return PreprocessedImage(
                    tensor=tensor,
                    image_width=oriented.width,
                    image_height=oriented.height,
                )
            finally:
                if oriented is not image:
                    oriented.close()
        except SafetyPreprocessError:
            raise
        except (
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            MemoryError,
            OSError,
            SyntaxError,
            ValueError,
        ) as exc:
            raise SafetyPreprocessError("invalid_image") from exc
        finally:
            image.close()
