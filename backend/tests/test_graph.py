"""The LangGraph wiring: event routing, the submit chain and its low-confidence skip, on the in-memory database."""

import asyncio

import pytest
from langgraph.graph import END

from backend.agents import (
    evaluator_agent,
    graph,
    optimizer_agent,
    planner_agent,
    workflow,
)
from backend.agents.knowledge_state import agent as knowledge_agent
from backend.services import concept_store, question_bank
from backend.tests.test_api_sessions import BOOK, USER, FakeDb, bank_rows

QUESTIONS = [
    {"id": "q1", "strategy": "cloze", "evidence": "Gravel roads last.", "concept_keys": ["gravel"]},
    {"id": "q2", "strategy": "cloze", "evidence": "Arches carry load.", "concept_keys": ["arch"]},
]


@pytest.fixture
def db(monkeypatch):
    db = FakeDb()
    db.tables["chunks"] = [{"id": f"chunk-{i}", "book_id": BOOK, "user_id": USER, "chunk_index": i,
                            "content": f"text {i}", "word_count": 250} for i in range(5)]
    db.tables["question_bank"] = bank_rows(0, "chunk-0")
    db.tables["reading_progress"] = [{"id": "p1", "user_id": USER, "book_id": BOOK, "last_chunk_index": -1,
                                      "chunks_completed": 0, "re_read_queue": [], "pace_recommendation": None}]
    db.tables["sessions"] = [{"id": "s1", "user_id": USER, "book_id": BOOK, "status": "testing", "assigned_words": 250,
                              "actual_duration_minutes": 3, "started_at": "2026-11-11T09:00:00+00:00"}]
    for module in (planner_agent, optimizer_agent, evaluator_agent, knowledge_agent, question_bank, concept_store):
        monkeypatch.setattr(module, "supabase", db)
    return db


def grades_with(monkeypatch, *confidences):
    def fake(questions, answers, passage=""):
        return [{"answer": a, "score": 5, "max_score": 10, "feedback": "f", "confidence": c, "matched_concepts": [],
                 "missing_concepts": [], "method": "t", "reasons": [], "components": {}}
                for a, c in zip(answers, confidences)]
    monkeypatch.setattr(evaluator_agent, "grade_answers", fake)


def agents(state):
    return [entry["agent"] for entry in state.get("decisions") or []]


def submit(questions=QUESTIONS):
    return asyncio.run(workflow.run_submit("s1", USER, BOOK, [0], questions, ["a", "b"], 120))


# --- routers -------------------------------------------------------------------------------


@pytest.mark.parametrize("event, node", [
    ("start_session", "planner"), ("finish_reading", "test_generator"), ("submit_answers", "evaluator"),
    ("abandon", "optimizer"), ("something_else", END), (None, END),
])
def test_start_routes_on_the_event(event, node):
    assert graph.route_event({"event": event}) == node


def test_after_the_evaluator_an_error_ends_the_run():
    assert graph.after_evaluator({"error": "Missing questions in state."}) == END
    assert graph.after_evaluator({"grades": [{"confidence": "high"}]}) == "knowledge_state"


@pytest.mark.parametrize("confidences, node", [
    (["low", "low"], "planner"), (["low", "medium"], "optimizer"), (["high"], "optimizer"), ([], "optimizer"),
])
def test_after_the_knowledge_state_only_all_low_skips_the_optimizer(confidences, node):
    assert graph.after_knowledge_state({"grades": [{"confidence": c} for c in confidences]}) == node


def test_after_the_optimizer_submit_goes_on_to_plan_and_abandon_ends():
    assert graph.after_optimizer({"event": "submit_answers"}) == "planner"
    assert graph.after_optimizer({"event": "abandon"}) == END


def test_the_compiled_graph_has_exactly_these_edges():
    edges = {(edge.source, edge.target) for edge in graph.workflow.get_graph().edges}
    assert edges == {
        ("__start__", "planner"), ("__start__", "test_generator"), ("__start__", "evaluator"),
        ("__start__", "optimizer"), ("__start__", "__end__"),
        ("planner", "__end__"), ("test_generator", "__end__"),
        ("evaluator", "knowledge_state"), ("evaluator", "__end__"),
        ("knowledge_state", "optimizer"), ("knowledge_state", "planner"),
        ("optimizer", "planner"), ("optimizer", "__end__"),
    }


def test_runs_use_a_recursion_limit_of_ten():
    assert workflow.RUN_CONFIG == {"recursion_limit": 10}


