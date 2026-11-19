"""A PDF or EPUB sent straight to Storage (C35.3a, issue 16).

Before C35.3 a 29 MB book went browser -> Render -> Supabase, with every check run in turn on 0.1 CPU (33 s).
Now POST /books/upload-url checks the shelf space and hands back a signed upload URL for the reader's own path,
`<user>/<book>.<ext>` in the `books` bucket; the browser sends the file there itself; POST /books/register then
checks what arrived (it exists, at most MAX_BOOK_FILE_BYTES, a PDF or EPUB by its first bytes, else it is
removed) before the row and the ingestion job are written. The hash, page count and author are the job's.
"""

from typing import Any

import httpx

from backend.agents import policy
from backend.services.supabase_client import supabase

BUCKET = "books"
HEAD_BYTES = 8  # enough for "%PDF-" and a ZIP's "PK\x03\x04"
HEAD_TIMEOUT = 10.0
KINDS = ("pdf", "epub")


def object_path(user_id: str, book_id: str, file_type: str) -> str:
    """The one place a reader's direct upload may land: their own folder, the book's id, its type."""
    return f"{user_id}/{book_id}.{file_type}"


def signed_upload(path: str) -> dict[str, Any]:
    """A signed upload URL and its token for `path` (Supabase keeps it valid for two hours; no overwrite)."""
    return supabase.storage.from_(BUCKET).create_signed_upload_url(path)


def stored_size(path: str) -> int | None:
    """The size in bytes of the object at `path`, or None if nothing is there."""
    folder, _, name = path.rpartition("/")
    for entry in supabase.storage.from_(BUCKET).list(folder, {"limit": 2, "offset": 0, "search": name}) or []:
        if entry.get("name") == name and entry.get("id"):
            size = (entry.get("metadata") or {}).get("size")
            return int(size) if size is not None else None
    return None


def first_bytes(path: str, count: int = HEAD_BYTES) -> bytes:
    """The object's first `count` bytes, through a short signed URL and one Range request (never the whole file)."""
    signed = supabase.storage.from_(BUCKET).create_signed_url(path, 60)
    url = signed.get("signedURL") or signed.get("signedUrl")
    response = httpx.get(url, headers={"Range": f"bytes=0-{count - 1}"}, timeout=HEAD_TIMEOUT)
    response.raise_for_status()
    return response.content[:count]


def kind_of(head: bytes) -> str | None:
    """'pdf' or 'epub' by the file's own first bytes, else None (a name or a content type proves nothing)."""
    if head.startswith(b"%PDF-"):
        return "pdf"
    if head.startswith(b"PK\x03\x04"):  # a ZIP; not every EPUB puts its "mimetype" entry first, so no more is asked
        return "epub"
    return None


def remove(path: str) -> None:
    supabase.storage.from_(BUCKET).remove([path])


def check(path: str, file_type: str) -> tuple[int, tuple[int, str] | None]:
    """The size of the object at `path` and why it cannot become a book, as (status, message), or None if it can.
    A refused object has been removed by the time this returns (except when nothing was there)."""
    size = stored_size(path)
    if size is None:
        return 0, (404, "The upload was not found. Add the book again.")
    if size > policy.MAX_BOOK_FILE_BYTES:
        remove(path)
        return size, (413, f"This file is over {policy.MAX_BOOK_FILE_BYTES // (1024 * 1024)} MB, the most one book can be.")
    if kind_of(first_bytes(path)) != file_type:
        remove(path)
        return size, (400, f"This file is not a {file_type.upper()}.")
    return size, None
