"""Image sizes from header bytes (C19.1), so every packaged <img> gets width and height."""

import struct

import pytest

from backend.convert.image_size import SVG_DEFAULT, image_size
from backend.tests.test_epub_builder import png

JPEG = (b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x00" * 9
        + b"\xff\xc0" + struct.pack(">HBHH", 17, 8, 480, 640) + b"\x03" + b"\x00" * 9 + b"\xff\xd9")
GIF = b"GIF89a" + struct.pack("<HH", 33, 21) + b"\x00" * 10
WEBP_LOSSY = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 10 + struct.pack("<HH", 200, 100) + b"\x00" * 4
WEBP_X = b"RIFF\x00\x00\x00\x00WEBPVP8X" + b"\x00" * 8 + (199).to_bytes(3, "little") + (99).to_bytes(3, "little")


@pytest.mark.parametrize("data, media_type, size", [
    (png(7, 5), "image/png", (7, 5)),
    (JPEG, "image/jpeg", (640, 480)),
    (GIF, "image/gif", (33, 21)),
    (WEBP_LOSSY, "image/webp", (200, 100)),
    (WEBP_X, "image/webp", (200, 100)),
    (b'<svg xmlns="http://www.w3.org/2000/svg" width="40px" height="10"/>', "image/svg+xml", (40, 10)),
    (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,12.4,8"/>', "image/svg+xml", (12, 8)),
    (b'<svg xmlns="http://www.w3.org/2000/svg" width="50%"/>', "image/svg+xml", SVG_DEFAULT),
])
def test_sizes_are_read_from_headers(data, media_type, size):
    assert image_size(data, media_type) == size


@pytest.mark.parametrize("data, media_type", [
    (b"\x89PNG", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"not svg", "image/svg+xml"),
    (png(1, 1), "image/tiff"),
])
def test_unreadable_or_unknown_images_give_none(data, media_type):
    assert image_size(data, media_type) is None
