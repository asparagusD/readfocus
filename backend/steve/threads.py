"""Steve's conversations (C20.6, docs/STEVE.md S9): one thread per question chain on a book, its messages in order.

Only the backend writes these tables (migration 023: readers may only select their own rows), and every read here
is filtered by the reader as well, because the backend's client is not narrowed by row-level security. A message
holds its text, the anchor asked about, citations, model and token counts: never a key, never an image.
"""

from datetime import UTC, datetime
from typing import Any

from backend.services.supabase_client import supabase

TITLE_CHARS = 80  # a thread is listed by its first question, this long at most


def _now() -> str:
    """Set here rather than left to the column's default, so a question sorts before its answer to the
    microsecond on any database."""
    return datetime.now(UTC).isoformat()


def get_thread(user_id: str, thread_id: str) -> dict | None:
    rows = supabase.table("steve_threads").select("id, book_id, created_at").eq("id", thread_id).eq(
        "user_id", user_id).execute().data
    return rows[0] if rows else None


def create_thread(user_id: str, book_id: str) -> dict:
    row = {"user_id": user_id, "book_id": book_id, "created_at": _now()}
    return supabase.table("steve_threads").insert(row).execute().data[0]


def add_message(*, thread_id: str, user_id: str, role: str, content: str, anchor: dict | None = None,
                citations: list | None = None, model: str | None = None, tokens_in: int | None = None,
                tokens_out: int | None = None) -> dict:
    row: dict[str, Any] = {"thread_id": thread_id, "user_id": user_id, "role": role, "content": content,
                           "anchor": anchor, "citations": citations or [], "model": model,
                           "tokens_in": tokens_in, "tokens_out": tokens_out, "created_at": _now()}
    return supabase.table("steve_messages").insert(row).execute().data[0]


def _messages(user_id: str, thread_id: str) -> list[dict]:
    return supabase.table("steve_messages").select(
        "id, role, content, anchor, citations, model, created_at").eq("thread_id", thread_id).eq(
        "user_id", user_id).order("created_at").execute().data or []


def list_threads(user_id: str, book_id: str) -> list[dict]:
    """The reader's threads on a book, newest first, each titled by its first question."""
    rows = supabase.table("steve_threads").select("id, book_id, created_at").eq("user_id", user_id).eq(
        "book_id", book_id).order("created_at", desc=True).execute().data or []
    out = []
    for row in rows:
        first = next((m for m in _messages(user_id, row["id"]) if m["role"] == "reader"), None)
        title = (first or {}).get("content", "")
        out.append({**row, "title": title if len(title) <= TITLE_CHARS else title[:TITLE_CHARS - 1] + "…"})
    return out


def thread_with_messages(user_id: str, thread_id: str) -> dict | None:
    thread = get_thread(user_id, thread_id)
    return {**thread, "messages": _messages(user_id, thread_id)} if thread else None
