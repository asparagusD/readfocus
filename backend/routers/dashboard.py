import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase

Row = dict[str, Any]

router = APIRouter()

FEEDBACK_ITEMS = 3  # quotes shown under "recent feedback"
FEEDBACK_PAGE = 5  # results whose answers are read at a time to find them


def _rows(query) -> list[Row]:
    return cast(list[Row], query.execute().data or [])


def latest_feedback(user_id: str) -> list[tuple[Row, Row]]:
    """(result, answer) for the newest answers with feedback, newest first: answers are read a page at a time,
    never for every result."""
    found: list[tuple[Row, Row]] = []

    def query():
        return supabase.table("test_results").select("session_id, created_at, answers").eq(
            "user_id", user_id).order("created_at", desc=True)

    page = _rows(query().limit(FEEDBACK_PAGE))
    while page:
        for result in page:
            for answer in result.get("answers") or []:
                if isinstance(answer, dict) and answer.get("feedback"):
                    found.append((result, answer))
                    if len(found) >= FEEDBACK_ITEMS:
                        return found
        if len(page) < FEEDBACK_PAGE:
            break
        page = _rows(query().lt("created_at", page[-1]["created_at"]).limit(FEEDBACK_PAGE))
    return found


@router.get("")
async def get_dashboard(user_id: str = Depends(get_current_user)):
    """
    Single endpoint that aggregates all dashboard data for the current user.
    """

    # ── 1-3. The reads do not depend on each other, so they run at once ──────
    books, progress_data, sessions, results, feedback_rows = await asyncio.gather(
        run_in_threadpool(_rows, supabase.table("books").select(
            "id, title, author, total_chunks, total_words, status"
        ).eq("user_id", user_id).eq("status", "ready")),
        run_in_threadpool(_rows, supabase.table("reading_progress").select(
            "book_id, chunks_completed, average_score"
        ).eq("user_id", user_id)),
        run_in_threadpool(_rows, supabase.table("sessions").select(
            "id, book_id, assigned_words, completed_at, started_at, chunk_start_index, chunk_end_index"
        ).eq("user_id", user_id).eq("status", "completed").order("completed_at", desc=False)),
        # answers are heavy: only the latest results' answers are read, for the feedback quotes
        run_in_threadpool(_rows, supabase.table("test_results").select(
            "session_id, total_score, max_score, created_at"
        ).eq("user_id", user_id).order("created_at", desc=False)),
        run_in_threadpool(latest_feedback, user_id),
    )
    progress_by_book = {p["book_id"]: p for p in progress_data}
    session_by_id = {s["id"]: s for s in sessions}
    title_by_book = {b["id"]: b["title"] for b in books}
    sessions_by_book: dict[str, list[Row]] = {}
    for s in sessions:
        sessions_by_book.setdefault(s["book_id"], []).append(s)

    # ── 4. Build book progress list ───────────────────────────────────────────
    book_progress_list = []
    for book in books:
        bid = book["id"]
        prog = progress_by_book.get(bid, {})
        chunks_completed = prog.get("chunks_completed", 0)
        total_chunks = book.get("total_chunks") or 1
        avg_score = prog.get("average_score", 0) or 0

        # Estimate avg chunks per session from completed sessions for this book
        book_sessions = sessions_by_book.get(bid, [])
        if book_sessions:
            total_session_chunks = sum(
                (s.get("chunk_end_index", 0) - s.get("chunk_start_index", 0) + 1)
                for s in book_sessions
            )
            avg_chunks_per_session = max(1, total_session_chunks / len(book_sessions))
        else:
            avg_chunks_per_session = 1

        remaining_chunks = max(0, total_chunks - chunks_completed)
        est_sessions_to_finish = (
            round(remaining_chunks / avg_chunks_per_session) if remaining_chunks > 0 else 0
        )

        book_progress_list.append({
            "book_id": bid,
            "title": book["title"],
            "author": book["author"],
            "total_chunks": total_chunks,
            "chunks_completed": chunks_completed,
            "progress_pct": round((chunks_completed / total_chunks) * 100, 1),
            "avg_score": round(avg_score, 1),
            "sessions_completed": len(book_sessions),
            "est_sessions_to_finish": est_sessions_to_finish,
        })

    # ── 5. Score over time (one entry per completed test, keyed by book) ──────
    score_over_time = []
    for result in results:
        matched_session = session_by_id.get(result["session_id"])
        if not matched_session:
            continue
        bid = matched_session["book_id"]
        book_title = title_by_book.get(bid, "Unknown")
        pct = round((result["total_score"] / result["max_score"]) * 100, 1) if result.get("max_score") else 0
        score_over_time.append({
            "date": result["created_at"][:10],  # YYYY-MM-DD
            "score_pct": pct,
            "book_id": bid,
            "book_title": book_title,
        })

    # ── 6. Reading streak ─────────────────────────────────────────────────────
    completed_dates = set()
    for s in sessions:
        if s.get("completed_at"):
            completed_dates.add(s["completed_at"][:10])

    streak = 0
    today = datetime.now(UTC).date()
    check_date = today
    while str(check_date) in completed_dates:
        streak += 1
        check_date -= timedelta(days=1)
    # Also accept if yesterday was last session (streak not broken yet today)
    if streak == 0 and str(today - timedelta(days=1)) in completed_dates:
        check_date = today - timedelta(days=1)
        while str(check_date) in completed_dates:
            streak += 1
            check_date -= timedelta(days=1)

    # ── 7. Words read this week ───────────────────────────────────────────────
    week_start = today - timedelta(days=today.weekday())  # Monday
    words_this_week = sum(
        s.get("assigned_words", 0) or 0
        for s in sessions
        if s.get("completed_at") and s["completed_at"][:10] >= str(week_start)
    )

    # ── 8. Recent evaluator feedback quotes ──────────────────────────────────
    recent_feedback = []
    for result, answer in feedback_rows:
        matched_session = session_by_id.get(result["session_id"])
        recent_feedback.append({
            "feedback": answer["feedback"],
            "score": answer.get("score", 0),
            "max_score": answer.get("max_score", 10),
            "book_title": title_by_book.get(matched_session["book_id"], "Unknown") if matched_session else "Unknown",
            "date": result["created_at"][:10],
        })

    return {
        "book_progress": book_progress_list,
        "score_over_time": score_over_time,
        "reading_streak": streak,
        "words_this_week": words_this_week,
        "recent_feedback": recent_feedback,
    }
