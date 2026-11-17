"""Quiz me through the API (C23.7b, FOCUS_RULES F13): POST /focus/quiz-me builds a quiz from the chapter's start, or
from where the last quiz ended, to the reader's place; /sessions/{id}/submit-answers grades it and moves mastery;
no focus session and no points. Uses the in-memory database and real grader of test_api_focus_quiz.py."""

import pytest

from backend.focus import quiz_me
from backend.routers import sessions
from backend.tests.test_api_focus_quiz import (  # noqa: F401
    BOOK,
    USER,
    answer,
    api,
    pdf,
    read_and_end,
    stored_questions,
)


def end_of(page):
    return {"kind": "pdf", "page": page, "quads": [[0, 700, 0, 700]], "text": ""}


@pytest.fixture
def qm(api, monkeypatch):  # noqa: F811
    monkeypatch.setattr(quiz_me, "supabase", api.db)
    monkeypatch.setattr(sessions, "supabase", api.db)  # submit-answers grades the Quiz me row
    return api


def ask(env, scope, place, book=BOOK):
    return env.client.post("/focus/quiz-me", json={"book_id": book, "scope": scope, "anchor": place})


def row(env, sid):
    return next(s for s in env.db.tables["sessions"] if s["id"] == sid)


def test_this_chapter_runs_from_the_chapters_start_to_the_place_and_grades_with_no_points(qm):
    qm.db.tables["books"][0]["toc"] = [{"title": "One", "page": 1}, {"title": "Two", "page": 5}]
    response = ask(qm, "chapter", end_of(8))
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 3 and all("answer" not in q for q in body["questions"])
    kept = row(qm, body["session_id"])
    assert (kept["status"], kept["chunk_start_index"], kept["chunk_end_index"]) == ("testing", 2, 3)  # pages 5-8
    assert qm.db.tables["focus_sessions"] == []  # Quiz me is not a focus session
    answers = [q["answer"] for q in stored_questions(qm, body["session_id"])]
    graded = qm.client.post(f"/sessions/{body['session_id']}/submit-answers",
                            json={"answers": answers, "time_taken_seconds": 60})
    assert graded.status_code == 200 and graded.json()["percentage"] > 0
    assert not {"points_total", "points_time", "points_bonus"} & set(graded.json())
    mastery = {m["concept_key"]: m for m in qm.db.tables["user_concept_mastery"]}
    assert mastery["gravel"]["last_event_id"] == body["session_id"]


def test_since_my_last_quiz_starts_at_the_last_focus_bookmark(qm):
    sid = read_and_end(qm, start=3, end=6)
    qm.client.post(f"/focus/{sid}/quiz")
    answer(qm, sid, [q["answer"] for q in stored_questions(qm, sid)])
    body = ask(qm, "since_last", end_of(8)).json()
    kept = row(qm, body["session_id"])
    assert (kept["chunk_start_index"], kept["chunk_end_index"]) == (2, 3)  # from p. 6 (chunk 2) to p. 8


def test_since_my_last_quiz_with_no_quiz_yet_starts_at_the_body_start(qm):
    body = ask(qm, "since_last", end_of(4)).json()
    assert row(qm, body["session_id"])["chunk_start_index"] == 0  # the body start is p. 1, chunk 0


def test_since_a_test_starts_after_its_chunks(qm):
    qm.db.tables["sessions"].append({"id": "old", "user_id": USER, "book_id": BOOK, "status": "completed",
                                     "chunk_start_index": 0, "chunk_end_index": 1, "completed_at": "2026-11-14T09:00:00"})
    body = ask(qm, "since_last", end_of(8)).json()
    assert row(qm, body["session_id"])["chunk_start_index"] == 2  # chunk 2 starts on p. 5


def test_nothing_read_since_the_last_quiz_is_refused_kindly(qm):
    sid = read_and_end(qm, start=3, end=6)
    qm.client.post(f"/focus/{sid}/quiz")
    answer(qm, sid, [q["answer"] for q in stored_questions(qm, sid)])
    response = ask(qm, "since_last", pdf(4))  # before the last bookmark
    assert response.status_code == 409 and "Read a little further" in response.json()["detail"]
    assert len(qm.db.tables["sessions"]) == 1


def test_another_readers_book_a_bad_scope_and_extra_keys_are_refused(qm):
    assert ask(qm, "chapter", end_of(4), book="someone-elses").status_code == 404
    assert ask(qm, "everything", end_of(4)).status_code == 422
    extra = qm.client.post("/focus/quiz-me", json={"book_id": BOOK, "scope": "chapter", "anchor": end_of(4),
                                                    "points": 500})
    assert extra.status_code == 422


def test_quiz_me_waits_while_the_book_is_processed_and_makes_nothing(qm):
    qm.db.tables["books"][0].update(status="processing", toc=[{"title": "One", "page": 1}])
    response = ask(qm, "chapter", end_of(4))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "preparing"
    assert "being prepared" in response.json()["detail"]["message"] and qm.db.tables["sessions"] == []
