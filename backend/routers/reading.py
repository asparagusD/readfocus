"""A book opened at the reader's place, with no session or plan (C26.4).

GET /books/{id}/open: what the reader needs to show the book (title, author, format, storage mode, contents,
status, the pages-only flag of a fully scanned book with no text yet) and the saved place; the reader's
reading_progress row is created on a first open, with the planner's defaults. PUT /books/{id}/position:
the place, saved on every page turn; a place with an anchor asks for the "Finished a book" badge as
/sessions/{id}/position does. Neither needs the book to be processed: a book still being read has no
chunks, and its place is its anchor. /sessions/start and /sessions/{id}/position stay for old clients
until C26.6.
"""

from typing import Annotated, Any, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from backend.dependencies import get_current_user
from backend.routers.sessions import EpubAnchor, PdfAnchor
from backend.services.supabase_client import supabase
from backend.xp import badge_award

router = APIRouter()

BOOK_FIELDS = ("id, title, author, toc, file_format, file_type, storage_mode, status, scanned_pages, total_chunks, "
               "source_format")
NEW_PROGRESS = {"last_chunk_index": -1, "chunks_completed": 0, "re_read_queue": []}  # as the planner makes it


class BookPosition(BaseModel):
    """A place in the book: an anchor in the PDF or EPUB itself; its chunk when the reader knows it."""

    model_config = ConfigDict(extra="forbid")
    anchor: Annotated[PdfAnchor | EpubAnchor, Field(discriminator="kind")]
    chunk_index: int | None = Field(default=None, ge=0)


def own_book(user_id: str, book_id: str) -> dict:
    rows = supabase.table("books").select(BOOK_FIELDS).eq("id", book_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found.")
    return cast(dict[str, Any], rows[0])


def progress_row(user_id: str, book_id: str) -> dict:
    """The reader's progress row for the book, made on a first open (two opens at once make one row)."""
    query = supabase.table("reading_progress").select("position").eq("user_id", user_id).eq("book_id", book_id)
    rows = query.execute().data
    if rows:
        return cast(dict[str, Any], rows[0])
    supabase.table("reading_progress").upsert({"user_id": user_id, "book_id": book_id, **NEW_PROGRESS},
                                              on_conflict="user_id,book_id", ignore_duplicates=True).execute()
    rows = query.execute().data
    return cast(dict[str, Any], rows[0]) if rows else {"position": None}


def opening(user_id: str, book_id: str) -> dict:
    book = own_book(user_id, book_id)
    progress = progress_row(user_id, book_id)
    kind = (book.get("file_format") or book.get("file_type") or "").lower()
    return {
        "book_id": book_id,
        "book": {"title": book.get("title"), "author": book.get("author"), "toc": book.get("toc") or [],
                 "format": kind, "storage_mode": book.get("storage_mode")},
        "status": book.get("status"),
        # C19.4: a fully scanned book with no text yet; the reader reads its pages by OCR in the browser
        "pages_only": bool(book.get("scanned_pages")) and not book.get("total_chunks"),
        "scanned_pages": book.get("scanned_pages") or [],
        # C26.7: a book over 50 MB whose text this browser sent: no region map, so no equation, code or figure tools
        "text_only": book.get("source_format") == "browser-text",
        "position": progress.get("position"),  # the last saved place, or None: the reader opens at page one
    }


@router.get("/{book_id}/open")
async def open_book(book_id: str, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(opening, user_id, book_id)


def save(user_id: str, book_id: str, req: BookPosition) -> dict:
    book = own_book(user_id, book_id)
    kind = (book.get("file_format") or book.get("file_type") or "").lower()
    if req.anchor.kind != kind:
        raise HTTPException(status_code=422, detail=f"That place is not in this {kind.upper() or 'book'}.")
    if req.chunk_index is not None and not supabase.table("chunks").select("id").eq("book_id", book_id).eq(
            "chunk_index", req.chunk_index).limit(1).execute().data:
        raise HTTPException(status_code=422, detail="No such chunk in this book.")
    position = req.model_dump(exclude_none=True)
    progress_row(user_id, book_id)  # a place saved before any open still has its row
    supabase.table("reading_progress").update({"position": position}).eq("user_id", user_id).eq(
        "book_id", book_id).execute()
    return position


@router.put("/{book_id}/position")
async def save_book_position(book_id: str, req: BookPosition, background_tasks: BackgroundTasks,
                             user_id: str = Depends(get_current_user)):
    position = await run_in_threadpool(save, user_id, book_id, req)
    background_tasks.add_task(badge_award.check_quietly, user_id, "place", book_id=book_id,
                              anchor=position["anchor"])  # C24.2: Finished a book, after the response
    return {"position": position}
