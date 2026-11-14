"""Checks shared by everything anchored in a book (docs/ANCHORS.md): annotations (C21.1) and note blocks (C22.1).

Anchors follow A1, one per PDF page or EPUB spine item, in reading order (A2). position_start and position_end are
A4 sortable positions, checked against the anchors: the page or spine part always, the line (floor of the first
quad's top, the last quad's bottom) for a PDF. Their low digits (the x term, the EPUB character count) come from
the reader, who has the page width and the section's text.
"""

import re
from itertools import pairwise
from typing import Annotated

from pydantic import Field

from backend.routers.sessions import EpubAnchor, PdfAnchor

PART = 1_000_000  # A4: the page or spine index sits above this, the line and offset below
MAX_POSITION = 100_001 * PART
Anchor = Annotated[PdfAnchor | EpubAnchor, Field(discriminator="kind")]


def collapse(text: str) -> str:
    return " ".join(text.split())


def spine_of_range(cfi: str) -> int | None:
    """The spine index of a range CFI (parent, start, end), or None for a point or an unreadable CFI."""
    inner = re.fullmatch(r"epubcfi\((.*)\)", cfi)
    parts = re.sub(r"\[[^\]]*\]", "", inner.group(1)).split(",") if inner else []
    if len(parts) != 3 or "!" not in parts[0] or not all(parts):
        return None
    steps = parts[0].split("!")[0].split("/")[1:]
    if len(steps) < 2 or not all(s.isdigit() for s in steps) or int(steps[-1]) % 2 or int(steps[-1]) < 2:
        return None
    return int(steps[-1]) // 2 - 1


def _place(anchor: PdfAnchor | EpubAnchor) -> int:
    if isinstance(anchor, PdfAnchor):
        if any(x0 > x1 or y0 > y1 for x0, y0, x1, y1 in anchor.quads):
            raise ValueError("each quad is [x0, y0, x1, y1] with x0 <= x1 and y0 <= y1")
        return anchor.page
    spine = spine_of_range(anchor.cfi)
    if spine is None:
        raise ValueError("an EPUB anchor is a range CFI inside one spine item")
    return spine


def check_anchors(anchors: list, start: float, end: float, *, text: bool = True) -> None:
    """Raises ValueError unless the anchors are one kind, one per page or spine item in reading order, and the
    positions agree with them. Collapses each anchor's text; with text=False (the pages shown) it must be empty."""
    if len({a.kind for a in anchors}) != 1:
        raise ValueError("anchors are all PDF or all EPUB")
    places = [_place(a) for a in anchors]
    if any(b <= a for a, b in pairwise(places)):
        raise ValueError("one anchor per page or spine item, in reading order (A2)")
    for anchor in anchors:
        anchor.text = collapse(anchor.text)
        if text and not anchor.text:
            raise ValueError("a selection covers text: point anchors are not selections (A3)")
        if not text and anchor.text:
            raise ValueError("the pages shown carry no text")
    if not (start.is_integer() and end.is_integer()) or end < start:
        raise ValueError("positions are whole numbers, start before end (A4)")
    if start // PART != places[0] or end // PART != places[-1]:
        raise ValueError("a position's page or spine part is its anchor's (A4)")
    first, last = anchors[0], anchors[-1]
    if isinstance(first, PdfAnchor) and isinstance(last, PdfAnchor) and (
            start % PART // 100 != int(first.quads[0][1]) or end % PART // 100 != int(last.quads[-1][3])):
        raise ValueError("a PDF position's line is floor(y) of the first quad's top or the last quad's bottom")
