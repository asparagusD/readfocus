"""Highlights and underlines (C21.1, docs/ANCHORS.md): list, create, restyle and delete a reader's annotations.

Owner only: every query filters by the caller's id (the service role bypasses RLS; migration 026's SELECT policy
is the second wall), and another reader's book or annotation is 404. Anchors follow A1 (one per PDF page or EPUB
spine item, in reading order, A2); position_start and position_end are A4 sortable positions, checked against the
anchors: the page or spine part always, the line (floor of the quad's top or bottom) for PDF. Their low digits
(the x term, the EPUB character count) come from the reader, who has the page width and the section's text.
"""

import re
from datetime import UTC, datetime
from itertools import pairwise
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.routers.sessions import EpubAnchor, PdfAnchor
from backend.services.supabase_client import supabase

router = APIRouter()

PART = 1_000_000  # A4: the page or spine index sits above this, the line and offset below
MAX_POSITION = 100_001 * PART
COLUMNS = "id, book_id, anchors, position_start, position_end, style, color, text_snapshot, orphaned, created_at, updated_at"
Anchor = Annotated[PdfAnchor | EpubAnchor, Field(discriminator="kind")]


def _collapse(text: str) -> str:
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


class Style(BaseModel):
    model_config = ConfigDict(extra="forbid")
    style: str | None = None
    color: str | None = None

    @model_validator(mode="after")
    def from_the_palette(self):
        if self.style is not None and self.style not in policy.ANNOTATION_STYLES:
            raise ValueError(f"style is one of {policy.ANNOTATION_STYLES}")
        if self.color is not None and self.color not in policy.ANNOTATION_COLORS:
            raise ValueError(f"color is one of {policy.ANNOTATION_COLORS}")
        return self


class NewAnnotation(Style):
    style: str
    color: str
    anchors: list[Anchor] = Field(min_length=1, max_length=policy.ANNOTATION_ANCHORS_MAX)
    position_start: float = Field(ge=0, lt=MAX_POSITION)
    position_end: float = Field(ge=0, lt=MAX_POSITION)

    @model_validator(mode="after")
    def anchors_match_positions(self):
        if len({a.kind for a in self.anchors}) != 1:
            raise ValueError("an annotation is all PDF or all EPUB")
        places = [_place(a) for a in self.anchors]
        if any(b <= a for a, b in pairwise(places)):
            raise ValueError("one anchor per page or spine item, in reading order (A2)")
        for anchor in self.anchors:
            anchor.text = _collapse(anchor.text)
            if not anchor.text:
                raise ValueError("a highlight covers text: point anchors are not annotations (A3)")
        start, end = self.position_start, self.position_end
        if not (start.is_integer() and end.is_integer()) or end < start:
            raise ValueError("positions are whole numbers, start before end (A4)")
        if start // PART != places[0] or end // PART != places[-1]:
            raise ValueError("a position's page or spine part is its anchor's (A4)")
        first, last = self.anchors[0], self.anchors[-1]
        if isinstance(first, PdfAnchor) and isinstance(last, PdfAnchor) and (
                start % PART // 100 != int(first.quads[0][1]) or end % PART // 100 != int(last.quads[-1][3])):
            raise ValueError("a PDF position's line is floor(y) of the first quad's top or the last quad's bottom")
        return self


def _owned(book_id: str, user_id: str) -> None:
    if not supabase.table("books").select("id").eq("id", book_id).eq("user_id", user_id).execute().data:
        raise HTTPException(status_code=404, detail="Book not found")


def _mine(annotation_id: str, user_id: str) -> None:
    if not supabase.table("annotations").select("id").eq("id", annotation_id).eq("user_id", user_id).execute().data:
        raise HTTPException(status_code=404, detail="Annotation not found")


@router.get("/books/{book_id}/annotations")
def list_annotations(book_id: str, start: float | None = Query(default=None, alias="from", ge=0),
                     end: float | None = Query(default=None, alias="to", ge=0),
                     user_id: str = Depends(get_current_user)):
    """The reader's annotations in this book in reading order; with from/to, those overlapping that range."""
    if start is not None and end is not None and end < start:
        raise HTTPException(status_code=422, detail="from is at most to")
    _owned(book_id, user_id)
    query = supabase.table("annotations").select(COLUMNS).eq("user_id", user_id).eq("book_id", book_id)
    if start is not None:
        query = query.gte("position_end", start)
    if end is not None:
        query = query.lte("position_start", end)
    rows = query.order("position_start").limit(policy.ANNOTATIONS_LIST_MAX).execute().data
    return {"annotations": rows}


@router.post("/books/{book_id}/annotations", status_code=201)
def create_annotation(book_id: str, req: NewAnnotation, user_id: str = Depends(get_current_user)):
    _owned(book_id, user_id)
    anchors = [a.model_dump() for a in req.anchors]
    row = {"user_id": user_id, "book_id": book_id, "anchors": anchors, "style": req.style, "color": req.color,
           "position_start": req.position_start, "position_end": req.position_end, "orphaned": False,
           "text_snapshot": " ".join(a["text"] for a in anchors)[: policy.ANNOTATION_TEXT_MAX]}
    return supabase.table("annotations").insert(row).execute().data[0]


@router.patch("/annotations/{annotation_id}")
def restyle_annotation(annotation_id: str, req: Style, user_id: str = Depends(get_current_user)):
    change = req.model_dump(exclude_none=True)
    if not change:
        raise HTTPException(status_code=422, detail="Give a style or a color")
    _mine(annotation_id, user_id)
    change["updated_at"] = datetime.now(UTC).isoformat()
    return supabase.table("annotations").update(change).eq("id", annotation_id).eq("user_id", user_id).execute().data[0]


@router.delete("/annotations/{annotation_id}", status_code=204)
def delete_annotation(annotation_id: str, user_id: str = Depends(get_current_user)):
    _mine(annotation_id, user_id)
    supabase.table("annotations").delete().eq("id", annotation_id).eq("user_id", user_id).execute()
    return Response(status_code=204)
