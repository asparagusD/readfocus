"""The agents as LangGraph nodes, on the in-memory database: read state, decide, persist, one decision entry."""

import asyncio
import inspect
from datetime import UTC, datetime, timedelta

import pytest

from backend.agents import optimizer_agent, planner_agent, policy, test_generator_agent
from backend.agents.knowledge_state import agent as knowledge_agent
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
    state = {"user_id": USER, "book_id": BOOK, "event": "start_session", **state}
    return asyncio.run(planner_agent.planner_node(state))


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
    run_planner(event="submit_answers")  # a preview after a test leaves the queue alone
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


def test_the_test_generator_reports_missing_input():
    result = test_generator_agent.test_generator_node({"user_id": USER, "book_id": BOOK})
    assert result["errors"] and assert_one_decision(result, "test_generator")


# --- no LLM -------------------------------------------------------------------------------------


@pytest.mark.parametrize("module", [planner_agent, test_generator_agent])
def test_the_nodes_use_no_llm(module):
    source = inspect.getsource(module)
    for banned in ("services.llm", "langchain", "ChatPromptTemplate", "_llm", "MOCK"):
        assert banned not in source


# --- knowledge state (C8.4b) -------------------------------------------------------------------

GRADED = {"per_question": [{"score": 10, "max_score": 10, "confidence": "high"},
                           {"score": 0, "max_score": 10, "confidence": "high"}]}
QUESTIONS = [{"id": "q1", "strategy": "cloze", "concept_keys": ["gravel"]},
             {"id": "q2", "strategy": "cloze", "concept_keys": ["arch"]}]


@pytest.fixture
def kdb(db, monkeypatch):
    for module in (knowledge_agent, optimizer_agent):
        monkeypatch.setattr(module, "supabase", db)
    return db


def submit_state(**extra):
    return {"user_id": USER, "book_id": BOOK, "session_id": "s2", "chunk_indices": [3],
            "test_questions": QUESTIONS, "evaluation_result": GRADED, **extra}


def test_the_knowledge_state_node_moves_mastery_and_reports_the_rows(kdb):
    result = knowledge_agent.knowledge_state_node(submit_state())
    assert sorted(u["concept_key"] for u in result["mastery_updates"]) == ["arch", "gravel"]
    assert {r["concept_key"] for r in kdb.tables["user_concept_mastery"]} == {"arch", "gravel"}
    entry = assert_one_decision(result, "knowledge_state")
    assert entry["output_summary"] == {"questions": 2, "concepts": 2}


def test_a_test_that_names_no_concept_moves_nothing(kdb):
    state = submit_state(test_questions=[{"id": "q1", "strategy": "cloze"}, {"id": "q2", "strategy": "cloze"}])
    result = knowledge_agent.knowledge_state_node(state)
    assert result["mastery_updates"] == [] and "errors" not in result
    assert assert_one_decision(result, "knowledge_state")["output_summary"] == {"questions": 0, "concepts": 0}


def test_a_failing_mastery_update_is_an_error_entry_not_an_exception(kdb, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("mastery table is down")

    monkeypatch.setattr(knowledge_agent, "record_test", broken)
    result = knowledge_agent.knowledge_state_node(submit_state())
    assert result["errors"] == ["knowledge_state: mastery table is down"]
    assert_one_decision(result, "knowledge_state")


# --- optimizer (C8.4b) -------------------------------------------------------------------------


def sessions_rows(*statuses):
    rows = [{"id": "s2", "user_id": USER, "book_id": BOOK, "status": "testing", "assigned_words": 500,
             "actual_duration_minutes": 10, "started_at": "2026-11-11T09:00:00+00:00"}]
    for n, status in enumerate(statuses):
        rows.append({"id": f"old-{n}", "user_id": USER, "book_id": BOOK, "status": status, "assigned_words": 250,
                     "actual_duration_minutes": 5, "started_at": f"2026-11-10T0{n}:00:00+00:00"})
    return rows


def run_optimizer(percentage, **extra):
    state = submit_state(**extra)
    state["evaluation_result"] = {**GRADED, "percentage": percentage}
    return asyncio.run(optimizer_agent.optimizer_node(state))


def test_the_optimizer_stores_its_recommendation_and_history(kdb):
    kdb.tables["reading_progress"] = [{"id": "p1", "user_id": USER, "book_id": BOOK, "last_chunk_index": 3,
                                       "re_read_queue": [], "pace_recommendation": {
                                           "next_chunk_multiplier": 1.0, "recent_percentages": [40]}}]
    kdb.tables["sessions"] = sessions_rows("completed")
    result = run_optimizer(30)
    (progress,) = kdb.tables["reading_progress"]
    stored = progress["pace_recommendation"]
    assert progress["re_read_queue"] == [3] and stored["band"] == "reduce"
    assert stored["recent_percentages"] == [30, 40] and stored["reading_wpm"] == 50  # 500 words in 10 min
    assert stored["recent_outcomes"] == [{"strategy": "cloze", "score": 1.0}, {"strategy": "cloze", "score": 0.0}]
    assert result["pace_recommendation"] == result["policy_adjustments"] == stored
    entry = assert_one_decision(result, "optimizer")
    assert entry["output_summary"]["next_chunk_multiplier"] == pytest.approx(0.8)


def test_the_optimizer_creates_the_progress_row_if_there_is_none(kdb):
    kdb.tables["sessions"] = sessions_rows()
    run_optimizer(90)
    (progress,) = kdb.tables["reading_progress"]
    assert progress["last_chunk_index"] == 3 and progress["pace_recommendation"]["band"] == "grow"


def test_the_optimizer_counts_abandoned_sessions(kdb):
    kdb.tables["sessions"] = sessions_rows("abandoned", "abandoned", "completed")
    result = run_optimizer(95)
    assert "abandonment" in result["policy_adjustments"]["rules"]


def test_question_outcomes_build_up_across_tests_and_move_the_mix(kdb):
    kdb.tables["sessions"] = sessions_rows()
    kdb.tables["reading_progress"] = [{"id": "p1", "user_id": USER, "book_id": BOOK, "last_chunk_index": 3,
                                       "re_read_queue": [], "pace_recommendation": {"recent_outcomes": [
                                           {"strategy": "cloze", "score": 0.0}] * 30}}]
    stored = run_optimizer(60)["policy_adjustments"]
    assert len(stored["recent_outcomes"]) == policy.OPT_OUTCOME_HISTORY
    assert "question_mix" in stored["rules"]


@pytest.mark.parametrize("module", [optimizer_agent, knowledge_agent])
def test_the_submit_nodes_use_no_llm(module):
    source = inspect.getsource(module)
    for banned in ("services.llm", "langchain", "ChatPromptTemplate", "_llm", "MOCK"):
        assert banned not in source
