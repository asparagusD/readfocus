"""The bookmark-range quiz through the API (C23.5): POST /focus/{id}/quiz and /quiz/answers on an in-memory
database, with the real grader and the submit_answers flow (evaluator -> knowledge state -> optimizer -> planner)
and a bag-of-words embedder, as test_api_sessions.py runs them."""

import zlib
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.agents import evaluator_agent, optimizer_agent, planner_agent, workflow
from backend.agents.knowledge_state import agent as knowledge_agent
from backend.dependencies import get_current_user
from backend.focus import quiz, store
from backend.main import app
from backend.nlp import embedder
from backend.routers import focus
from backend.services import concept_store, question_bank
from backend.tests.test_api_sessions import FakeDb

USER, BOOK = "user-1", "book-1"
T0 = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)
PROSE = " ".join(["word"] * 600)


def pdf(page):
    return {"kind": "pdf", "page": page, "quads": [[50, 100, 50, 100]], "text": ""}


def bank(chunk_index):
    """Six cloze questions and one why question for a chunk; every one names gravel."""
    rows = [{"id": f"q{chunk_index}-{n}", "user_id": USER, "book_id": BOOK, "chunk_id": f"chunk-{chunk_index}",
             "chunk_index": chunk_index, "type": "factual", "strategy": "cloze", "prompt": f"Fill in {chunk_index}-{n}?",
             "answer": f"answer{chunk_index}x{n}", "evidence": f"Evidence {chunk_index} {n}.", "key_terms": ["gravel"],
             "distractors": [], "difficulty": 0.4, "quality": 0.8, "times_used": 0, "prompt_hash": f"h{n}"}
            for n in range(6)]
    rows.append({**rows[0], "id": f"q{chunk_index}-why", "strategy": "why_how", "type": "inference",
                 "prompt": "Why did the roads stay usable?", "answer": "engineers laid deep foundations of gravel",
                 "evidence": "The roads stayed usable because engineers laid deep foundations of gravel.",
                 "key_terms": ["deep foundations", "gravel"], "prompt_hash": "why"})
    return rows


@pytest.fixture
def api(monkeypatch):
    db = FakeDb()
    db.tables["books"] = [{"id": BOOK, "user_id": USER, "file_type": "pdf", "page_count": 8, "toc": [],
                           "body_start": {"kind": "pdf", "page": 1, "title": "Chapter 1"}}]
    db.tables["chunks"] = [
        {"id": f"chunk-{i}", "book_id": BOOK, "user_id": USER, "chunk_index": i, "content": PROSE, "prose": PROSE,
         "word_count": 600, "anchors": {"kind": "pdf", "pages": [2 * i + 1, 2 * i + 2],
                                        "spans": [{"page": 2 * i + 1, "char_start": 0, "char_end": 1500},
                                                  {"page": 2 * i + 2, "char_start": 0, "char_end": 1500}]}}
        for i in range(4)]
    db.tables["question_bank"] = [*bank(0), *bank(1), *bank(2), *bank(3)]
    db.tables["concepts"] = [{"user_id": USER, "book_id": BOOK, "concept_key": "gravel", "label": "gravel",
                              "chunk_indices": [0, 1, 2, 3], "weight": 1.0}]
    db.tables["reading_progress"] = [{"id": "rp", "user_id": USER, "book_id": BOOK, "chunks_completed": 0,
                                      "re_read_queue": [], "average_score": 60, "pace_recommendation": None}]
    for table in ("focus_sessions", "focus_events", "sessions", "test_results"):
        db.tables[table] = []
    for module in (focus, store, quiz, question_bank, evaluator_agent, concept_store, knowledge_agent, planner_agent,
                   optimizer_agent, workflow):
        monkeypatch.setattr(module, "supabase", db)

    def fake_embed(texts):  # bag of words, as in test_api_sessions
        vectors = np.zeros((len(texts), 64), dtype=np.float32)
        for row, text in enumerate(texts):
            for word in text.lower().split():
                vectors[row, zlib.crc32(word.strip('.,?"').encode()) % 64] += 1.0
        return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-9)

    monkeypatch.setattr(embedder, "embed", fake_embed)
    monkeypatch.setattr(embedder, "get_model", lambda: None)
    clock = SimpleNamespace(t=0.0)
    monkeypatch.setattr(store, "now", lambda: T0 + timedelta(seconds=clock.t))
    generated = []
    monkeypatch.setattr(question_bank.question_agent, "run", lambda book_id, ids: generated.append(list(ids)))
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, db=db, clock=clock, generated=generated)
    app.dependency_overrides.clear()


