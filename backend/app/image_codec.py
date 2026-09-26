from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener()

HEIC_CONTENT_TYPES = {"image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"}
HEIC_SUFFIXES = {".heic", ".heif"}
MAX_DECODED_PIXELS = 50_000_000


class ImageConversionError(ValueError):
    pass


def is_heic(filename: str | None, content_type: str | None) -> bool:
    suffix = Path(filename or "").suffix.lower()
    return suffix in HEIC_SUFFIXES or (content_type or "").lower() in HEIC_CONTENT_TYPES


def heic_to_jpeg(data: bytes) -> bytes:
    try:
        with Image.open(BytesIO(data)) as source:
            source.load()
            if source.width * source.height > MAX_DECODED_PIXELS:
                raise ImageConversionError("HEIC image dimensions are too large.")
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
            output = BytesIO()
            image.save(output, format="JPEG", quality=88, optimize=True)
            return output.getvalue()
    except ImageConversionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageConversionError("The HEIC/HEIF file could not be decoded.") from exc
