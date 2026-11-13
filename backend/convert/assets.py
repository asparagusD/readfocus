"""What converters share (C19.2): the result shape and the images a book packs."""

import hashlib
import posixpath
from dataclasses import dataclass, field

from backend.convert.epub_builder import Chapter, Image

EXTENSIONS = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
              "webp": "image/webp", "svg": "image/svg+xml"}
SUFFIX = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"}


@dataclass
class Converted:
    title: str
    chapters: list[Chapter]
    images: list[Image]
    notes: list[str] = field(default_factory=list)  # told to the reader at upload: images not included


def sniff(data: bytes) -> str | None:
    """The image type from its first bytes, so a mislabelled file is not packed under the wrong type."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    head = data[:512].lstrip().lower()
    if head.startswith((b"<svg", b"<?xml")) and b"<svg" in data[:4096].lower():
        return "image/svg+xml"
    return None


class ImageStore:
    """The images one book packs, named by content hash, so the same picture is stored once."""

    def __init__(self) -> None:
        self.images: list[Image] = []
        self._names: dict[str, str] = {}

    def add(self, data: bytes) -> str | None:
        """The image's `src` inside the book, or None when the bytes are not a supported image."""
        media_type = sniff(data)
        if media_type is None:
            return None
        if media_type == "image/svg+xml":
            from xml.dom import minidom
            from xml.parsers.expat import ExpatError
            try:
                minidom.parseString(data)  # the builder reads its size; a broken SVG is not packed
            except ExpatError:
                return None
        digest = hashlib.sha256(data).hexdigest()
        if digest not in self._names:
            name = f"{digest[:16]}.{SUFFIX[media_type]}"
            self._names[digest] = name
            self.images.append(Image(name, data, media_type))
        return f"images/{self._names[digest]}"


def resolve(base_dir: str, src: str) -> str | None:
    """A relative `src` as a path inside the upload, or None when it leaves the upload."""
    path = posixpath.normpath(posixpath.join(base_dir, src.split("#")[0].split("?")[0]))
    return None if path.startswith(("../", "/")) or path == ".." else path
