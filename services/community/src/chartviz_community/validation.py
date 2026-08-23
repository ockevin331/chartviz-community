from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Literal

from PIL import Image, UnidentifiedImageError


class ImageValidationError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedImage:
    data: bytes
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]
    width: int
    height: int


_MIME_TYPES: dict[str, Literal["image/png", "image/jpeg", "image/webp"]] = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}


def validate_image(
    data: bytes,
    *,
    max_bytes: int,
    max_pixels: int,
) -> ValidatedImage:
    if not data:
        raise ImageValidationError("The image is empty.")
    if len(data) > max_bytes:
        raise ImageValidationError("The image exceeds the upload size limit.")

    try:
        with Image.open(BytesIO(data)) as candidate:
            image_format = candidate.format
            candidate.verify()
        with Image.open(BytesIO(data)) as decoded:
            width, height = decoded.size
    except (OSError, SyntaxError, UnidentifiedImageError) as exc:
        raise ImageValidationError("The uploaded file is not a readable image.") from exc

    mime_type = _MIME_TYPES.get(str(image_format).upper())
    if mime_type is None:
        raise ImageValidationError("Only PNG, JPEG, and WebP images are supported.")
    if width < 320 or height < 240:
        raise ImageValidationError("The image must be at least 320x240 pixels.")
    if width * height > max_pixels:
        raise ImageValidationError("The decoded image exceeds the pixel limit.")

    return ValidatedImage(
        data=data,
        mime_type=mime_type,
        width=width,
        height=height,
    )
