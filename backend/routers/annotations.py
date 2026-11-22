"""Highlights and underlines (C21.1, docs/ANCHORS.md): list, create, restyle and delete a reader's annotations.

Owner only: every query filters by the caller's id (the service role bypasses RLS; migration 026's SELECT policy
is the second wall), and another reader's book or annotation is 404. Anchors follow A1 (one per PDF page or EPUB
spine item, in reading order, A2); position_start and position_end are A4 sortable positions, checked against the
anchors: the page or spine part always, the line (floor of the quad's top or bottom) for PDF. Their low digits
(the x term, the EPUB character count) come from the reader, who has the page width and the section's text.
C39.1 (issue 23, D1): a highlight may carry a comment, Edge's "Add comment": plain text, trimmed; an empty one clears
it (null). D3: the palette is Edge's set (policy.ANNOTATION_COLORS, migration 036).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.services.anchor_checks import MAX_POSITION, Anchor, check_anchors
from backend.services.book_purge import live
from backend.services.supabase_client import supabase

router = APIRouter()

COLUMNS = ("id, book_id, anchors, position_start, position_end, style, color, comment, text_snapshot, orphaned, "
           "created_at, updated_at")


class Style(BaseModel):
    model_config = ConfigDict(extra="forbid")
    style: str | None = None
    color: str | None = None
    comment: str | None = Field(default=None, max_length=policy.ANNOTATION_COMMENT_MAX * 2)

    @model_validator(mode="after")
    def from_the_palette(self):
        if self.style is not None and self.style not in policy.ANNOTATION_STYLES:
            raise ValueError(f"style is one of {policy.ANNOTATION_STYLES}")
        if self.color is not None and self.color not in policy.ANNOTATION_COLORS:
            raise ValueError(f"color is one of {policy.ANNOTATION_COLORS}")
        if self.comment is not None:
            self.comment = self.comment.strip() or None  # an emptied comment clears it
            if self.comment and len(self.comment) > policy.ANNOTATION_COMMENT_MAX:
                raise ValueError(f"a comment is at most {policy.ANNOTATION_COMMENT_MAX} characters")
        return self


class NewAnnotation(Style):
    style: str
    color: str
    anchors: list[Anchor] = Field(min_length=1, max_length=policy.ANNOTATION_ANCHORS_MAX)
    position_start: float = Field(ge=0, lt=MAX_POSITION)
    position_end: float = Field(ge=0, lt=MAX_POSITION)

    @model_validator(mode="after")
    def anchors_match_positions(self):
        check_anchors(self.anchors, self.position_start, self.position_end)
        return self


def _owned(book_id: str, user_id: str) -> None:
    if not live(supabase.table("books").select("id, status").eq("id", book_id).eq("user_id", user_id).execute().data):
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
           "comment": req.comment, "text_snapshot": " ".join(a["text"] for a in anchors)[: policy.ANNOTATION_TEXT_MAX]}
    return supabase.table("annotations").insert(row).execute().data[0]


@router.patch("/annotations/{annotation_id}")
def restyle_annotation(annotation_id: str, req: Style, user_id: str = Depends(get_current_user)):
    change = req.model_dump(include=req.model_fields_set)  # a comment sent empty or null is cleared
    change = {k: v for k, v in change.items() if v is not None or k == "comment"}
    if not change:
        raise HTTPException(status_code=422, detail="Give a style, a color or a comment")
    _mine(annotation_id, user_id)
    change["updated_at"] = datetime.now(UTC).isoformat()
    return supabase.table("annotations").update(change).eq("id", annotation_id).eq("user_id", user_id).execute().data[0]


@router.delete("/annotations/{annotation_id}", status_code=204)
def delete_annotation(annotation_id: str, user_id: str = Depends(get_current_user)):
    _mine(annotation_id, user_id)
    supabase.table("annotations").delete().eq("id", annotation_id).eq("user_id", user_id).execute()
    return Response(status_code=204)
