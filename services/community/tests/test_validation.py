from io import BytesIO

import pytest
from PIL import Image

from chartviz_community.validation import ImageValidationError, validate_image


def png(width: int = 640, height: int = 480) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), "black").save(output, "PNG")
    return output.getvalue()


def test_validate_image_reads_real_dimensions() -> None:
    result = validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000)

    assert (result.mime_type, result.width, result.height) == (
        "image/png",
        640,
        480,
    )


@pytest.mark.parametrize("content", [b"", b"not an image"])
def test_validate_image_rejects_invalid_content(content: bytes) -> None:
    with pytest.raises(ImageValidationError):
        validate_image(content, max_bytes=1_000_000, max_pixels=1_000_000)


def test_validate_image_rejects_small_or_excessively_large_images() -> None:
    with pytest.raises(ImageValidationError, match="at least 320x240"):
        validate_image(png(200, 200), max_bytes=1_000_000, max_pixels=1_000_000)

    with pytest.raises(ImageValidationError, match="pixel limit"):
        validate_image(png(1000, 1000), max_bytes=1_000_000, max_pixels=900_000)
