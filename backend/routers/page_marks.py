"""Ink strokes and text boxes on a PDF page (C39.1, issue 23; docs/ANCHORS.md A12): list, create, change, delete.

Edge's Draw and Add text. PDFs only (D2): an EPUB reflows, so a mark on one is refused (409). Owner only, as
annotations: every query filters by the caller's id (the service role bypasses RLS; migration 036's SELECT policy is
the second wall) and another reader's book or mark is 404. A mark's data is in PDF points from the page's top-left
(A1), so it follows zoom and Page view; its `position` (A4) is the page and the line of its top, set here.
"""

import math
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.services.anchor_checks import PART
from backend.services.book_purge import live
from backend.services.supabase_client import supabase

router = APIRouter()

COLUMNS = "id, book_id, kind, page, position, color, data, created_at, updated_at"
Coord = Annotated[float, Field(ge=0, lt=policy.MARK_COORD_MAX, allow_inf_nan=False)]
Pressure = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class InkData(BaseModel):
    """A stroke: its points [x, y, pressure] in drawing order (a tap is one point, a dot) and its width."""

    model_config = ConfigDict(extra="forbid")
    points: list[tuple[Coord, Coord, Pressure]] = Field(min_length=1, max_length=policy.MARK_STROKE_POINTS_MAX)
    width: float = Field(ge=policy.MARK_STROKE_WIDTH[0], le=policy.MARK_STROKE_WIDTH[1], allow_inf_nan=False)

    def top(self) -> float:
        return min(y for _, y, _ in self.points)


class TextData(BaseModel):
    """A text box: its top-left, its width, its text (not empty: an emptied box is deleted) and font size."""

    model_config = ConfigDict(extra="forbid")
    x: Coord
    y: Coord
    width: float = Field(ge=policy.MARK_TEXT_WIDTH[0], le=policy.MARK_TEXT_WIDTH[1], allow_inf_nan=False)
    text: str = Field(min_length=1, max_length=policy.MARK_TEXT_MAX)
    size: float = Field(ge=policy.MARK_TEXT_SIZE[0], le=policy.MARK_TEXT_SIZE[1], allow_inf_nan=False)

    @model_validator(mode="after")
    def not_blank(self):
        if not self.text.strip():
            raise ValueError("a text box holds some text")
        return self

    def top(self) -> float:
        return self.y


DATA = {"ink": InkData, "text": TextData}


def _data(kind: str, data: dict) -> InkData | TextData:
    return DATA[kind].model_validate(data)


def _color(color: str | None) -> None:
    if color is not None and color not in policy.MARK_COLORS:
        raise ValueError(f"color is one of {policy.MARK_COLORS}")


class NewMark(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["ink", "text"]
    page: int = Field(ge=1, le=100_000)
    color: str
    data: dict

    @model_validator(mode="after")
    def checked(self):
        _color(self.color)
        self.data = _data(self.kind, self.data).model_dump()
        return self


class MarkChange(BaseModel):
    """A colour, new data (a box moved, retyped or restyled), or both; the kind and page stay."""

    model_config = ConfigDict(extra="forbid")
    color: str | None = None
    data: dict | None = None

    @model_validator(mode="after")
    def checked(self):
        _color(self.color)
        if self.color is None and self.data is None:
            raise ValueError("give a color or data")
        return self


def _position(page: int, data: InkData | TextData) -> float:
    """A4 for a mark: its page, then the line of its top (no x term: the server has no page width)."""
    return float(page * PART + math.floor(data.top()) * 100)


def _pdf_book(book_id: str, user_id: str) -> dict:
    rows = live(supabase.table("books").select("id, status, file_type, page_count").eq("id", book_id)
                .eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")
    if rows[0].get("file_type") != "pdf":
        raise HTTPException(status_code=409, detail="Drawing and text boxes are for PDF books")
    return rows[0]


def _mark(mark_id: str, user_id: str) -> dict:
    rows = supabase.table("page_marks").select("id, kind, page").eq("id", mark_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Mark not found")
    return rows[0]


@router.get("/books/{book_id}/marks")
def list_marks(book_id: str, first: int | None = Query(default=None, ge=1), last: int | None = Query(default=None, ge=1),
               user_id: str = Depends(get_current_user)):
    """The reader's marks in this book in reading order; with first/last, those on those pages."""
    if first is not None and last is not None and last < first:
        raise HTTPException(status_code=422, detail="first is at most last")
    _pdf_book(book_id, user_id)
    query = supabase.table("page_marks").select(COLUMNS).eq("user_id", user_id).eq("book_id", book_id)
    if first is not None:
        query = query.gte("position", first * PART)
    if last is not None:
        query = query.lte("position", (last + 1) * PART - 1)
    return {"marks": query.order("position").limit(policy.MARKS_LIST_MAX).execute().data}


@router.post("/books/{book_id}/marks", status_code=201)
def create_mark(book_id: str, req: NewMark, user_id: str = Depends(get_current_user)):
    book = _pdf_book(book_id, user_id)
    if book.get("page_count") and req.page > book["page_count"]:
        raise HTTPException(status_code=422, detail="The book has no such page")
    data = _data(req.kind, req.data)
    row = {"user_id": user_id, "book_id": book_id, "kind": req.kind, "page": req.page, "color": req.color,
           "data": req.data, "position": _position(req.page, data)}
    return supabase.table("page_marks").insert(row).execute().data[0]


@router.patch("/marks/{mark_id}")
def change_mark(mark_id: str, req: MarkChange, user_id: str = Depends(get_current_user)):
    mark = _mark(mark_id, user_id)
    change: dict = {"updated_at": datetime.now(UTC).isoformat()}
    if req.color is not None:
        change["color"] = req.color
    if req.data is not None:
        try:
            data = _data(mark["kind"], req.data)
        except ValueError as error:  # a pydantic ValidationError is a ValueError
            raise HTTPException(status_code=422, detail=f"data for a {mark['kind']} mark: {error}") from None
        change["data"] = data.model_dump()
        change["position"] = _position(mark["page"], data)
    return supabase.table("page_marks").update(change).eq("id", mark_id).eq("user_id", user_id).execute().data[0]


@router.delete("/marks/{mark_id}", status_code=204)
def delete_mark(mark_id: str, user_id: str = Depends(get_current_user)):
    _mark(mark_id, user_id)
    supabase.table("page_marks").delete().eq("id", mark_id).eq("user_id", user_id).execute()
    return Response(status_code=204)
