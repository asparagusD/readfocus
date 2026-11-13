"""Regions of an EPUB from its structure, with CFI anchors (C18.5b). No guessing about layout.

Each spine document is walked in order (the CFI steps counted as
book_structure.xhtml_blocks counts them: the body's step under the root,
then 2 x the element's position among its parent's elements):

- <math> at block level -> math (MathML kept; LaTeX from an x-tex
  annotation, else alttext); inside prose it is an inline_math range.
- <pre>, and <code> at block level -> code, exact text; the language from a
  class ("language-python", "lang-js", "python"), else code.guess_language.
  Inline <code> in prose is an inline_code range.
- <figure>, and <img>/<svg>/<object> at block level (or alone in a <p>) ->
  figure: caption from <figcaption>, else alt, else a "Figure N" paragraph
  right after (taken by the figure); images as package paths.
- <table> -> table: <caption>, rows of cell text.
- Text blocks (p, headings, li, dt, dd, ...) -> prose; containers are
  walked into.

Each region: {kind, spine_index, order, path, text, meta, anchor}, the anchor
{"kind": "epub", spine_index, path, cfi} (docs/ANCHORS.md A1, A6). Pure
apart from reading the file; a file that is not an EPUB raises.
"""

import posixpath
import re
from urllib.parse import unquote

from backend.regions import code, policy

CAPTION = re.compile(policy.CAPTION_PATTERN)
SKIP = {"script", "style", "template", "head", "noscript"}
TEXT_BLOCKS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dt", "dd", "blockquote", "caption", "address"}
BLOCK_CHILDREN = TEXT_BLOCKS | {"div", "section", "article", "aside", "header", "footer", "nav", "main", "ul", "ol",
                                "dl", "pre", "table", "figure", "hr", "body"}
PICTURES = {"img", "svg", "object", "image"}
LANGUAGES = {"python": "python", "py": "python", "scheme": "scheme", "lisp": "scheme", "racket": "scheme",
             "clojure": "scheme", "c": "c", "cpp": "c", "c++": "c", "java": "java", "javascript": "javascript",
             "js": "javascript", "typescript": "javascript", "ts": "javascript", "matlab": "matlab", "octave": "matlab"}


def _name(tag) -> str:
    return tag.name.lower().split(":")[-1]


def _elements(node):
    from bs4.element import Tag

    return [child for child in node.children if isinstance(child, Tag)]


def _is_block(tag) -> bool:
    """A child that makes its text block a container: a block element, or display MathML."""
    name = _name(tag)
    return name in BLOCK_CHILDREN or (name == "math" and (tag.get("display") or "").lower() == "block")


def _collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _math_text(tag) -> tuple[str, str | None]:
    annotation = next((a for a in tag.find_all(lambda t: _name(t) == "annotation")
                       if "tex" in (a.get("encoding") or "").lower()), None)
    latex = _collapse(annotation.get_text()) if annotation else None
    if latex:
        return latex, latex
    alttext = tag.get("alttext")
    return (_collapse(alttext) if alttext else _collapse(tag.get_text(""))), None


def _prose(tag) -> tuple[str, dict]:
    """Collapsed text of a text block, with inline math and inline code as character ranges."""
    from bs4.element import NavigableString, Tag

    parts: list[tuple[str, str | None]] = []

    def walk(node):
        for child in node.children:
            if isinstance(child, Tag):
                name = _name(child)
                if name in SKIP:
                    continue
                if name == "math":
                    parts.append((_math_text(child)[0], "inline_math"))
                elif name == "code":
                    parts.append((child.get_text(), "inline_code"))
                elif name == "br":
                    parts.append((" ", None))
                else:
                    walk(child)
            elif type(child) is NavigableString:
                parts.append((str(child), None))

    walk(tag)
    text, meta, space = "", {"inline_math": [], "inline_code": []}, False
    for piece, kind in parts:
        words = _collapse(piece)
        lead = piece[:1].isspace() if piece else False
        if not words:
            space = space or bool(piece and piece.isspace() and text)
            continue
        if text and (space or lead):
            text += " "
        start = len(text)
        text += words
        if kind:
            meta[kind].append([start, len(text)])
        space = piece[-1:].isspace()
    return text, meta


def _images(tag, base: str) -> list[str]:
    """Package paths of every rendition the tag shows: src, srcset and <source> entries, SVG images, objects."""
    found = []
    for node in [tag, *tag.find_all(True)]:
        name = _name(node)
        sources = []
        if name in ("img", "source"):
            sources = [node.get("src")] + [entry.strip().split(" ")[0] for entry in (node.get("srcset") or "").split(",")]
        elif name == "image":
            sources = [node.get("xlink:href") or node.get("href")]
        elif name == "object":
            sources = [node.get("data")]
        for source in sources:
            if source and not source.startswith(("data:", "http:", "https:")):
                path = posixpath.normpath(posixpath.join(base, unquote(source.split("#")[0])))
                if path not in found:
                    found.append(path)
    return found


def _language(tag, text: str) -> tuple[str, str]:
    for node in [tag, *tag.find_all(lambda t: _name(t) == "code")]:
        for cls in node.get("class") or []:
            name = re.sub(r"^(language-|lang-|brush:)", "", cls.lower())
            if name in LANGUAGES:
                return LANGUAGES[name], "class"
    return code.guess_language(text), "guess"


