"""A book being deleted (C35.2, issue 18).

DELETE /books/{id} marks the row `deleting` and answers at once (one small update); `purge` then removes the
original, the note pictures and the row, whose cascade takes about 15,000 rows for a 600-page book, in the
background. A purge that a restart or a failure cuts short is finished by `purge_left`, which the ingestion sweep
runs at startup and then on its schedule. Until the row is gone no listing or lookup should show the book: every
owner's read of a book passes its rows through `live` (C35.2b).
"""

import logging
from typing import Any

from backend.services import file_url
from backend.services.supabase_client import supabase

DELETING = "deleting"
NOTE_FILES_PAGE = 100  # objects listed per call when clearing a book's note folder

logger = logging.getLogger(__name__)


def live(rows: list | None) -> list[dict[str, Any]]:
    """The rows of books not being deleted (a row without a status is a live book)."""
    return [row for row in rows or [] if row.get("status") != DELETING]


def mark(book_id: str, user_id: str) -> bool:
    """Mark the owner's book `deleting`; False if the reader has no such book (or it is already going)."""
    rows = supabase.table("books").select("id, status").eq("id", book_id).eq("user_id", user_id).execute().data
    if not live(rows):
        return False
    supabase.table("books").update({"status": DELETING}).eq("id", book_id).eq("user_id", user_id).execute()
    return True


def remove_note_files(user_id: str, book_id: str) -> int:
    """Remove every file in notes/<user>/<book>/ (note crops, drawings, thumbnails: POST /books/{id}/note-files),
    listed a page at a time. The database cascade removes the note rows but never storage (DEBUG_LOG 2026-11-16)."""
    bucket, folder, removed = supabase.storage.from_("notes"), f"{user_id}/{book_id}", 0
    while True:
        names = [o["name"] for o in bucket.list(folder, {"limit": NOTE_FILES_PAGE, "offset": 0}) or [] if o.get("id")]
        if not names:
            return removed
        gone = bucket.remove([f"{folder}/{name}" for name in names]) or []
        if not gone:  # nothing removed: stop rather than list the same files again
            raise RuntimeError(f"{len(names)} note files could not be removed")
        removed += len(gone)


def purge(book_id: str, user_id: str) -> bool:
    """Remove a `deleting` book's original, its note pictures and its row (the cascade takes the rest).

    A storage failure is logged and the row still goes, as before C35.2; a row that cannot be deleted stays
    `deleting`, hidden, for `purge_left` to try again. True once the row is gone.
    """
    rows = supabase.table("books").select("storage_path, status").eq("id", book_id).eq("user_id", user_id).execute().data
    if not rows or rows[0].get("status") != DELETING:
        return False
    storage_path = rows[0].get("storage_path")
    if storage_path:
        file_url.forget(storage_path)  # C35.8a: its kept signed URL is not handed out again
        try:
            supabase.storage.from_("books").remove([storage_path])
        except Exception:  # the row still goes
            logger.warning("Deleting book %s: its file %s was not removed", book_id, storage_path, exc_info=True)
    try:
        remove_note_files(user_id, book_id)
    except Exception:  # the row still goes
        logger.warning("Deleting book %s: its note files were not all removed", book_id, exc_info=True)
    try:
        supabase.table("books").delete().eq("id", book_id).eq("user_id", user_id).eq("status", DELETING).execute()
    except Exception:  # it stays hidden and the sweep tries again
        logger.warning("Deleting book %s: the row was not deleted; the sweep will try again", book_id, exc_info=True)
        return False
    return True


def purge_left() -> list[str]:
    """Finish every purge a restart or a failure left: the ids of the books now gone."""
    rows = supabase.table("books").select("id, user_id").eq("status", DELETING).execute().data or []
    return [row["id"] for row in rows if purge(row["id"], row["user_id"])]
