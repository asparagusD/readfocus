"""The agents as LangGraph nodes, on the in-memory database: read state, decide, persist, one decision entry."""

import asyncio
import inspect
from datetime import UTC, datetime, timedelta

import pytest

from backend.agents import planner_agent, test_generator_agent
from backend.agents.planner.strategy import SessionPlan
from backend.services import concept_store, question_bank
from backend.tests.test_api_sessions import BOOK, USER, FakeDb, bank_rows

DECISION_KEYS = {"agent", "inputs_summary", "output_summary", "reason", "duration_ms"}


@pytest.fixture
def db(monkeypatch):
    db = FakeDb()
    db.tables["chunks"] = [
        {"id": f"chunk-{i}", "book_id": BOOK, "user_id": USER, "chunk_index": i, "content": f"text {i}",
         "word_count": 250} for i in range(5)
    ]
    db.tables["profiles"] = [{"user_id": USER, "reading_goal_wpm": 100}]
    for module in (planner_agent, question_bank, concept_store):
        monkeypatch.setattr(module, "supabase", db)
    return db


def run_planner(**state):
    return asyncio.run(planner_agent.planner_node({"user_id": USER, "book_id": BOOK, **state}))


def assert_one_decision(result, agent):
    (entry,) = result["decisions"]
    assert set(entry) == DECISION_KEYS and entry["agent"] == agent
    assert entry["duration_ms"] >= 0 and entry["reason"]
    return entry


# --- planner ------------------------------------------------------------------------------


def test_the_planner_creates_the_progress_row_and_plans_from_the_first_section(db):
    result = run_planner()
    (progress,) = db.tables["reading_progress"]
    assert progress["last_chunk_index"] == -1 and progress["re_read_queue"] == []
    assert result["plan"]["chunk_indices"] == [0, 1] and result["chunk_indices"] == [0, 1]
    assert result["plan"]["focus_duration_minutes"] == 10  # 500 words at 100 wpm, raised to the minimum
    assert result["session_plan"]["assigned_words"] == 500
    entry = assert_one_decision(result, "planner")
    assert entry["output_summary"]["mode"] == "new" and entry["inputs_summary"]["last_chunk_index"] == -1
    run_planner()
    assert len(db.tables["reading_progress"]) == 1  # created once


def test_the_planner_continues_after_the_last_section_read(db):
    db.tables["reading_progress"] = [{"id": "p1", "user_id": USER, "book_id": BOOK, "last_chunk_index": 1,
                                      "re_read_queue": [], "pace_recommendation": None}]
    assert run_planner()["chunk_indices"] == [2, 3]


def test_the_planner_uses_the_optimizer_s_pace_and_speed(db):
    db.tables["reading_progress"] = [{"id": "p1", "user_id": USER, "book_id": BOOK, "last_chunk_index": -1,
                                      "re_read_queue": [], "pace_recommendation": {
                                          "next_chunk_multiplier": 1.5, "reading_wpm": 300, "rolling_percentage": 90}}]
    result = run_planner()
    assert result["chunk_indices"] == [0, 1, 2]  # 900 words
    assert result["decisions"][0]["inputs_summary"]["wpm"] == 300


def test_a_re_read_pops_the_queue(db):
    db.tables["reading_progress"] = [{"id": "p1", "user_id": USER, "book_id": BOOK, "last_chunk_index": 3,
                                      "re_read_queue": [2, 0], "pace_recommendation": None}]
    result = run_planner()
    assert result["plan"]["mode"] == "re_read" and result["chunk_indices"] == [2]
    assert db.tables["reading_progress"][0]["re_read_queue"] == [0]


def test_a_weak_concept_brings_its_section_back(db):
    db.tables["reading_progress"] = [{"id": "p1", "user_id": USER, "book_id": BOOK, "last_chunk_index": 2,
                                      "re_read_queue": [], "pace_recommendation": None}]
    db.tables["concepts"] = [{"user_id": USER, "book_id": BOOK, "concept_key": "opportunity-cost",
                              "label": "opportunity cost", "chunk_indices": [1], "weight": 0.9}]
    later = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    db.tables["user_concept_mastery"] = [{"user_id": USER, "book_id": BOOK, "concept_key": "opportunity-cost",
                                          "mastery": 0.2, "attempts": 2, "correct": 0, "next_review": later}]
    result = run_planner()
    assert result["chunk_indices"] == [1]
    assert result["plan"]["reason"] == "Revisiting *opportunity cost* — you missed it twice."


def test_chunk_difficulty_comes_from_the_question_bank(db):
    db.tables["question_bank"] = bank_rows(0, "chunk-0")  # every row 0.3
    result = run_planner()
    scores = {s["index"]: s for s in result["plan"]["scores"]}
    assert scores[0]["components"]["difficulty_fit"] == pytest.approx(0.8)  # target 0.4 with no history


def test_plan_session_returns_the_plan_and_an_empty_one_when_the_book_is_done(db, monkeypatch):
    plan = asyncio.run(planner_agent.plan_session(USER, BOOK))
    assert isinstance(plan, SessionPlan) and plan.chunk_indices == [0, 1]
    db.tables["reading_progress"][0]["last_chunk_index"] = 4
    assert asyncio.run(planner_agent.plan_session(USER, BOOK)).chunk_indices == []


def test_plan_session_returns_none_when_the_planner_fails(db, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("database down")

    monkeypatch.setattr(planner_agent, "load_progress", broken)
    assert asyncio.run(planner_agent.plan_session(USER, BOOK)) is None


# --- test generator -------------------------------------------------------------------------


def test_the_test_generator_stores_a_test_with_the_plan_s_mix(db):
    db.tables["question_bank"] = bank_rows(0, "chunk-0")
    db.tables["sessions"] = [{"id": "s1", "user_id": USER, "book_id": BOOK}]
    mix = [[["cloze"], 3], [["main_idea"], 1], [["why_how"], 1]]
    result = test_generator_agent.test_generator_node({
        "user_id": USER, "book_id": BOOK, "session_id": "s1", "chunk_indices": [0], "plan": {"question_mix": mix},
    })
    strategies = [q["strategy"] for q in result["test_questions"]]
    assert strategies.count("cloze") == 3 and len(strategies) == 5
    assert db.tables["sessions"][0]["test_questions"] == result["test_questions"]
    entry = assert_one_decision(result, "test_generator")
    assert entry["output_summary"]["questions"] == 5


def test_prepare_test_runs_the_node_through_the_workflow(db):
    db.tables["question_bank"] = bank_rows(0, "chunk-0")
    db.tables["sessions"] = [{"id": "s1", "user_id": USER, "book_id": BOOK}]
    questions = test_generator_agent.prepare_test("s1", USER, BOOK, [0], None)
    assert len(questions) == 5 and db.tables["sessions"][0]["test_questions"] == questions


def test_the_test_generator_reports_missing_input():
    result = test_generator_agent.test_generator_node({"user_id": USER, "book_id": BOOK})
    assert result["errors"] and assert_one_decision(result, "test_generator")


# --- no LLM -------------------------------------------------------------------------------------


@pytest.mark.parametrize("module", [planner_agent, test_generator_agent])
def test_the_nodes_use_no_llm(module):
    source = inspect.getsource(module)
    for banned in ("services.llm", "langchain", "ChatPromptTemplate", "_llm", "MOCK"):
        assert banned not in source