def _caption_of(tag) -> tuple[str | None, str | None]:
    found = CAPTION.match(tag.get_text(" ", strip=True)) if tag is not None else None
    return (_collapse(tag.get_text(" ")), found.group(1)) if found else (None, None)


def document_regions(markup: bytes | str, spine_index: int, base: str) -> list[dict]:
    """The regions of one spine document, in document order. Pure."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(markup, "html.parser")
    root = soup.find(lambda t: _name(t) == "html") or soup
    top = _elements(root)
    body = next((t for t in top if _name(t) == "body"), None)
    if body is None:
        return []
    out: list[dict] = []
    taken: set[int] = set()

    def add(kind, steps, text, meta):
        path = "".join(f"/{s}" for s in steps)
        out.append({"kind": kind, "spine_index": spine_index, "order": len(out), "path": path, "text": text,
                    "meta": meta, "anchor": {"kind": "epub", "spine_index": spine_index, "path": path,
                                             "cfi": f"epubcfi(/6/{2 * (spine_index + 1)}!{path})"}})

    def figure(tag, steps, siblings, index):
        caption = label = None
        figcaption = tag.find(lambda t: _name(t) == "figcaption") if _name(tag) == "figure" else None
        if figcaption is not None:
            caption = _collapse(figcaption.get_text(" "))
            found = CAPTION.match(caption)
            label = found.group(1) if found else None
        img = tag if _name(tag) == "img" else tag.find(lambda t: _name(t) == "img")
        alt = _collapse(img.get("alt") or "") if img is not None else ""
        if caption is None and alt:
            caption = alt
        if caption is None and index + 1 < len(siblings):  # a "Figure N" paragraph right after
            caption, label = _caption_of(siblings[index + 1])
            if caption:
                taken.add(id(siblings[index + 1]))
        add("figure", steps, caption or "", {"caption": caption, "label": label, "alt": alt or None,
                                             "images": _images(tag, base)})

    def walk(node, steps):
        siblings = _elements(node)
        for index, child in enumerate(siblings):
            child_steps = [*steps, 2 * (index + 1)]
            name = _name(child)
            if name in SKIP or id(child) in taken:
                continue
            if name == "math":
                text, latex = _math_text(child)
                add("math", child_steps, text, {"display": True, "mathml": str(child), "latex": latex})
            elif name == "pre" or (name == "code" and _name(node) not in TEXT_BLOCKS):
                text = child.get_text()
                text = text.removeprefix("\n")  # HTML drops a newline right after <pre>
                language, source = _language(child, text)
                add("code", child_steps, text.rstrip("\n"), {"language_guess": language, "language_source": source})
            elif name == "figure" or name in PICTURES:
                figure(child, child_steps, siblings, index)
            elif name == "table":
                caption, label = _caption_of(child.find(lambda t: _name(t) == "caption"))
                if caption is None and child.find(lambda t: _name(t) == "caption") is not None:
                    caption = _collapse(child.find(lambda t: _name(t) == "caption").get_text(" "))
                rows = [[_collapse(cell.get_text(" ")) for cell in row.find_all(lambda t: _name(t) in ("td", "th"))]
                        for row in child.find_all(lambda t: _name(t) == "tr")]
                add("table", child_steps, "\n".join("\t".join(r) for r in rows),
                    {"caption": caption, "label": label, "rows": rows})
            elif name in TEXT_BLOCKS and not any(_is_block(e) for e in _elements(child)):
                pictures = [e for e in child.find_all(True) if _name(e) in ("img", "svg", "object")]
                text, meta = _prose(child)
                if pictures and not text:
                    figure(child, child_steps, siblings, index)  # an image alone in a paragraph
                elif text:
                    add("prose", child_steps, text, meta)
                    if pictures:
                        figure(child, child_steps, siblings, index)
            else:
                walk(child, child_steps)

    walk(body, [2 * (top.index(body) + 1)])
    return out


def _book(file_bytes: bytes):
    from backend.services.book_structure import _read_epub

    return _read_epub(file_bytes)


def epub_regions(file_bytes: bytes, book=None) -> list[dict]:
    """Every spine document's regions, in spine order."""
    import ebooklib

    book = book or _book(file_bytes)
    items = {item.get_id(): item for item in book.get_items()}
    out = []
    for spine_index, (idref, _linear) in enumerate(book.spine):
        item = items.get(idref)
        if item is not None and item.get_type() == ebooklib.ITEM_DOCUMENT:
            out += document_regions(item.get_content(), spine_index, posixpath.dirname(item.get_name()))
    return out


def spine_count(file_bytes: bytes, book=None) -> int:
    return len((book or _book(file_bytes)).spine)


def package_images(file_bytes: bytes) -> list[str]:
    """Paths of the image items in the package's manifest."""
    import ebooklib

    return [item.get_name() for item in _book(file_bytes).get_items()
            if item.get_type() in (ebooklib.ITEM_IMAGE, ebooklib.ITEM_COVER)]


def spine_images(file_bytes: bytes) -> list[str]:
    """Paths of the images the spine documents use (img, svg image, object)."""
    import ebooklib
    from bs4 import BeautifulSoup

    book = _book(file_bytes)
    items = {item.get_id(): item for item in book.get_items()}
    found = []
    for idref, _linear in book.spine:
        item = items.get(idref)
        if item is not None and item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), "html.parser")
            body = soup.find(lambda t: _name(t) == "body")
            if body is not None:
                found += _images(body, posixpath.dirname(item.get_name()))
    return found
