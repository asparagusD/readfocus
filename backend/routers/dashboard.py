from typing import Any, cast
from fastapi import APIRouter, Depends
from datetime import datetime, timedelta, timezone
from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase

Row = dict[str, Any]

router = APIRouter()

@router.get("")
async def get_dashboard(user_id: str = Depends(get_current_user)):
    """
    Single endpoint that aggregates all dashboard data for the current user.
    """

    # ── 1. All books with reading progress ───────────────────────────────────
    books_resp = supabase.table("books").select(
        "id, title, author, total_chunks, total_words, status"
    ).eq("user_id", user_id).eq("status", "ready").execute()
    books: list[Row] = cast(list[Row], books_resp.data or [])
    book_ids = [b["id"] for b in books]

    progress_resp = supabase.table("reading_progress").select(
        "book_id, chunks_completed, average_score"
    ).eq("user_id", user_id).execute()
    progress_data: list[Row] = cast(list[Row], progress_resp.data or [])
    progress_by_book = {p["book_id"]: p for p in progress_data}

    # ── 2. All completed sessions ─────────────────────────────────────────────
    sessions_resp = supabase.table("sessions").select(
        "id, book_id, assigned_words, completed_at, started_at, chunk_start_index, chunk_end_index"
    ).eq("user_id", user_id).eq("status", "completed").order("completed_at", desc=False).execute()
    sessions: list[Row] = cast(list[Row], sessions_resp.data or [])

    # ── 3. All test_results ───────────────────────────────────────────────────
    results_resp = supabase.table("test_results").select(
        "session_id, total_score, max_score, created_at, answers"
    ).eq("user_id", user_id).order("created_at", desc=False).execute()
    results: list[Row] = cast(list[Row], results_resp.data or [])
    results_by_session = {r["session_id"]: r for r in results}

    # ── 4. Build book progress list ───────────────────────────────────────────
    book_progress_list = []
    for book in books:
        bid = book["id"]
        prog = progress_by_book.get(bid, {})
        chunks_completed = prog.get("chunks_completed", 0)
        total_chunks = book.get("total_chunks") or 1
        avg_score = prog.get("average_score", 0) or 0

        # Estimate avg chunks per session from completed sessions for this book
        book_sessions = [s for s in sessions if s["book_id"] == bid]
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
        session = results_by_session.get(result["session_id"])
        # Find book_id from session
        matched_session = next((s for s in sessions if s["id"] == result["session_id"]), None)
        if not matched_session:
            continue
        bid = matched_session["book_id"]
        book_title = next((b["title"] for b in books if b["id"] == bid), "Unknown")
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
    today = datetime.now(timezone.utc).date()
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
    sorted_results = sorted(results, key=lambda r: r.get("created_at", ""), reverse=True)
    for result in sorted_results:
        answers = result.get("answers") or []
        for answer in answers:
            if isinstance(answer, dict) and answer.get("feedback"):
                # Attach the book title for context
                matched_session = next((s for s in sessions if s["id"] == result["session_id"]), None)
                book_title = "Unknown"
                if matched_session:
                    book_title = next((b["title"] for b in books if b["id"] == matched_session["book_id"]), "Unknown")
                recent_feedback.append({
                    "feedback": answer["feedback"],
                    "score": answer.get("score", 0),
                    "max_score": answer.get("max_score", 10),
                    "book_title": book_title,
                    "date": result["created_at"][:10],
                })
                if len(recent_feedback) >= 3:
                    break
        if len(recent_feedback) >= 3:
            break

    return {
        "book_progress": book_progress_list,
        "score_over_time": score_over_time,
        "reading_streak": streak,
        "words_this_week": words_this_week,
        "recent_feedback": recent_feedback,
    }
