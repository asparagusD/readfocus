"""Session endpoints serve tests from the question bank, on an in-memory database. No LLM, no network."""

import inspect
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import sessions
from backend.services import question_bank

USER, BOOK = "user-1", "book-1"
SECRETS = ("answer", "evidence", "key_terms", "guidance", "distractors", "cached_eval")


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.action = db, name, [], ("select", None)

    def select(self, columns="*"):
        return self

    def insert(self, values):
        self.action = ("insert", values)
        return self

    def update(self, values):
        self.action = ("update", values)
        return self

    def eq(self, column, value):
        self.filters.append(lambda r: r.get(column) == value)
        return self

    def in_(self, column, values):
        self.filters.append(lambda r: r.get(column) in values)
        return self

    def execute(self):
        self.db.calls.append((self.name, self.action[0]))
        rows = self.db.tables.setdefault(self.name, [])
        kind, values = self.action
        if kind == "insert":
            new = [dict(v, id=v.get("id") or f"{self.name}-{len(rows) + i}")
                   for i, v in enumerate(values if isinstance(values, list) else [values])]
            rows.extend(new)
            return SimpleNamespace(data=json.loads(json.dumps(new)))
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if kind == "update":
            for r in matched:
                r.update(json.loads(json.dumps(values)))
        return SimpleNamespace(data=json.loads(json.dumps(matched)))


class FakeDb:
    def __init__(self):
        self.tables, self.calls = {}, []

    def table(self, name):
        return Query(self, name)


def bank_rows(chunk_index, chunk_id):
    def row(n, strategy, type_="factual", distractors=()):
        return {
            "id": f"q{chunk_index}-{n}", "user_id": USER, "book_id": BOOK, "chunk_id": chunk_id,
            "chunk_index": chunk_index, "type": type_, "strategy": strategy, "prompt": f"Prompt {chunk_index}-{n}?",
            # The right option of a multiple-choice question is shown, unmarked, among the options.
            "answer": f"right option {n}" if distractors else f"SECRET-ANSWER-{chunk_index}-{n}", "evidence": f"SECRET-EVIDENCE-{chunk_index}-{n}",
            "key_terms": [f"SECRET-TERM-{n}"], "distractors": list(distractors), "difficulty": 0.3,
            "quality": 0.8, "times_used": 0, "prompt_hash": f"h{n}",
        }
    return [
        row(1, "multiple_choice", distractors=["wrong a", "wrong b", "wrong c"]),
        row(2, "multiple_choice", distractors=["wrong d", "wrong e", "wrong f"]),
        row(3, "cloze"), row(4, "cloze"), row(5, "cloze"), row(6, "cloze"),
        row(7, "why_how", "inference"), row(8, "main_idea", "summary"),
    ]


@pytest.fixture
def api(monkeypatch):
    db = FakeDb()
    db.tables["chunks"] = [
        {"id": f"chunk-{i}", "book_id": BOOK, "user_id": USER, "chunk_index": i, "content": f"text {i}",
         "word_count": 2} for i in range(3)
    ]
    db.tables["question_bank"] = bank_rows(0, "chunk-0")
    for module in (sessions, question_bank):
        monkeypatch.setattr(module, "supabase", db)
    plan = SimpleNamespace(chunk_indices=[0], assigned_words=600, focus_duration_minutes=20, reason="test")

    async def fake_plan(user_id, book_id):
        return plan

    monkeypatch.setattr(sessions, "plan_session", fake_plan)
    generated = []
    monkeypatch.setattr(question_bank.question_agent, "run", lambda book_id, ids: generated.append(list(ids)))
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, db=db, plan=plan, generated=generated)
    app.dependency_overrides.clear()


def start_and_finish(api):
    session_id = api.client.post("/sessions/start", json={"book_id": BOOK}).json()["session_id"]
    finished = api.client.post(f"/sessions/{session_id}/finish-reading", json={"actual_duration_minutes": 3})
    assert finished.status_code == 200
    return session_id, finished


