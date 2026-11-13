"""Which converter an upload goes to (C19.2c): .md, a .zip holding Markdown, or a Jupyter .ipynb.

A .zip is unpacked in memory within `policy` limits (entries and unpacked
bytes, checked from the archive's directory and again while reading). Its
Markdown file is the shallowest one, a README.md or index.md first at that
depth; two candidates at the same depth are refused rather than guessed.
Image paths resolve against that file's folder and never leave the upload.
Every refusal is a ValueError whose message is shown to the reader.
"""

import io
import posixpath
import zipfile

from backend.agents import policy
from backend.convert.assets import Converted
from backend.convert.markdown import convert_markdown
from backend.convert.notebook import convert_notebook

FORMATS = {"md": "md", "markdown": "md", "zip": "md", "ipynb": "ipynb"}
PREFERRED = ("readme.md", "index.md")


def _text(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ValueError("This Markdown file is not UTF-8 text.") from e


def _unpack(data: bytes) -> dict[str, bytes]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        infos = [i for i in archive.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
    except zipfile.BadZipFile as e:
        raise ValueError("This is not a readable .zip file.") from e
    if len(infos) > policy.MAX_CONVERT_ZIP_ENTRIES or sum(i.file_size for i in infos) > policy.MAX_CONVERT_UNPACKED_BYTES:
        raise ValueError("This .zip is too large once unpacked.")
    files, total = {}, 0
    for info in infos:
        name = posixpath.normpath(info.filename.replace("\\", "/"))
        if name.startswith(("../", "/")) or name == "..":
            continue  # a path out of the archive is never used
        with archive.open(info) as member:
            body = member.read(policy.MAX_CONVERT_UNPACKED_BYTES - total + 1)
        total += len(body)
        if total > policy.MAX_CONVERT_UNPACKED_BYTES:  # the directory lied about sizes
            raise ValueError("This .zip is too large once unpacked.")
        files[name] = body
    return files


def _markdown_in(files: dict[str, bytes]) -> str:
    found = [n for n in files if n.lower().endswith((".md", ".markdown"))]
    if not found:
        raise ValueError("This .zip has no Markdown (.md) file in it.")
    depth = min(n.count("/") for n in found)
    shallow = sorted(n for n in found if n.count("/") == depth)
    preferred = [n for n in shallow if posixpath.basename(n).lower() in PREFERRED]
    if len(preferred) == 1 or len(shallow) == 1:
        return (preferred or shallow)[0]
    raise ValueError("This .zip has more than one Markdown file at its top level; keep one (or name it README.md).")


def convert_upload(filename: str, data: bytes) -> tuple[str, Converted]:
    """(source_format, chapters and images) for an uploaded source; ValueError with a reason when it cannot convert."""
    stem, _, ext = filename.rpartition(".")
    ext = ext.lower()
    name = posixpath.basename(stem.replace("\\", "/")) or "Untitled"
    if ext not in FORMATS:
        raise ValueError(f"A .{ext} file cannot be converted.")
    if ext == "ipynb":
        return "ipynb", convert_notebook(data, name)
    if ext == "zip":
        files = _unpack(data)
        main = _markdown_in(files)
        return "md", convert_markdown(_text(files.pop(main)), posixpath.splitext(posixpath.basename(main))[0],
                                      files, posixpath.dirname(main))
    return "md", convert_markdown(_text(data), name)