def read_and_end(api, start=3, end=6, minutes=10):
    """Start at page `start`, read `minutes` with a heartbeat every 25 s, place the bookmark on page `end`."""
    sid = api.client.post("/focus/start", json={"book_id": BOOK, "anchor": pdf(start)}).json()["id"]
    for t in range(0, minutes * 60 + 1, 25):
        api.clock.t = t
        assert api.client.post(f"/focus/{sid}/event", json={"kind": "heartbeat", "had_input": True}).json()["accepted"]
    api.clock.t += 5
    assert api.client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(end)}).status_code == 200
    return sid


def stored_questions(api, sid):
    return next(s for s in api.db.tables["sessions"] if s["id"] == sid)["test_questions"]


def focus_row(api, sid):
    return next(s for s in api.db.tables["focus_sessions"] if s["id"] == sid)


def answer(api, sid, answers):
    return api.client.post(f"/focus/{sid}/quiz/answers", json={"answers": answers, "time_taken_seconds": 90})


# --- building the quiz --------------------------------------------------------------------------------------------

def test_the_quiz_covers_the_range_with_the_scaled_count_and_shows_no_answers(api):
    sid = read_and_end(api)  # pages 3-6: chunks 1 and 2, 1,200 words: 3 questions
    response = api.client.post(f"/focus/{sid}/quiz")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 3 and body["words_in_range"] == 1200 and len(body["questions"]) == 3
    assert all(set(q) <= {"question", "type", "options"} for q in body["questions"])
    stored = stored_questions(api, sid)
    assert {q["chunk_index"] for q in stored} <= {1, 2} and len({q["chunk_index"] for q in stored}) == 2  # spread
    assert all(q["concept_keys"] == ["gravel"] for q in stored)
    row = focus_row(api, sid)
    assert row["words_in_range"] == 1200 and row["quiz_total"] == 3 and len(row["quiz_question_ids"]) == 3
    used = {q["id"]: q["times_used"] for q in api.db.tables["question_bank"]}
    assert sum(used.values()) == 3 and all(used[q["id"]] == 1 for q in stored)
    again = api.client.post(f"/focus/{sid}/quiz").json()  # asked again: the same quiz, nothing counted twice
    assert again["questions"] == body["questions"] and sum(q["times_used"] for q in api.db.tables["question_bank"]) == 3


def test_a_longer_range_asks_more(api):
    sid = read_and_end(api, start=1, end=8)  # 2,400 words: 6 questions
    body = api.client.post(f"/focus/{sid}/quiz").json()
    assert body["count"] == 6 and len(body["questions"]) == 6
    assert sorted({q["chunk_index"] for q in stored_questions(api, sid)}) == [0, 1, 2, 3]


def test_a_range_chunk_without_questions_is_generated_on_the_fly(api):
    api.db.tables["question_bank"] = [q for q in api.db.tables["question_bank"] if q["chunk_index"] != 2]

    def generate(book_id, ids):  # the question generation agent persisting the chunk's rows
        api.generated.append(list(ids))
        api.db.tables["question_bank"].extend(bank(2))

    question_bank.question_agent.run = generate
    sid = read_and_end(api)
    body = api.client.post(f"/focus/{sid}/quiz").json()
    assert api.generated == [["chunk-2"]]
    assert len(body["questions"]) == 3 and 2 in {q["chunk_index"] for q in stored_questions(api, sid)}


def test_a_capped_session_without_a_bookmark_anchor_uses_its_last_place(api):
    sid = read_and_end(api)
    row = focus_row(api, sid)
    row.update(end_anchor=None, end_position=6 * 1_000_000)
    assert api.client.post(f"/focus/{sid}/quiz").json()["words_in_range"] == 1200


def test_no_quiz_before_the_bookmark_and_no_answers_before_the_quiz(api):
    sid = api.client.post("/focus/start", json={"book_id": BOOK, "anchor": pdf(3)}).json()["id"]
    assert api.client.post(f"/focus/{sid}/quiz").status_code == 409
    api.client.post(f"/focus/{sid}/event", json={"kind": "heartbeat"})
    api.clock.t = 30
    api.client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(5)})
    assert answer(api, sid, ["x"]).status_code == 409


# --- answers and scoring ------------------------------------------------------------------------------------------

