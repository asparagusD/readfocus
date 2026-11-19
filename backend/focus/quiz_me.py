"""Quiz me (C23.7b, docs/FOCUS_RULES.md F13): a quiz outside focus mode, never scored for points. Its range ends at
the reader's place and starts at the chapter holding it ("chapter") or where the last quiz on this book ended
("since_last"): a focus session's bookmark, else the chunk after the last test's, else the body start. The quiz is
kept on a new sessions row, so POST /sessions/{id}/submit-answers grades it and moves mastery like any test."""

import uuid
from typing import Literal

from backend.focus import quiz, store
from backend.services import body_start
from backend.services.supabase_client import supabase

Scope = Literal["chapter", "since_last"]


class NothingToAsk(Exception):
    """The range holds no prose yet (the place is at, or before, its start)."""


def anchor_at(kind: str, unit: int) -> dict:
    """The very start of a PDF page or an EPUB spine item, as a point anchor."""
    if kind == "pdf":
        return {"kind": "pdf", "page": unit, "quads": [[0, 0, 0, 0]], "text": ""}
    return {"kind": "epub", "cfi": f"epubcfi(/6/{2 * (unit + 1)}!/0)", "text": ""}


def _kind(book: dict) -> str:
    return "pdf" if str(book.get("file_type") or "").lower() == "pdf" else "epub"


def _key(kind: str) -> str:
    return "page" if kind == "pdf" else "spine_index"


def _body_start(book: dict) -> dict:
    """The body start as an anchor, else the book's first page or section."""
    kind = _kind(book)
    start = book.get("body_start") or (body_start.for_book(supabase, book) or {}).get("body_start")
    if start and start.get("kind") == kind and start.get(_key(kind)) is not None:
        return anchor_at(kind, start[_key(kind)])
    return anchor_at(kind, 0)


def chapter_start(book: dict, place: dict) -> dict:
    """The start of the contents entry holding the place, else the body start."""
    kind, unit = _kind(book), store.unit_of(place)
    units = [e[_key(kind)] for e in book.get("toc") or [] if e.get(_key(kind)) is not None]
    holding = [u for u in units if unit is not None and u <= unit]
    return anchor_at(kind, max(holding)) if holding else _body_start(book)


def since_last_start(user_id: str, book: dict) -> dict:
    """Where the last quiz on this book ended: a focus bookmark, else the chunk after the last test's chunks."""
    rows = supabase.table("sessions").select("id, chunk_end_index, completed_at").eq("user_id", user_id).eq(
        "book_id", book["id"]).eq("status", "completed").order("completed_at", desc=True).limit(1).execute().data
    if not rows:
        return _body_start(book)
    last = rows[0]
    focus = supabase.table("focus_sessions").select("end_anchor").eq("id", last["id"]).eq(
        "user_id", user_id).execute().data
    if focus and focus[0].get("end_anchor"):
        return focus[0]["end_anchor"]
    kind, after = _kind(book), (last.get("chunk_end_index") or 0) + 1
    if kind == "pdf":
        chunk = supabase.table("chunks").select("anchors").eq("book_id", book["id"]).eq(
            "chunk_index", after).execute().data
        pages = ((chunk[0].get("anchors") or {}).get("pages") if chunk else None) or []
        if pages:
            return anchor_at(kind, pages[0])
    units = [e[_key(kind)] for e in book.get("toc") or []
             if e.get(_key(kind)) is not None and e.get("chunk_index") is not None and e["chunk_index"] <= after]
    return anchor_at(kind, max(units)) if units else _body_start(book)


def build(user_id: str, book: dict, scope: Scope, place: dict) -> dict:
    """A new Quiz me quiz {session_id, questions (stored form), count, words_in_range}.

    C26.3: quiz.Preparing while the range up to the place is not stored yet (C36.3; nothing is made)."""
    if quiz.preparing(book, place):
        raise quiz.Preparing
    start = chapter_start(book, place) if scope == "chapter" else since_last_start(user_id, book)
    if start["kind"] != place["kind"] or store.order_key(start) >= store.order_key(place):
        raise NothingToAsk
    questions, words, indices, picked = quiz._assemble(user_id, book, start, place)
    if words <= 0:
        raise NothingToAsk
    session_id = str(uuid.uuid4())
    quiz._keep(session_id, user_id, book["id"], questions, words, indices, picked, store.stamp(store.now()))
    return {"session_id": session_id, "questions": questions, "count": len(questions), "words_in_range": round(words)}
