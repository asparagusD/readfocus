"""Session endpoints on an in-memory database: tests from the question bank, answers graded inline.

No LLM, no network, no real model: the embedder is a bag-of-words fake.
"""

import inspect
import json
import zlib
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.agents import evaluator_agent, optimizer_agent, planner_agent, workflow
from backend.agents.evaluation.feedback import LOW_CONFIDENCE
from backend.agents.knowledge_state import agent as knowledge_agent
from backend.dependencies import get_current_user
from backend.main import app
from backend.nlp import embedder
from backend.routers import sessions
from backend.services import concept_store, question_bank

USER, BOOK = "user-1", "book-1"
SECRETS = ("answer", "evidence", "key_terms", "guidance", "distractors", "cached_eval", "concept_keys")


class RangeError(Exception):
    """What postgrest's APIError looks like for a page that starts past the last row."""

    code = "PGRST103"


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.action = db, name, [], ("select", None)
        self.orders, self.window = [], None

    def select(self, columns="*", count=None):
        return self

    def upsert(self, values, on_conflict=""):
        self.action = ("upsert", (values, on_conflict.split(",")))
        return self

    def range(self, start, end):
        self.window = (start, end)
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

    def is_(self, column, value):
        assert value == "null"
        self.filters.append(lambda r: r.get(column) is None)
        return self

    def neq(self, column, value):
        self.filters.append(lambda r: r.get(column) != value)
        return self

    def lte(self, column, value):
        self.filters.append(lambda r: r.get(column) is not None and r[column] <= value)
        return self

    def overlaps(self, column, values):
        self.filters.append(lambda r: bool(set(r.get(column) or []) & set(values)))
        return self

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def limit(self, count):
        return self

    def execute(self):
        self.db.calls.append((self.name, self.action[0]))
        if self.name in self.db.broken:
            raise RuntimeError(f"{self.name} is down")
        rows = self.db.tables.setdefault(self.name, [])
        kind, values = self.action
        if kind == "insert":
            new = [dict(v, id=v.get("id") or f"{self.name}-{len(rows) + i}")
                   for i, v in enumerate(values if isinstance(values, list) else [values])]
            rows.extend(new)
            return SimpleNamespace(data=json.loads(json.dumps(new)))
        if kind == "upsert":
            new, keys = json.loads(json.dumps(values[0])), values[1]
            for value in new:
                same = [r for r in rows if all(r.get(k) == value[k] for k in keys)]
                same[0].update(value) if same else rows.append(value)
            return SimpleNamespace(data=new)
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if kind == "update":
            for r in matched:
                r.update(json.loads(json.dumps(values)))
        for column, desc in reversed(self.orders):
            if all(column in r for r in matched):  # rows made by these tests have no created_at
                matched.sort(key=lambda r: r[column], reverse=desc)
        total = len(matched)
        if self.window and 0 < self.window[0] >= total:  # PostgREST does not return an empty page here
            raise RangeError("Requested range not satisfiable")
        if self.window:
            matched = matched[self.window[0]:self.window[1] + 1]
        return SimpleNamespace(data=json.loads(json.dumps(matched)), count=total)


class FakeDb:
    def __init__(self):
        self.tables, self.calls, self.broken = {}, [], set()

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
    why = row(7, "why_how", "inference")
    why.update(
        prompt='Why is this so: "The roads stayed usable"?', answer="engineers laid deep foundations of gravel",
        evidence="The roads stayed usable because engineers laid deep foundations of gravel.",
        key_terms=["deep foundations", "gravel"],
    )
    return [
        row(1, "multiple_choice", distractors=["wrong a", "wrong b", "wrong c"]),
        row(2, "multiple_choice", distractors=["wrong d", "wrong e", "wrong f"]),
        row(3, "cloze"), row(4, "cloze"), row(5, "cloze"), row(6, "cloze"),
        why, row(8, "main_idea", "summary"),
    ]


