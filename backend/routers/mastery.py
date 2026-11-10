"""GET /mastery: the caller's concept mastery, weakest first, one page per call."""

from typing import Any, cast

from fastapi import APIRouter, Depends, Query

from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase

router = APIRouter()

COLUMNS = "book_id, concept_key, mastery, attempts, correct, last_seen, next_review"
DEFAULT_LIMIT, MAX_LIMIT = 50, 200
RANGE_NOT_SATISFIABLE = "PGRST103"  # postgrest's error code for an offset at or past the row count


@router.get("")
async def get_mastery(
    book_id: str | None = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    user_id: str = Depends(get_current_user),
):
    def mine(columns: str):
        query = supabase.table("user_concept_mastery").select(columns, count="exact").eq("user_id", user_id)
        return query.eq("book_id", book_id) if book_id else query

    try:
        page = mine(COLUMNS).order("mastery").order("concept_key").range(offset, offset + limit - 1).execute()
    except Exception as error:
        # PostgREST refuses a page that starts past the last row; to the client that is an empty page.
        if getattr(error, "code", None) != RANGE_NOT_SATISFIABLE:
            raise
        return {"items": [], "total": mine("concept_key").limit(1).execute().count or 0, "limit": limit, "offset": offset}
    rows = cast(list[dict[str, Any]], page.data or [])

    labels: dict[tuple, str] = {}
    if rows:  # the label lives with the book's concepts, not with the reader's mastery
        concepts = supabase.table("concepts").select("book_id, concept_key, label").eq("user_id", user_id)
        if book_id:
            concepts = concepts.eq("book_id", book_id)
        found = concepts.in_("concept_key", sorted({row["concept_key"] for row in rows})).execute().data or []
        labels = {(c["book_id"], c["concept_key"]): c["label"] for c in cast(list[dict[str, Any]], found)}
    items = [
        {**{column: row.get(column) for column in COLUMNS.split(", ")},
         "label": labels.get((row["book_id"], row["concept_key"])) or row["concept_key"].replace("-", " ")}
        for row in rows
    ]
    return {"items": items, "total": page.count if page.count is not None else len(items), "limit": limit, "offset": offset}