# --- flows on the in-memory database ----------------------------------------------------------


def test_submit_chains_evaluator_knowledge_state_optimizer_then_planner(db, monkeypatch):
    grades_with(monkeypatch, "high", "medium")
    final = submit()
    assert agents(final) == ["evaluator", "knowledge_state", "optimizer", "planner"]
    assert final["evaluation_result"]["percentage"] == 50
    assert {row["concept_key"] for row in db.tables["user_concept_mastery"]} == {"gravel", "arch"}
    assert final["pace_recommendation"]["band"] == "hold"
    assert db.tables["reading_progress"][0]["pace_recommendation"]["band"] == "hold"
    assert final["plan"]["chunk_indices"] == [1, 2]  # the next plan starts after the section just tested


def test_all_low_confidence_grades_skip_the_optimizer(db, monkeypatch):
    grades_with(monkeypatch, "low", "low")
    final = submit()
    assert agents(final) == ["evaluator", "knowledge_state", "planner"]
    assert "pace_recommendation" not in final
    assert db.tables["reading_progress"][0]["pace_recommendation"] is None  # nothing adapted


def test_an_evaluator_error_ends_the_submit_run(db, monkeypatch):
    final = submit(questions=[])
    assert final["error"] and agents(final) == []
    assert "user_concept_mastery" not in db.tables


def test_the_plan_after_submit_is_a_preview_and_start_takes_the_re_read(db, monkeypatch):
    db.tables["reading_progress"][0].update(last_chunk_index=3, re_read_queue=[2])
    grades_with(monkeypatch, "low", "low")  # skip the optimizer, which would change the queue
    final = asyncio.run(workflow.run_submit("s1", USER, BOOK, [3], QUESTIONS, ["a", "b"], 120))
    assert final["plan"]["mode"] == "re_read" and db.tables["reading_progress"][0]["re_read_queue"] == [2]
    plan, _ = asyncio.run(workflow.run_start(USER, BOOK))
    assert plan.chunk_indices == [2] and db.tables["reading_progress"][0]["re_read_queue"] == []


def test_start_runs_only_the_planner(db):
    plan, run = asyncio.run(workflow.run_start(USER, BOOK))
    assert plan.chunk_indices == [0, 1] and agents(run) == ["planner"]


def test_start_returns_none_when_the_planner_fails(db, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("database down")

    monkeypatch.setattr(planner_agent, "load_progress", broken)
    assert asyncio.run(workflow.run_start(USER, BOOK)) == (None, {})


def test_finish_reading_runs_only_the_test_generator(db):
    run = workflow.run_finish("s1", USER, BOOK, [0], None)
    questions = run["test_questions"]
    assert agents(run) == ["test_generator"] and len(questions) == 5 and db.tables["sessions"][0]["test_questions"] == questions


def test_abandon_runs_only_the_optimizer_and_counts_the_session(db):
    db.tables["sessions"][0]["status"] = "abandoned"
    db.tables["sessions"].append({"id": "s0", "user_id": USER, "book_id": BOOK, "status": "abandoned",
                                  "started_at": "2026-11-10T09:00:00+00:00"})
    run = asyncio.run(workflow.run_abandon("s1", USER, BOOK, [0]))
    assert agents(run) == ["optimizer"]
    pace = run["pace_recommendation"]
    assert pace["band"] == "none" and "abandonment" in pace["rules"]
    assert pace["re_read_queue"] == [] and pace["recent_percentages"] == []  # no test, no score


def test_an_unknown_event_runs_nothing():
    final = asyncio.run(graph.workflow.ainvoke({"event": "nope"}, config=workflow.RUN_CONFIG))
    assert agents(final) == []


def test_an_abandoned_re_read_goes_back_to_the_front_of_the_queue(db):
    db.tables["reading_progress"][0].update(last_chunk_index=3, re_read_queue=[2, 1])
    plan, _ = asyncio.run(workflow.run_start(USER, BOOK))
    assert plan.mode == "re_read" and plan.chunk_indices == [2]
    assert db.tables["reading_progress"][0]["re_read_queue"] == [1]
    db.tables["sessions"][0]["status"] = "abandoned"
    asyncio.run(workflow.run_abandon("s1", USER, BOOK, plan.chunk_indices))
    assert db.tables["reading_progress"][0]["re_read_queue"] == [2, 1]  # issue 32: not lost
