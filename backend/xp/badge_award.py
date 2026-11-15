"""Awarding badges (C24.2, docs/GAMIFICATION.md Badges, G2). evaluate_badges(user_id, trigger) runs after a focus
session is scored ("focus"), a note is created ("note"), Steve answers ("steve") and a reading place is saved
("place"). It reads only the facts the trigger's unheld badges need, from the reader's own rows, then inserts
each earned badge into user_badges; the primary key refuses a second award, and only a first one writes the
badge's XP row (award.credit_badge). Callers log a failure; it never fails their request."""

import logging
from datetime import UTC, datetime

from backend.focus.store import unit_of
from backend.services.supabase_client import supabase
from backend.xp import award
from backend.xp.badges import (
    CATALOGUE,
    TRIGGERS,
    Facts,
    chapter_one_last_chunk,
    earned,
    reaches_end,
    technical,
)

log = logging.getLogger(__name__)
PASSED = ("first_focus", "focus_10h", "focus_50h", "focus_100h")
STREAKS = ("streak_7", "streak_30", "streak_100")


def _held(user_id: str) -> set[str]:
    rows = supabase.table("user_badges").select("badge_id").eq("user_id", user_id).execute().data
    return {r["badge_id"] for r in rows}


def _count(table: str, **filters) -> int:
    query = supabase.table(table).select("id", count="exact")
    for column, value in filters.items():
        query = query.in_(column, value) if isinstance(value, tuple) else query.eq(column, value)
    return query.limit(1).execute().count or 0


def _book(user_id: str, book_id: str | None) -> dict | None:
    if not book_id:
        return None
    rows = supabase.table("books").select("*").eq("id", book_id).eq("user_id", user_id).execute().data
    return rows[0] if rows else None


def _last_chunk(book_id: str) -> dict | None:
    rows = supabase.table("chunks").select("chunk_index, block_paths").eq("book_id", book_id).order(
        "chunk_index", desc=True).limit(1).execute().data
    return rows[0] if rows else None


def _finished(book: dict | None, anchor: dict | None) -> bool:
    if not book or not anchor or anchor.get("kind") not in ("pdf", "epub"):
        return False
    last_spine = None
    if book.get("file_type") != "pdf":
        last = _last_chunk(book["id"])
        spines = [p.get("spine_index") for p in (last or {}).get("block_paths") or [] if isinstance(p, dict)]
        last_spine = max((s for s in spines if isinstance(s, int)), default=None)
    return reaches_end(book.get("file_type") or "pdf", unit_of(anchor), book.get("page_count"), last_spine)


def _first_chapter(user_id: str, session: dict, book: dict | None) -> bool:
    quiz = supabase.table("sessions").select("chunk_end_index").eq("id", session["id"]).eq(
        "user_id", user_id).execute().data
    last = _last_chunk(session["book_id"])
    if not book or not quiz or last is None:
        return False
    end = chapter_one_last_chunk(book.get("toc") or [], book.get("body_start"), last["chunk_index"])
    return end is not None and quiz[0]["chunk_end_index"] >= end


def _focus_facts(user_id: str, session: dict, need: set[str]) -> Facts:
    values: dict = {}
    if need & set(PASSED):
        rows = supabase.table("focus_sessions").select("id, active_seconds, points_total").eq("user_id", user_id).eq(
            "status", "scored").execute().data
        passed = [r for r in rows if (r.get("points_total") or 0) > 0 or r["id"] == session["id"]]
        values |= {"passed_sessions": len(passed), "focus_seconds": sum(r.get("active_seconds") or 0 for r in passed)}
    total = session.get("quiz_total") or 0
    values["perfect_quiz"] = total > 0 and session.get("quiz_correct") == total
    if need & set(STREAKS):
        rows = supabase.table("user_progress").select("streak_days").eq("user_id", user_id).execute().data
        values["streak_days"] = int(rows[0]["streak_days"]) if rows else 0
    per_book = {"first_chapter", "finished_book", "technical_reader"}
    book = _book(user_id, session.get("book_id")) if need & per_book else None
    if "first_chapter" in need:
        values["first_chapter"] = _first_chapter(user_id, session, book)
    if "finished_book" in need:
        values["finished_book"] = _finished(book, session.get("end_anchor"))
    if "technical_reader" in need and book:
        values["technical_book"] = technical(_count("page_regions", book_id=book["id"], kind=("math", "code")),
                                             _count("page_regions", book_id=book["id"]))
    return Facts(**values)


def evaluate_badges(user_id: str, trigger_event: str, *, session: dict | None = None, passed: bool = False,
                    book_id: str | None = None, anchor: dict | None = None) -> list[str]:
    """Award the badges this event earns; the ids newly awarded, in catalogue order. A focus event counts only for
    a scored session whose quiz passed."""
    if trigger_event not in TRIGGERS:
        raise ValueError(f"trigger_event is one of {TRIGGERS}")
    if trigger_event == "focus" and not (session and session.get("status") == "scored" and passed):
        return []
    held = _held(user_id)
    need = {b.id for b in CATALOGUE if trigger_event in b.triggers and b.id not in held}
    if not need:
        return []
    if trigger_event == "focus":
        facts = _focus_facts(user_id, session, need)
    elif trigger_event == "note":
        facts = Facts(text_notes=_count("note_blocks", user_id=user_id, kind="text"),
                      drawings=_count("note_blocks", user_id=user_id, kind="drawing"))
    elif trigger_event == "steve":
        facts = Facts(steve_answers=_count("steve_messages", user_id=user_id, role="steve"))
    else:
        facts = Facts(finished_book=_finished(_book(user_id, book_id), anchor))
    now, awarded = datetime.now(UTC), []
    for badge in earned(facts, held, trigger_event):
        try:
            supabase.table("user_badges").insert({"user_id": user_id, "badge_id": badge.id,
                                                  "awarded_at": now.isoformat()}).execute()
        except Exception as error:
            if not award.is_duplicate(error):
                raise
            continue
        award.credit_badge(user_id, badge.id, badge.xp_reward, now)
        awarded.append(badge.id)
    return awarded


def check_quietly(user_id: str, trigger_event: str, **context) -> list[str]:
    """evaluate_badges for a request that must not fail on it: an error is logged and nothing is awarded."""
    try:
        return evaluate_badges(user_id, trigger_event, **context)
    except Exception:  # logged; the next event of the same kind checks again
        log.exception("Badge check failed for %s on %s", user_id, trigger_event)
        return []