def test_finish_reading_returns_five_questions_from_the_bank(api):
    session_id, finished = start_and_finish(api)
    body = finished.json()
    assert body["test_id"] == session_id and len(body["questions"]) == 5
    assert all(set(q) <= {"question", "type", "options"} for q in body["questions"])
    assert [q["type"] for q in body["questions"]] == ["factual", "factual", "factual", "inference", "summary"]
    assert sorted(len(q.get("options", [])) for q in body["questions"]) == [0, 0, 0, 4, 4]
    stored = api.db.tables["sessions"][0]
    assert stored["status"] == "testing" and stored["actual_duration_minutes"] == 3
    assert [q["id"] for q in stored["test_questions"]] == ["q0-1", "q0-2", "q0-3", "q0-7", "q0-8"]
    assert stored["test_questions"][2]["answer"] == "SECRET-ANSWER-0-3"  # kept server-side for grading
    assert "right option 1" in body["questions"][0]["options"]


def test_no_answer_or_evidence_reaches_the_client(api):
    session_id, finished = start_and_finish(api)
    session = api.client.get(f"/sessions/{session_id}")
    assert [q["question"] for q in session.json()["test_questions"]] == [
        q["question"] for q in finished.json()["questions"]
    ]
    api.db.tables["sessions"][0]["status"] = "completed"
    questions = api.db.tables["sessions"][0]["test_questions"]
    api.db.tables["test_results"] = [{
        "id": "r1", "session_id": session_id, "user_id": USER, "total_score": 40, "max_score": 50,
        "questions": questions,
        "answers": [{"question": q, "user_answer": "mine", "score": 8, "feedback": "ok"} for q in questions],
    }]
    completed = api.client.get(f"/sessions/{session_id}")
    results = completed.json()["test_results"]
    assert results["answers"][0]["question"]["question"] == questions[0]["question"]
    assert results["answers"][0]["user_answer"] == "mine" and results["total_score"] == 40
    for payload in (finished.text, session.text, completed.text):
        assert "SECRET" not in payload
        assert not any(f'"{key}"' in payload for key in SECRETS)


def test_times_used_goes_up_and_the_next_test_prefers_unused_questions(api):
    start_and_finish(api)
    used = {r["id"]: r["times_used"] for r in api.db.tables["question_bank"]}
    assert sorted(i for i, n in used.items() if n == 1) == ["q0-1", "q0-2", "q0-3", "q0-7", "q0-8"]
    start_and_finish(api)
    second = [q["id"] for q in api.db.tables["sessions"][1]["test_questions"]]
    # Each place of the mix takes its least-used question: a fresh cloze, and the only ones there are elsewhere.
    assert second == ["q0-1", "q0-2", "q0-4", "q0-7", "q0-8"]
    assert sum(r["times_used"] for r in api.db.tables["question_bank"]) == 10


def test_the_test_is_ready_before_finish_reading_and_not_assembled_twice(api):
    session_id = api.client.post("/sessions/start", json={"book_id": BOOK}).json()["session_id"]
    assert len(api.db.tables["sessions"][0]["test_questions"]) == 5  # built in the background at start
    api.db.calls.clear()
    api.client.post(f"/sessions/{session_id}/finish-reading", json={"actual_duration_minutes": 3})
    assert api.db.calls == [("sessions", "update")]  # one round trip
    assert sum(r["times_used"] for r in api.db.tables["question_bank"]) == 5


def test_a_chunk_with_no_bank_rows_is_generated_on_demand(api):
    api.plan.chunk_indices = [0, 1]
    api.db.tables["question_bank"] = []

    def generate(book_id, chunk_ids):
        api.generated.append(list(chunk_ids))
        for chunk_id in chunk_ids:
            api.db.tables["question_bank"].extend(bank_rows(int(chunk_id[-1]), chunk_id))

    question_bank.question_agent.run = generate
    _, finished = start_and_finish(api)
    assert api.generated == [["chunk-0", "chunk-1"]]
    assert len(finished.json()["questions"]) == 5
    chunks = {q["chunk_index"] for q in api.db.tables["sessions"][0]["test_questions"]}
    assert chunks == {0, 1}


def test_an_empty_bank_still_gives_a_test(api):
    api.db.tables["question_bank"] = []
    _, finished = start_and_finish(api)
    assert api.generated == [["chunk-0"]]
    questions = finished.json()["questions"]
    assert len(questions) == 1 and questions[0]["type"] == "summary"


def test_finish_reading_of_an_unknown_session_is_404(api):
    assert api.client.post("/sessions/nope/finish-reading", json={"actual_duration_minutes": 1}).status_code == 404


def test_the_session_router_no_longer_uses_the_llm_test_generator():
    source = inspect.getsource(sessions)
    assert "test_generator_agent" not in source and "generate_test" not in source