@pytest.fixture
def api(monkeypatch):
    db = FakeDb()
    db.tables["books"] = [{"id": BOOK, "user_id": USER}]
    db.tables["chunks"] = [
        {"id": f"chunk-{i}", "book_id": BOOK, "user_id": USER, "chunk_index": i, "content": f"text {i}",
         "word_count": 2} for i in range(3)
    ]
    db.tables["question_bank"] = bank_rows(0, "chunk-0")
    db.tables["concepts"] = [
        {"user_id": USER, "book_id": BOOK, "concept_key": key, "label": key.replace("-", " "),
         "chunk_indices": indices, "weight": weight}
        for key, indices, weight in (("gravel", [0, 2], 0.5), ("deep-foundation", [0], 0.9), ("gravel-road", [1], 1.0))
    ]
    for module in (sessions, question_bank, evaluator_agent, concept_store, knowledge_agent, planner_agent, optimizer_agent,
                   workflow):
        monkeypatch.setattr(module, "supabase", db)
    embeds = []

    def fake_embed(texts):  # bag of words: texts that share words are close
        embeds.append(list(texts))
        vectors = np.zeros((len(texts), 64), dtype=np.float32)
        for row, text in enumerate(texts):
            for word in text.lower().split():
                vectors[row, zlib.crc32(word.strip('.,?"').encode()) % 64] += 1.0
        return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-9)

    monkeypatch.setattr(embedder, "embed", fake_embed)
    monkeypatch.setattr(embedder, "get_model", lambda: None)

    plan = SimpleNamespace(chunk_indices=[0], assigned_words=600, focus_duration_minutes=20, reason="test")

    async def fake_plan(user_id, book_id):  # the planner node itself is tested in test_graph.py
        planned = {"agent": "planner", "inputs_summary": {}, "output_summary": {"chunk_indices": plan.chunk_indices},
                   "reason": plan.reason, "duration_ms": 1.0}
        return plan, {"event": "start_session", "user_id": user_id, "book_id": book_id, "decisions": [planned]}

    monkeypatch.setattr(sessions, "run_start", fake_plan)
    generated = []
    monkeypatch.setattr(question_bank.question_agent, "run", lambda book_id, ids: generated.append(list(ids)))
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, db=db, plan=plan, generated=generated, embeds=embeds)
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


def test_stored_questions_are_linked_to_the_concepts_of_their_own_chunk(api, monkeypatch):
    start_and_finish(api)
    stored = api.db.tables["sessions"][0]["test_questions"]
    # Strongest first; gravel-road belongs to another chunk; "SECRET-TERM-n" names no concept.
    assert [q["concept_keys"] for q in stored] == [[], [], [], ["deep-foundation", "gravel"], []]

    def broken(*args):
        raise RuntimeError("concepts table is down")

    monkeypatch.setattr(concept_store, "concepts_for_chunks", broken)
    start_and_finish(api)
    again = api.db.tables["sessions"][1]["test_questions"]
    assert len(again) == 5 and all(q["concept_keys"] == [] for q in again)


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
    from backend.agents import test_generator_agent

    assert "generate_test" not in inspect.getsource(sessions)
    assert "services.llm" not in inspect.getsource(test_generator_agent)  # the node is the question bank (C8.4)


# --- grading (C6.4): inline, local, with a confidence ------------------------

GOOD_WHY = "Because engineers laid deep foundations of gravel under them."
# One answer per question of the default test: q0-1 and q0-2 (multiple choice), q0-3 (cloze), q0-7 (why), q0-8 (main idea).
ANSWERS = ["right option 1", "wrong d", "SECRET-ANSWER-0-3", GOOD_WHY, ""]


def submit(api, session_id, answers=ANSWERS, seconds=142):
    return api.client.post(
        f"/sessions/{session_id}/submit-answers", json={"answers": answers, "time_taken_seconds": seconds}
    )


