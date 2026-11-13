"""Characters of a PDF page with their fonts and positions, grouped into lines and blocks.

pdfplumber (MIT) reads each character's text, font name, size and box.
build_page is pure: it takes those characters and returns lines (characters
sharing a baseline, sub- and superscripts included, split at column gutters)
and blocks (lines stacked closely, overlapping horizontally). Coordinates
are PDF points from the top-left of the page's crop box (docs/ANCHORS.md
A1). Each character keeps its offset from its line's baseline (positive is
raised), which math detection reads (C18.3). Thresholds: policy.REGION_*.

page_chars reads one page; iter_pages reads a range with the file opened
once, closing each page after use so pdfminer's caches do not pile up.
"""

import io
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path
from statistics import median

import pdfplumber

from backend.agents import policy


@dataclass
class Char:
    text: str
    fontname: str
    font: str
    size: float
    x0: float
    x1: float
    top: float
    bottom: float
    upright: bool
    baseline_offset: float = 0.0


@dataclass
class Line:
    chars: list[Char]
    text: str
    x0: float
    top: float
    x1: float
    bottom: float
    baseline: float
    size: float
    upright: bool


@dataclass
class Block:
    lines: list[Line]
    x0: float
    top: float
    x1: float
    bottom: float


@dataclass
class Page:
    page: int
    width: float
    height: float
    lines: list[Line] = field(default_factory=list)
    blocks: list[Block] = field(default_factory=list)


def font_family(fontname: str) -> str:
    """The font name without a subset prefix ("HWQHFW+LinLibertineO" -> "LinLibertineO")."""
    prefix, plus, rest = fontname.partition("+")
    return rest if plus and len(prefix) == 6 and prefix.isupper() else fontname


def _char(raw: dict, left: float, top: float) -> Char:
    return Char(text=raw["text"], fontname=raw.get("fontname", ""), font=font_family(raw.get("fontname", "")),
                size=round(float(raw["size"]), 2), x0=round(raw["x0"] - left, 2), x1=round(raw["x1"] - left, 2),
                top=round(raw["top"] - top, 2), bottom=round(raw["bottom"] - top, 2), upright=bool(raw["upright"]))


def _overlap(char: Char, top: float, bottom: float) -> float:
    shared = min(char.bottom, bottom) - max(char.top, top)
    smaller = min(char.bottom - char.top, bottom - top) or 1.0
    return shared / smaller


def _rows(chars: list[Char], rows: list[list[Char]] | None = None) -> list[list[Char]]:
    """Put each character in the row it overlaps most, or a new row."""
    rows = rows if rows is not None else []
    for char in sorted(chars, key=lambda c: (c.top, c.x0)):
        best, best_share = None, policy.REGION_LINE_OVERLAP
        for row in rows:
            share = _overlap(char, min(c.top for c in row), max(c.bottom for c in row))
            if share >= best_share:
                best, best_share = row, share
        if best is None:
            rows.append([char])
        else:
            best.append(char)
    return rows


def _split(row: list[Char]) -> list[list[Char]]:
    """Split a row at gaps wider than a column gutter."""
    row = sorted(row, key=lambda c: (c.x0, c.top))
    size = median(c.size for c in row)
    parts = [[row[0]]]
    for char in row[1:]:
        if char.x0 - max(c.x1 for c in parts[-1]) > policy.REGION_COLUMN_GAP_EM * size:
            parts.append([])
        parts[-1].append(char)
    return parts


def _line(chars: list[Char], normal: float) -> Line:
    size = median(c.size for c in chars)
    full = [c for c in chars if c.size >= policy.REGION_SMALL_CHAR * normal] or chars
    baseline = round(median(c.bottom for c in full), 2)
    text = chars[0].text
    for before, char in pairwise(chars):
        if char.x0 - before.x1 > policy.REGION_WORD_GAP_EM * size:
            text += " "
        text += char.text
    for char in chars:
        char.baseline_offset = round(baseline - char.bottom, 2)
    return Line(chars=chars, text=text, x0=min(c.x0 for c in chars), top=min(c.top for c in chars),
                x1=max(c.x1 for c in chars), bottom=max(c.bottom for c in chars), baseline=baseline,
                size=size, upright=chars[0].upright)


def _blocks(lines: list[Line]) -> list[Block]:
    blocks: list[list[Line]] = []
    for line in lines:
        home = None
        if line.upright:
            for block in reversed(blocks):
                last = block[-1]
                gap = line.top - last.bottom
                across = min(line.x1, max(b.x1 for b in block)) - max(line.x0, min(b.x0 for b in block))
                if last.upright and across > 0 and gap <= policy.REGION_BLOCK_GAP_EM * max(line.size, last.size):
                    home = block
                    break
        if home is None:
            blocks.append([line])
        else:
            home.append(line)
    return [Block(lines=b, x0=min(n.x0 for n in b), top=min(n.top for n in b), x1=max(n.x1 for n in b),
                  bottom=max(n.bottom for n in b)) for b in blocks]


def build_page(raw_chars: list[dict], page_no: int, bbox: tuple[float, float, float, float]) -> Page:
    """Lines and blocks from pdfplumber-shaped characters. Pure."""
    left, top, right, bottom = bbox
    chars = [_char(c, left, top) for c in raw_chars if c["text"] and not c["text"].isspace()]
    page = Page(page=page_no, width=round(right - left, 2), height=round(bottom - top, 2))
    if not chars:
        return page
    lines = []
    for upright in (True, False):
        group = [c for c in chars if c.upright is upright]
        if not group:
            continue
        normal = median(c.size for c in group)
        big = [c for c in group if c.size >= policy.REGION_SMALL_CHAR * normal]
        small = [c for c in group if c.size < policy.REGION_SMALL_CHAR * normal]
        rows = _rows(small, _rows(big))
        lines += [_line(part, normal) for row in rows for part in _split(row)]
    lines.sort(key=lambda n: (not n.upright, n.top, n.x0))
    page.lines = lines
    page.blocks = _blocks(lines)
    return page


def _open(source):
    if isinstance(source, (bytes, bytearray)):
        return pdfplumber.open(io.BytesIO(source))
    return pdfplumber.open(Path(source))


def _read(pdf, page_no: int) -> Page:
    if not 1 <= page_no <= len(pdf.pages):
        raise ValueError(f"page {page_no} is not in 1..{len(pdf.pages)}")
    plumber_page = pdf.pages[page_no - 1]
    try:
        return build_page(plumber_page.chars, page_no, tuple(plumber_page.bbox))
    finally:
        plumber_page.close()


def page_count(source) -> int:
    with _open(source) as pdf:
        return len(pdf.pages)


def page_chars(source, page_no: int) -> Page:
    """One page (1-based) of a PDF given as a path or bytes."""
    with _open(source) as pdf:
        return _read(pdf, page_no)


def iter_pages(source, first: int, last: int):
    """Pages first..last (1-based, inclusive), the file opened once."""
    with _open(source) as pdf:
        for page_no in range(first, min(last, len(pdf.pages)) + 1):
            yield _read(pdf, page_no)
