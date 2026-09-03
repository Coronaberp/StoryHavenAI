import io

import numpy as np
import pytest
from PIL import Image

from backend.safety.config import IMAGE_MEAN, IMAGE_STD, MODEL_INPUT_SHAPE
from backend.safety.preprocess import SafetyPreprocessError, preprocess_image


def image_bytes(
    image: Image.Image,
    image_format: str = "PNG",
    **save_kwargs: object,
) -> bytes:
    output = io.BytesIO()
    image.save(output, format=image_format, **save_kwargs)
    return output.getvalue()


def test_preprocess_matches_processor_shape_and_normalization():
    result = preprocess_image(image_bytes(Image.new("RGB", (16, 8), (255, 0, 128))))

    assert result.tensor.shape == MODEL_INPUT_SHAPE
    assert result.tensor.dtype == np.float32
    assert result.image_width == 16
    assert result.image_height == 8
    np.testing.assert_allclose(
        result.tensor[0, :, 0, 0],
        (np.array([1.0, 0.0, 128.0 / 255.0]) - np.array(IMAGE_MEAN))
        / np.array(IMAGE_STD)
        / np.array(IMAGE_STD),
        rtol=0.0,
        atol=1e-6,
    )


def test_exif_orientation_is_applied_before_dimensions_are_reported():
    source = Image.new("RGB", (4, 8), "white")
    exif = Image.Exif()
    exif[274] = 6
    result = preprocess_image(image_bytes(source, exif=exif))
    assert result.image_width == 8
    assert result.image_height == 4


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (b"", "invalid_image"),
        (b"not-an-image", "invalid_image"),
    ],
)
def test_invalid_bytes_are_rejected(payload, message):
    with pytest.raises(SafetyPreprocessError, match=message):
        preprocess_image(payload)


def test_byte_and_dimension_limits_are_checked_before_decoding_pixels():
    payload = image_bytes(Image.new("RGB", (10, 10)))

    with pytest.raises(SafetyPreprocessError, match="image_too_large"):
        preprocess_image(payload, max_image_bytes=len(payload) - 1)
    with pytest.raises(SafetyPreprocessError, match="image_too_many_pixels"):
        preprocess_image(payload, max_image_pixels=99)
    with pytest.raises(SafetyPreprocessError, match="image_dimension_too_large"):
        preprocess_image(payload, max_image_dimension=9)


def test_animated_images_are_rejected():
    payload = image_bytes(
        Image.new("RGB", (4, 4), "white"),
        image_format="GIF",
        save_all=True,
        append_images=[Image.new("RGB", (4, 4), "black")],
    )

    with pytest.raises(SafetyPreprocessError, match="animated_image"):
        preprocess_image(payload)


def test_unsupported_formats_are_rejected():
    payload = image_bytes(Image.new("RGB", (4, 4)), image_format="BMP")

    with pytest.raises(SafetyPreprocessError, match="unsupported_format"):
        preprocess_image(payload)