def test_submit_answers_grades_inline_and_returns_confidence_and_feedback(api):
    session_id, _ = start_and_finish(api)
    response = submit(api, session_id)
    assert response.status_code == 200
    body = response.json()
    per_question = body["per_question"]
    assert [q["score"] for q in per_question[:3]] == [10, 0, 10] and per_question[4]["score"] == 0
    assert [q["confidence"] for q in per_question] == ["high", "high", "high", "medium", "high"]
    assert per_question[0]["feedback"] == "Correct — the answer is right option 1."
    assert per_question[3]["feedback"] == "You captured deep foundations and gravel."
    assert per_question[4]["feedback"].startswith("No answer was given.")
    assert 7 <= per_question[3]["score"] <= 10
    assert body["max_score"] == 50 and body["total_score"] == sum(q["score"] for q in per_question)
    assert body["percentage"] == pytest.approx(body["total_score"] / 50 * 100)
    assert body["low_confidence_count"] == 0
    assert body["pace_recommendation"]["band"] == "hold"  # 30 of 50, from the optimizer node (C8.5)
    assert body["next_session"]["chunk_indices"] == [1, 2]  # planned after the test, before the results show
    assert api.db.tables["sessions"][0]["status"] == "completed"


# --- knowledge state (C7.4): a graded test moves the mastery of its concepts --

def mastery_rows(api):
    return {row["concept_key"]: row for row in api.db.tables.get("user_concept_mastery", [])}


def test_a_submitted_test_moves_the_mastery_of_the_concepts_its_questions_name(api):
    session_id, _ = start_and_finish(api)
    body = submit(api, session_id).json()
    rows = mastery_rows(api)  # only the why question names concepts: deep-foundation and gravel
    assert sorted(rows) == ["deep-foundation", "gravel"]
    for row in rows.values():
        assert (row["user_id"], row["book_id"], row["last_event_id"]) == (USER, BOOK, session_id)
        assert row["mastery"] == pytest.approx(0.3 + 0.30 * 0.7)  # a correct answer, up from the prior
        assert (row["attempts"], row["correct"]) == (1, 1) and row["last_seen"] < row["next_review"]
    assert "mastery" not in json.dumps(body)  # the response is unchanged

    # The same session submitted again counts once; a wrong answer in a new session lowers it.
    submit(api, session_id)
    assert mastery_rows(api)["gravel"]["attempts"] == 1
    second, _ = start_and_finish(api)
    submit(api, second, answers=["", "", "", "", ""])
    after = mastery_rows(api)["gravel"]
    assert after["mastery"] == pytest.approx(0.51 * 0.75) and (after["attempts"], after["correct"]) == (2, 1)
    assert after["last_event_id"] == second


