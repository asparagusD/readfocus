"""Pixel size of a packaged image from its header bytes (C19.1). Standard library only, no decoding."""

import re
import struct
from xml.dom import minidom
from xml.parsers.expat import ExpatError

SVG_DEFAULT = (300, 150)  # a replaced element's default size in CSS, for an SVG that gives none


def _png(data: bytes) -> tuple[int, int] | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
        return struct.unpack(">II", data[16:24])
    return None


def _gif(data: bytes) -> tuple[int, int] | None:
    return struct.unpack("<HH", data[6:10]) if data[:6] in (b"GIF87a", b"GIF89a") else None


def _jpeg(data: bytes) -> tuple[int, int] | None:
    if data[:2] != b"\xff\xd8":
        return None
    at = 2
    while at + 9 < len(data):
        if data[at] != 0xFF:
            at += 1
            continue
        marker = data[at + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
            at += 1 if marker == 0xFF else 2
            continue
        length = struct.unpack(">H", data[at + 2:at + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):  # a start-of-frame segment
            height, width = struct.unpack(">HH", data[at + 5:at + 9])
            return width, height
        at += 2 + length
    return None


def _webp(data: bytes) -> tuple[int, int] | None:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    kind = data[12:16]
    if kind == b"VP8 " and len(data) >= 30:
        width, height = struct.unpack("<HH", data[26:30])
        return width & 0x3FFF, height & 0x3FFF
    if kind == b"VP8L" and len(data) >= 25:
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X" and len(data) >= 30:
        return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
    return None


def _length(value: str) -> float | None:
    found = re.fullmatch(r"\s*([0-9.]+)\s*(px)?\s*", value or "")
    return float(found.group(1)) if found else None


def _svg(data: bytes) -> tuple[int, int] | None:
    try:
        root = minidom.parseString(data).documentElement
    except ExpatError:
        return None
    width, height = _length(root.getAttribute("width")), _length(root.getAttribute("height"))
    if width and height:
        return round(width), round(height)
    box = root.getAttribute("viewBox").replace(",", " ").split()
    if len(box) == 4:
        try:
            box_width, box_height = float(box[2]), float(box[3])
        except ValueError:
            return SVG_DEFAULT
        if box_width > 0 and box_height > 0:
            return round(box_width), round(box_height)
    return SVG_DEFAULT


READERS = {"image/png": _png, "image/gif": _gif, "image/jpeg": _jpeg, "image/webp": _webp, "image/svg+xml": _svg}


def image_size(data: bytes, media_type: str) -> tuple[int, int] | None:
    """(width, height) in pixels, or None when the header cannot be read."""
    reader = READERS.get(media_type)
    try:
        return reader(data) if reader else None
    except (struct.error, IndexError):
        return None
