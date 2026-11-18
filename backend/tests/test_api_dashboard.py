"""GET /dashboard on an in-memory database: the same response as before C9.4, with fewer and lighter reads.

The expected response was recorded from the pre-C9.4 endpoint on this data set (a characterization
test), with the clock frozen on Wednesday 2026-11-11.
"""

import time
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import dashboard, progress
from backend.services import reading_place
from backend.tests.memory_db import MemoryDb

USER = "user-1"


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 11, 11, 15, 0, tzinfo=UTC)


def session(sid, book, start, end, words, completed, status="completed"):
    return {"id": sid, "user_id": USER, "book_id": book, "status": status, "chunk_start_index": start,
            "chunk_end_index": end, "assigned_words": words, "started_at": f"{completed}T09:00:00+00:00",
            "completed_at": f"{completed}T09:30:00+00:00" if completed else None}


def result(sid, score, day, answers):
    return {"session_id": sid, "user_id": USER, "total_score": score, "max_score": 50,
            "created_at": f"{day}T09:31:00+00:00", "answers": answers}


def feedback(text, score=5):
    return {"feedback": text, "score": score, "max_score": 10, "question": {"question": "q"}}


def data():
    return {
        "books": [
            {"id": "b1", "user_id": USER, "title": "Book One", "author": "A", "total_chunks": 10, "total_words": 6000, "status": "ready"},
            {"id": "b2", "user_id": USER, "title": "Book Two", "author": "B", "total_chunks": 4, "total_words": 2400, "status": "ready"},
            {"id": "b3", "user_id": USER, "title": "Book Three", "author": "C", "total_chunks": 0, "total_words": 0, "status": "processing"},
            {"id": "bx", "user_id": "user-2", "title": "Not mine", "author": "D", "total_chunks": 3, "total_words": 900, "status": "ready"},
        ],
        "reading_progress": [
            {"user_id": USER, "book_id": "b1", "chunks_completed": 3, "average_score": 62.5},
            {"user_id": USER, "book_id": "b2", "chunks_completed": 1, "average_score": 40},
        ],
        "sessions": [
            session("s1", "b1", 0, 1, 1000, "2026-11-09"),
            session("s2", "b1", 2, 2, 500, "2026-11-10"),
            session("s3", "b2", 0, 0, 600, "2026-11-11"),
            session("s4", "b1", 3, 3, 500, None, status="reading"),
            session("s5", "b2", 1, 1, 400, "2026-11-01"),
        ],
        "test_results": [
            result("s5", 30, "2026-11-01", [feedback("Old feedback"), feedback("Older feedback")]),
            result("sx", 10, "2026-11-08", [feedback("Orphan result")]),
            result("s1", 40, "2026-11-09", [feedback("Good grasp of the opening.", 8), {"score": 2, "max_score": 10}]),
            result("s2", 25, "2026-11-10", [feedback("Missed the key term.", 3)]),
            result("s3", 20, "2026-11-11", []),
        ],
        "focus_sessions": [],
        # C32.4: the streak is the gamification streak (G7): 3 goal days, the last one today
        "user_progress": [{"user_id": USER, "timezone": "UTC", "streak_days": 3, "streak_freezes": 0,
                           "last_goal_day": "2026-11-11"}],
        # C32.2: words read come from reading_days in the reader's week (Monday 2026-11-09 on), not the quizzes
        "reading_days": [
            {"user_id": USER, "book_id": "b1", "day": "2026-11-09", "words": 1000},
            {"user_id": USER, "book_id": "b1", "day": "2026-11-10", "words": 500},
            {"user_id": USER, "book_id": "b2", "day": "2026-11-11", "words": 600},
            {"user_id": USER, "book_id": "b1", "day": "2026-11-08", "words": 999},  # last week
            {"user_id": "user-2", "book_id": "bx", "day": "2026-11-10", "words": 777},  # another reader's
        ],
    }


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    fake.tables = data()
    monkeypatch.setattr(dashboard, "supabase", fake)
    monkeypatch.setattr(dashboard, "datetime", FrozenDatetime)
    monkeypatch.setattr(reading_place, "supabase", fake)
    monkeypatch.setattr(reading_place, "datetime", FrozenDatetime)
    monkeypatch.setattr(progress, "supabase", fake)
    monkeypatch.setattr(progress, "_now", FrozenDatetime.now)
    app.dependency_overrides[get_current_user] = lambda: USER
    yield fake
    app.dependency_overrides.clear()


def get(db):
    resp = TestClient(app).get("/dashboard")
    assert resp.status_code == 200
    return resp.json()