def test_a_failing_mastery_update_does_not_change_the_result(api, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("mastery table is down")

    monkeypatch.setattr(knowledge_agent, "record_test", broken)
    session_id, _ = start_and_finish(api)
    response = submit(api, session_id)
    assert response.status_code == 200 and response.json()["max_score"] == 50
    assert mastery_rows(api) == {}


def test_test_results_row_keeps_the_shape_the_results_page_and_dashboard_read(api):
    session_id, _ = start_and_finish(api)
    body = submit(api, session_id).json()
    (row,) = api.db.tables["test_results"]
    assert row["session_id"] == session_id and row["user_id"] == USER and row["time_taken_seconds"] == 142
    assert isinstance(row["total_score"], int) and row["total_score"] == body["total_score"] and row["max_score"] == 50
    assert len(row["questions"]) == len(row["answers"]) == 5
    for answer, sent in zip(row["answers"], ANSWERS):
        assert answer["user_answer"] == sent and answer["question"]["question"]
        assert isinstance(answer["score"], int) and answer["max_score"] == 10 and answer["feedback"]
        assert answer["confidence"] in ("high", "medium", "low")
    # GET /sessions/{id} is what Results.jsx reads after a refresh.
    results = api.client.get(f"/sessions/{session_id}").json()["test_results"]
    assert [a["score"] for a in results["answers"]] == [q["score"] for q in body["per_question"]]
    assert results["answers"][3]["feedback"] == body["per_question"][3]["feedback"]
    assert not any(f'"{key}"' in json.dumps(results) for key in SECRETS)


def test_evaluate_single_grades_inline_caches_and_tells_the_client_nothing(api):
    session_id, _ = start_and_finish(api)
    response = api.client.post(f"/sessions/{session_id}/evaluate-single", json={"index": 3, "answer": GOOD_WHY})
    assert response.status_code == 200 and response.json() == {"status": "graded"}
    cached = api.db.tables["sessions"][0]["test_questions"][3]["cached_eval"]
    assert cached["answer"] == GOOD_WHY and cached["confidence"] == "medium" and cached["score"] >= 7
    assert "BackgroundTasks" not in str(inspect.signature(sessions.evaluate_single))
    assert not hasattr(sessions, "evaluate_single_background")


def test_a_cached_grade_is_reused_for_the_same_answer_and_not_for_a_changed_one(api):
    session_id, _ = start_and_finish(api)
    api.client.post(f"/sessions/{session_id}/evaluate-single", json={"index": 3, "answer": GOOD_WHY})
    api.embeds.clear()
    submit(api, session_id)
    assert api.embeds == []  # the only free-text answer was already graded; closed and empty ones need no model
    api.db.tables["test_results"].clear()
    api.db.tables["sessions"][0]["status"] = "testing"  # a resubmit is now replayed (issue 33): submit afresh
    changed = [*ANSWERS[:3], "They were made of gravel on deep foundations, engineers said.", ""]
    submit(api, session_id, changed)
    assert len(api.embeds) == 1 and changed[3] in api.embeds[0]
    assert api.db.tables["test_results"][0]["answers"][3]["user_answer"] == changed[3]


def test_a_failing_embedder_never_gives_full_marks_and_is_low_confidence(api, monkeypatch):
    def broken(texts):
        raise RuntimeError("model missing")

    monkeypatch.setattr(embedder, "embed", broken)
    session_id, _ = start_and_finish(api)
    body = submit(api, session_id, [*ANSWERS[:3], "It was to do with how they were built, I think.", ""]).json()
    why = body["per_question"][3]
    assert why["confidence"] == "low" and why["score"] < 5 and why["feedback"].startswith(LOW_CONFIDENCE)
    assert body["low_confidence_count"] == 1
    assert [q["score"] for q in body["per_question"][:3]] == [10, 0, 10]  # string matches need no model


def test_missing_answers_count_as_blank(api):
    session_id, _ = start_and_finish(api)
    body = submit(api, session_id, ["right option 1"]).json()
    assert [q["score"] for q in body["per_question"]] == [10, 0, 0, 0, 0] and body["max_score"] == 50
    assert all(q["feedback"].startswith("No answer was given.") for q in body["per_question"][1:])


def test_a_question_with_no_evidence_is_graded_against_the_passage_at_low_confidence(api):
    api.db.tables["question_bank"] = []
    api.db.tables["chunks"][0]["content"] = (
        "Roman engineers laid their roads on deep foundations of gravel. The roads stayed usable for centuries."
    )
    session_id, finished = start_and_finish(api)
    assert len(finished.json()["questions"]) == 1  # the fallback question: no answer, no evidence
    body = submit(api, session_id, ["Roman roads lasted because of their deep gravel foundations."]).json()
    (only,) = body["per_question"]
    assert only["confidence"] == "low" and only["feedback"].startswith(LOW_CONFIDENCE)
    assert "Roman engineers laid their roads" in only["feedback"] and body["low_confidence_count"] == 1


def test_evaluate_single_rejects_an_unknown_session_and_a_bad_index(api):
    session_id, _ = start_and_finish(api)
    assert api.client.post("/sessions/nope/evaluate-single", json={"index": 0, "answer": "x"}).status_code == 404
    assert api.client.post(f"/sessions/{session_id}/evaluate-single", json={"index": 9, "answer": "x"}).status_code == 400


def test_the_evaluator_uses_no_llm():
    source = inspect.getsource(evaluator_agent)
    for banned in ("services.llm", "langchain", "ChatPromptTemplate", "evaluator_llm", "MOCK"):
        assert banned not in source


# --- the workflow's decisions, stored per run (C8.6) -------------------------------------------

def decisions(api, event=None):
    rows = api.db.tables.get("agent_decisions", [])
    return [row for row in rows if event is None or row["event"] == event]


def test_each_run_stores_its_decisions_in_order_under_one_run_id(api):
    session_id, _ = start_and_finish(api)
    submit(api, session_id)
    for event, agents in (("start_session", ["planner"]), ("finish_reading", ["test_generator"]),
                          ("submit_answers", ["evaluator", "knowledge_state", "optimizer", "planner"])):
        rows = decisions(api, event)
        assert [row["agent"] for row in rows] == agents, event
        assert [row["step"] for row in rows] == list(range(1, len(agents) + 1))
        assert len({row["run_id"] for row in rows}) == 1
        assert all((row["user_id"], row["book_id"], row["session_id"]) == (USER, BOOK, session_id) for row in rows)
        assert all(row["reason"] and row["duration_ms"] is not None for row in rows)
    assert len({row["run_id"] for row in decisions(api)}) == 3


def test_a_failing_decisions_insert_changes_no_response(api):
    api.db.broken.add("agent_decisions")
    session_id, _ = start_and_finish(api)
    response = submit(api, session_id)
    assert response.status_code == 200 and response.json()["max_score"] == 50


def test_the_responses_keep_the_keys_the_pages_read(api):
    start = api.client.post("/sessions/start", json={"book_id": BOOK}).json()
    assert set(start) == {"session_id", "chunk_indices", "focus_duration_minutes", "reason", "chunks", "position", "book",
                          "chapter_before"}
    finished = api.client.post(f"/sessions/{start['session_id']}/finish-reading", json={"actual_duration_minutes": 3})
    assert set(finished.json()) == {"test_id", "questions"}
    body = submit(api, start["session_id"]).json()
    assert {"total_score", "max_score", "percentage", "per_question", "low_confidence_count",
            "pace_recommendation"} <= set(body)


def test_abandon_runs_the_optimizer_and_keeps_its_response(api):
    session_id = api.client.post("/sessions/start", json={"book_id": BOOK}).json()["session_id"]
    response = api.client.post(f"/sessions/{session_id}/abandon")
    assert response.status_code == 200 and response.json() == {"status": "abandoned"}
    (row,) = decisions(api, "abandon")
    assert row["agent"] == "optimizer" and row["session_id"] == session_id
    (progress,) = api.db.tables["reading_progress"]
    assert progress["pace_recommendation"]["band"] == "none"


# --- a session is graded once (issue 33) ----------------------------------------------------------

def test_a_resubmitted_session_returns_the_stored_result_and_runs_nothing_again(api):
    session_id, _ = start_and_finish(api)
    first = submit(api, session_id).json()
    progress = json.dumps(api.db.tables["reading_progress"])
    again = submit(api, session_id, answers=["", "", "", "", ""])
    assert again.status_code == 200
    body = again.json()
    for key in ("total_score", "max_score", "percentage", "per_question", "low_confidence_count"):
        assert body[key] == first[key], key
    assert body["pace_recommendation"]["band"] == first["pace_recommendation"]["band"]
    assert len(api.db.tables["test_results"]) == 1
    assert len({row["run_id"] for row in decisions(api, "submit_answers")}) == 1  # one graph run
    assert json.dumps(api.db.tables["reading_progress"]) == progress  # pace and queue untouched


def test_a_failed_grading_releases_the_session_for_another_try(api, monkeypatch):
    session_id, _ = start_and_finish(api)
    real, broken = sessions.run_submit, {"on": True}

    async def sometimes_failing(*args, **kwargs):
        return {"error": "Missing questions in state."} if broken["on"] else await real(*args, **kwargs)

    monkeypatch.setattr(sessions, "run_submit", sometimes_failing)
    assert submit(api, session_id).status_code == 500
    assert api.db.tables["sessions"][0]["status"] == "testing"
    broken["on"] = False
    assert submit(api, session_id).status_code == 200


def test_a_completed_session_with_no_stored_result_is_a_conflict(api):
    session_id, _ = start_and_finish(api)
    api.db.tables["sessions"][0]["status"] = "completed"
    response = submit(api, session_id)
    assert response.status_code == 409 and "already" in response.json()["detail"]


# --- a session's test is assembled once (issue 34) ------------------------------------------------

def test_a_second_assembly_returns_the_stored_test_and_counts_nothing(api):
    session_id = api.client.post("/sessions/start", json={"book_id": BOOK}).json()["session_id"]
    stored = api.db.tables["sessions"][0]["test_questions"]  # the background run at start
    uses = {row["id"]: row["times_used"] for row in api.db.tables["question_bank"]}
    again = question_bank.assemble_session_test(session_id, USER, BOOK, [0], [(["cloze"], 5)])  # a different mix
    assert again == stored and api.db.tables["sessions"][0]["test_questions"] == stored
    assert {row["id"]: row["times_used"] for row in api.db.tables["question_bank"]} == uses


def test_finish_reading_shows_the_test_that_is_graded(api):
    session_id = api.client.post("/sessions/start", json={"book_id": BOOK}).json()["session_id"]
    api.db.tables["sessions"][0]["test_questions"] = None  # as if the background run had not stored yet
    shown = api.client.post(f"/sessions/{session_id}/finish-reading", json={"actual_duration_minutes": 3}).json()
    stored = api.db.tables["sessions"][0]["test_questions"]
    assert [q["question"] for q in shown["questions"]] == [q["question"] for q in stored]


def test_start_reads_the_chunks_and_creates_the_session_at_once(api, monkeypatch):
    """The chunk read and the session insert do not depend on each other, so they overlap (C9.4)."""
    import threading
    import time

    real_execute = Query.execute
    spans, lock = {}, threading.Lock()

    def timed(self):
        key = (self.name, self.action[0])
        if key not in {("chunks", "select"), ("sessions", "insert")} or key in spans:
            return real_execute(self)
        began = time.perf_counter()
        time.sleep(0.2)
        try:
            return real_execute(self)
        finally:
            with lock:
                spans[key] = (began, time.perf_counter())

    monkeypatch.setattr(Query, "execute", timed)
    resp = api.client.post("/sessions/start", json={"book_id": BOOK})
    assert resp.status_code == 200 and [c["chunk_index"] for c in resp.json()["chunks"]] == [0]
    (read_start, read_end), (insert_start, insert_end) = spans[("chunks", "select")], spans[("sessions", "insert")]
    assert read_start < insert_end and insert_start < read_end  # the two calls overlap in time


# Issue 17 (C15.2): /sessions/start served any book whose id the caller knew.
OTHER_BOOK = "book-of-user-2"


def other_users_book(api):
    api.db.tables["books"].append({"id": OTHER_BOOK, "user_id": "user-2"})
    api.db.tables["chunks"] += [{"id": f"secret-{i}", "book_id": OTHER_BOOK, "user_id": "user-2", "chunk_index": i,
                                 "content": f"user 2's private text {i}", "word_count": 4} for i in range(3)]


def test_start_refuses_a_book_that_is_not_the_callers(api):
    other_users_book(api)
    response = api.client.post("/sessions/start", json={"book_id": OTHER_BOOK})
    assert response.status_code == 404
    assert "private text" not in response.text
    assert api.db.tables.get("sessions", []) == []  # no session row on someone else's book
    assert ("chunks", "select") not in api.db.calls


def test_start_refuses_a_book_that_does_not_exist(api):
    assert api.client.post("/sessions/start", json={"book_id": "no-such-book"}).status_code == 404


def test_start_fails_closed_when_ownership_cannot_be_checked(api):
    api.db.broken.add("books")
    response = api.client.post("/sessions/start", json={"book_id": BOOK})
    assert response.status_code == 503
    assert api.db.tables.get("sessions", []) == []
