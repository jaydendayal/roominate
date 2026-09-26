from io import BytesIO

import pytest
from PIL import Image

from app.image_codec import ImageConversionError, heic_to_jpeg, is_heic


def test_heic_detection_accepts_mime_or_filename() -> None:
    assert is_heic("room.HEIC", "application/octet-stream")
    assert is_heic("upload", "image/heif")
    assert not is_heic("room.jpg", "image/jpeg")


def test_heic_is_converted_to_openai_compatible_jpeg() -> None:
    source = BytesIO()
    Image.new("RGB", (24, 16), (30, 100, 180)).save(source, format="HEIF")
    converted = heic_to_jpeg(source.getvalue())
    with Image.open(BytesIO(converted)) as image:
        assert image.format == "JPEG"
        assert image.size == (24, 16)
        assert image.mode == "RGB"


def test_invalid_heic_fails_with_reviewable_error() -> None:
    with pytest.raises(ImageConversionError, match="could not be decoded"):
        heic_to_jpeg(b"not-an-image")