EXPECTED = {  # recorded from the pre-C9.4 endpoint (83b4f1f) on data() with the clock frozen
    "book_progress": [
        {"book_id": "b1", "title": "Book One", "author": "A", "total_chunks": 10, "chunks_completed": 3,
         "progress_pct": 30.0, "avg_score": 62.5, "sessions_completed": 2, "est_sessions_to_finish": 5},
        {"book_id": "b2", "title": "Book Two", "author": "B", "total_chunks": 4, "chunks_completed": 1,
         "progress_pct": 25.0, "avg_score": 40, "sessions_completed": 2, "est_sessions_to_finish": 3},
    ],
    "score_over_time": [
        {"date": "2026-11-01", "score_pct": 60.0, "book_id": "b2", "book_title": "Book Two"},
        {"date": "2026-11-09", "score_pct": 80.0, "book_id": "b1", "book_title": "Book One"},
        {"date": "2026-11-10", "score_pct": 50.0, "book_id": "b1", "book_title": "Book One"},
        {"date": "2026-11-11", "score_pct": 40.0, "book_id": "b2", "book_title": "Book Two"},
    ],
    "reading_streak": 3,
    "words_this_week": 2100,
    "recent_feedback": [
        {"feedback": "Missed the key term.", "score": 3, "max_score": 10, "book_title": "Book One", "date": "2026-11-10"},
        {"feedback": "Good grasp of the opening.", "score": 8, "max_score": 10, "book_title": "Book One",
         "date": "2026-11-09"},
        {"feedback": "Orphan result", "score": 5, "max_score": 10, "book_title": "Unknown", "date": "2026-11-08"},
    ],
    "focus_this_week": {"seconds": 0, "points": 0, "sessions": 0},  # C23.7c: no focus sessions in this data set
}


def test_the_response_is_unchanged(db):
    assert get(db) == EXPECTED


def test_answers_are_read_only_for_the_latest_results(db):
    get(db)
    with_answers = [s for s in db.selects if s[0] == "test_results" and "answers" in s[1]]
    assert with_answers, "the recent feedback still needs some answers"
    assert all(window is not None for _, _, window in with_answers)  # never every result's answers
    assert all("answers" not in s[1] for s in db.selects if s[0] == "test_results" and s[2] is None)


def test_the_reads_are_issued_at_once(db):
    db.delay = 0.15
    began = time.perf_counter()
    get(db)
    elapsed = time.perf_counter() - began
    reads = sum(1 for s in db.selects)
    assert reads >= 5
    assert elapsed < 0.15 * (reads - 1)  # one after another would take at least reads x 0.15 s


def test_feedback_pages_on_until_it_has_three_quotes(db, monkeypatch):
    monkeypatch.setattr(dashboard, "FEEDBACK_PAGE", 1)  # one result per read: needs several pages
    assert get(db)["recent_feedback"] == EXPECTED["recent_feedback"]
    pages = [s for s in db.selects if s[0] == "test_results" and "answers" in s[1]]
    assert len(pages) == 4  # s3 has no feedback, then s2, s1 and the orphan result


def focus(status, active, voided, points, started):
    return {"user_id": USER, "status": status, "active_seconds": active, "voided_seconds": voided,
            "points_total": points, "started_at": f"{started}T20:00:00+00:00"}


def test_focus_this_week_counts_focused_time_and_scored_points(db):
    """C23.7c: counted seconds of this week's sessions (not discarded ones), points only once scored."""
    db.tables["focus_sessions"] = [
        focus("scored", 3600, 600, 540, "2026-11-10"),  # 50 counted minutes, 540 points
        focus("awaiting_quiz", 1200, 0, 0, "2026-11-11"),  # 20 minutes; provisional points not counted yet
        focus("abandoned", 900, 0, 0, "2026-11-11"),  # discarded: nothing
        focus("scored", 3600, 0, 700, "2026-11-08"),  # last week
        {**focus("scored", 3600, 0, 700, "2026-11-10"), "user_id": "user-2"},  # another reader
    ]
    assert get(db)["focus_this_week"] == {"seconds": 4200, "points": 540, "sessions": 2}


def test_only_books_opened_are_in_progress(db):
    """C32.2 (issue 4): a ready book with no reading_progress row (never opened) is left out."""
    db.tables["reading_progress"] = [r for r in db.tables["reading_progress"] if r["book_id"] == "b1"]
    assert [b["book_id"] for b in get(db)["book_progress"]] == ["b1"]


def test_words_read_this_week_is_0_when_the_table_is_not_there_yet(db, monkeypatch):
    table = db.table
    monkeypatch.setattr(db, "table", lambda name: (_ for _ in ()).throw(RuntimeError("no reading_days"))
                        if name == "reading_days" else table(name))
    assert get(db)["words_this_week"] == 0


def test_the_streak_is_the_headers_not_one_of_its_own(db):
    """C32.4 (issue 7): quizzes on three days in a row no longer make a streak; the daily goal does (G7)."""
    db.tables["user_progress"] = []
    assert get(db)["reading_streak"] == 0  # sessions s1-s3 completed 9-11 Nov, but no goal day
    db.tables["user_progress"] = [{"user_id": USER, "timezone": "UTC", "streak_days": 5, "streak_freezes": 1,
                                   "last_goal_day": "2026-11-09"}]  # 10 Nov missed and frozen, 11 Nov not over
    assert get(db)["reading_streak"] == 5

