"""Note block content (C22.1): an allow-list per kind, checked before a block is stored.

Text is a TipTap JSON document (never HTML): only the nodes, marks and attributes below, nested at most
NOTE_DOC_DEPTH_MAX deep. A drawing is an Excalidraw scene whose images are files in the reader's own folder of
the "notes" bucket (never data URLs). Equation, code and figure blocks have fixed fields. Every block is at most
NOTE_CONTENT_MAX_BYTES as JSON, as migration 027 checks.
"""

import json
import re
from typing import Annotated

from pydantic import Field, TypeAdapter, ValidationError

from backend.agents import policy
from backend.routers.sessions import EpubAnchor, PdfAnchor


class ContentError(ValueError):
    """Content a block of that kind may not hold."""


# node type -> the attributes it may carry and a check for each; text nodes are handled apart
_NODES = {
    "doc": {}, "paragraph": {}, "hardBreak": {}, "bulletList": {}, "listItem": {}, "blockquote": {},
    "orderedList": {"start": lambda v: isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 100_000,
                    "type": lambda v: v is None or v in ("1", "a", "A", "i", "I")},
    "inlineMath": {"latex": lambda v: isinstance(v, str) and len(v) <= policy.NOTE_LATEX_MAX},
}
_LEAVES = {"hardBreak", "inlineMath"}
_MARKS = {"bold", "italic", "strike", "code"}
_APP_STATE = {"viewBackgroundColor", "gridSize", "gridModeEnabled"}


def owned_path(path, user_id: str, book_id: str) -> bool:
    return isinstance(path, str) and re.fullmatch(
        rf"{re.escape(user_id)}/{re.escape(book_id)}/[A-Za-z0-9_-]{{1,64}}\.(webp|png)", path) is not None


def _text_doc(node, depth: int = 1) -> int:
    """Checks a TipTap node and returns the characters of text under it."""
    if depth > policy.NOTE_DOC_DEPTH_MAX:
        raise ContentError("the note is nested too deep")
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        raise ContentError("each node is an object with a type")
    kind = node["type"]
    if kind == "text":
        if set(node) - {"type", "text", "marks"} or not isinstance(node.get("text"), str) or not node["text"]:
            raise ContentError("a text node has non-empty text and marks only")
        for mark in node.get("marks", []):
            if not isinstance(mark, dict) or set(mark) != {"type"} or mark["type"] not in _MARKS:
                raise ContentError(f"marks are {sorted(_MARKS)}, without attributes")
        return len(node["text"])
    if kind not in _NODES or set(node) - {"type", "attrs", "content"}:
        raise ContentError(f"{kind!r} is not a note node")
    checks = _NODES[kind]
    for name, value in (node.get("attrs") or {}).items():
        if name not in checks or not checks[name](value):
            raise ContentError(f"{kind} may not have the attribute {name!r} = {value!r}")
    if kind == "inlineMath" and not isinstance((node.get("attrs") or {}).get("latex"), str):
        raise ContentError("inline math has its LaTeX")
    children = node.get("content", [])
    if not isinstance(children, list) or (children and kind in _LEAVES):
        raise ContentError(f"{kind} has a list of child nodes" if kind not in _LEAVES else f"{kind} has no children")
    return sum(_text_doc(child, depth + 1) for child in children)


def _text(content: dict, user_id: str, book_id: str) -> dict:
    if content.get("type") != "doc":
        raise ContentError("a text block is a TipTap document")
    if _text_doc(content) > policy.NOTE_TEXT_MAX:
        raise ContentError(f"a text block is at most {policy.NOTE_TEXT_MAX} characters long")
    return content


def _drawing(content: dict, user_id: str, book_id: str) -> dict:
    if set(content) - {"elements", "appState", "files"}:
        raise ContentError("a drawing is elements, appState and files")
    elements = content.get("elements")
    if not isinstance(elements, list) or len(elements) > policy.NOTE_DRAWING_ELEMENTS_MAX or not all(
            isinstance(e, dict) for e in elements):
        raise ContentError(f"a drawing has at most {policy.NOTE_DRAWING_ELEMENTS_MAX} elements")
    app_state = content.get("appState", {})
    if not isinstance(app_state, dict) or set(app_state) - _APP_STATE:
        raise ContentError(f"a drawing keeps only {sorted(_APP_STATE)} of its app state")
    files = content.get("files", {})
    if not isinstance(files, dict) or len(files) > policy.NOTE_DRAWING_FILES_MAX:
        raise ContentError(f"a drawing has at most {policy.NOTE_DRAWING_FILES_MAX} images")
    for file in files.values():
        if not isinstance(file, dict) or set(file) != {"path", "mimeType"} or file["mimeType"] not in policy.NOTE_FILE_TYPES \
                or not owned_path(file["path"], user_id, book_id):
            raise ContentError("a drawing's images are files in your notes folder")
    return content


_ANCHOR = TypeAdapter(Annotated[PdfAnchor | EpubAnchor, Field(discriminator="kind")])


def _anchor(value):
    try:
        return _ANCHOR.validate_python(value).model_dump()
    except ValidationError as error:
        raise ContentError("source_anchor is an ANCHORS A1 anchor") from error


def _string(limit: int):
    def check(value, user_id, book_id):
        if not isinstance(value, str) or len(value) > limit:
            raise ContentError(f"at most {limit} characters")
        return value
    return check


def _image(value, user_id, book_id):
    if value is not None and not owned_path(value, user_id, book_id):
        raise ContentError("an image is a file in your notes folder")
    return value


def _language(value, user_id, book_id):
    if value not in policy.NOTE_CODE_LANGUAGES:
        raise ContentError(f"language is one of {policy.NOTE_CODE_LANGUAGES}")
    return value


# kind -> field -> (check, default)
_FIELDS = {
    "equation": {"latex": (_string(policy.NOTE_LATEX_MAX), ""), "image_path": (_image, None)},
    "code": {"code": (_string(policy.NOTE_CODE_MAX), ""), "language": (_language, "")},
    "figure": {"image_path": (_image, None), "caption": (_string(policy.NOTE_CAPTION_MAX), ""),
               "source_anchor": (lambda v, u, b: None if v is None else _anchor(v), None)},
}


def _fields(kind: str):
    def check(content: dict, user_id: str, book_id: str) -> dict:
        spec = _FIELDS[kind]
        if set(content) - set(spec):
            raise ContentError(f"a {kind} block has only {sorted(spec)}")
        return {name: test(content.get(name, default), user_id, book_id) for name, (test, default) in spec.items()}
    return check


_KINDS = {"text": _text, "drawing": _drawing, "equation": _fields("equation"), "code": _fields("code"),
          "figure": _fields("figure")}


def check_content(kind: str, content, *, user_id: str, book_id: str) -> dict:
    """The block's content as it will be stored, or ContentError."""
    if kind not in _KINDS:
        raise ContentError(f"kind is one of {policy.NOTE_KINDS}")
    if not isinstance(content, dict):
        raise ContentError("content is an object")
    checked = _KINDS[kind](content, user_id, book_id)
    if len(json.dumps(checked, ensure_ascii=False).encode()) > policy.NOTE_CONTENT_MAX_BYTES:
        raise ContentError(f"a block is at most {policy.NOTE_CONTENT_MAX_BYTES} bytes large")
    return checked