def test_all_correct_scores_the_session_moves_mastery_and_keeps_the_test(api):
    sid = read_and_end(api)
    api.client.post(f"/focus/{sid}/quiz")
    answers = [q["answer"] for q in stored_questions(api, sid)]
    response = answer(api, sid, answers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "scored" and body["passed"] is True
    assert (body["points_time"], body["points_bonus"], body["points_total"]) == (100, 60, 160)
    # 600 s read; the 5 s between the last heartbeat and the bookmark had no heartbeat.
    assert [line["code"] for line in body["lines"]] == ["counted", "no_heartbeat", "quiz_bonus"]
    assert len(body["per_question"]) == 3 and all("answer" not in q for q in body["per_question"])
    row = focus_row(api, sid)
    assert (row["status"], row["quiz_correct"], row["quiz_total"], row["points_total"]) == ("scored", 3, 3, 160)
    mastery = {m["concept_key"]: m for m in api.db.tables["user_concept_mastery"]}
    assert mastery["gravel"]["last_event_id"] == sid and mastery["gravel"]["correct"] >= 1
    assert mastery["gravel"]["mastery"] > 0.3  # up from the prior
    assert [t["session_id"] for t in api.db.tables["test_results"]] == [sid]


def test_under_40_percent_the_whole_session_earns_nothing(api):
    sid = read_and_end(api)
    api.client.post(f"/focus/{sid}/quiz")
    first = stored_questions(api, sid)[0]["answer"]
    body = answer(api, sid, [first, "", ""]).json()  # 1 of 3
    assert body["passed"] is False and body["points_total"] == 0 and body["points_time"] == 0
    assert body["lines"][-1]["code"] == "quiz_failed"
    row = focus_row(api, sid)
    assert (row["status"], row["quiz_correct"], row["points_total"]) == ("scored", 1, 0)


@pytest.mark.parametrize("grades, passed, bonus", [
    ([("high", 10), ("low", 10), ("high", 0)], True, 30),  # 1.5 of 3: 50 %
    ([("low", 10), ("low", 10), ("high", 0)], False, 0),  # 1 of 3: 33 %
])
def test_a_low_confidence_correct_answer_counts_half(api, monkeypatch, grades, passed, bonus):
    sid = read_and_end(api)
    api.client.post(f"/focus/{sid}/quiz")

    async def graded(*args, **kwargs):
        return {"evaluation_result": {"per_question": [{"score": s, "max_score": 10, "confidence": c} for c, s in grades],
                                      "total_score": 0, "max_score": 30}}

    monkeypatch.setattr(quiz, "run_submit", graded)
    body = answer(api, sid, ["a", "b", "c"]).json()
    assert body["passed"] is passed and body["points_bonus"] == bonus
    assert focus_row(api, sid)["quiz_correct"] == 2


def test_answers_are_graded_once(api, monkeypatch):
    sid = read_and_end(api)
    api.client.post(f"/focus/{sid}/quiz")
    answers = [q["answer"] for q in stored_questions(api, sid)]
    assert answer(api, sid, answers).status_code == 200
    calls = []
    monkeypatch.setattr(quiz, "run_submit", lambda *a, **k: calls.append(1))
    second = answer(api, sid, ["", "", ""])
    assert second.status_code == 409 and calls == [] and focus_row(api, sid)["points_total"] == 160


def test_another_readers_quiz_is_not_found(api):
    sid = read_and_end(api)
    app.dependency_overrides[get_current_user] = lambda: "user-2"
    assert api.client.post(f"/focus/{sid}/quiz").status_code == 404
    assert answer(api, sid, ["x"]).status_code == 404
    assert api.db.tables["sessions"] == []


# --- C23.6b: what the quiz screen and the ready modal need; Steve rests during the quiz (F10) ------------------

def test_the_graded_quiz_carries_the_test_pages_totals_and_the_view_says_the_bookmark_is_set(api):
    sid = read_and_end(api)
    assert api.client.get(f"/focus/{sid}").json()["bookmark_set"] is True
    api.client.post(f"/focus/{sid}/quiz")
    body = answer(api, sid, [q["answer"] for q in stored_questions(api, sid)]).json()
    assert body["max_score"] == 30 and body["total_score"] == 30 and body["percentage"] == 100


def test_steve_is_refused_while_the_focus_quiz_is_open(api, monkeypatch):
    from fastapi import HTTPException

    from backend.routers import steve_ask
    from backend.steve import consent
    monkeypatch.setattr(steve_ask, "supabase", api.db)
    api.db.tables["profiles"] = [{"user_id": USER, "steve_enabled": True, "steve_consent_at": "2026-11-15T09:00:00Z",
                                  "steve_consent_version": consent.CONSENT_VERSION, "reading_goal_wpm": 240}]
    steve_ask._check_reader(USER, BOOK)  # reading: Steve answers
    sid = read_and_end(api)
    api.client.post(f"/focus/{sid}/quiz")
    with pytest.raises(HTTPException) as refused:
        steve_ask._check_reader(USER, BOOK)
    assert refused.value.status_code == 409 and "in_test" in str(refused.value.detail)
    answer(api, sid, [q["answer"] for q in stored_questions(api, sid)])
    steve_ask._check_reader(USER, BOOK)  # answered: Steve is back
