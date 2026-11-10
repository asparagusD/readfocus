"""Knowledge state: the I/O around mastery.decide for one graded test.

record_test reads the reader's mastery rows for the concepts the test's
questions name, lets mastery.decide move them, and upserts the result: two
round trips, or none when no question names a concept. The session id is
the event id, so a test submitted twice counts once.

knowledge_state_node is the LangGraph node around it; a failure becomes an
`errors` entry, never an exception, since the reader's result is already
stored. The submit flow runs it after the evaluator (backend/agents/graph.py).
"""

import time
from datetime import UTC, datetime, timedelta

from backend.agents.knowledge_state.mastery import ConceptGrade, MasteryRow, decide
from backend.agents.state import AgentState, decision
from backend.services.supabase_client import supabase

CONFLICT_COLUMNS = "user_id,book_id,concept_key"


def to_grades(questions: list[dict], per_question: list[dict]) -> list[ConceptGrade]:
    """A grade for every question that names a concept: its points as a 0..1 score."""
    return [
        ConceptGrade(
            concept_keys=question["concept_keys"], confidence=result.get("confidence") or "high",
            score=(result.get("score") or 0) / result["max_score"] if result.get("max_score") else 0.0,
        )
        for question, result in zip(questions, per_question) if question.get("concept_keys")
    ]


def record_test(
    user_id: str, book_id: str, event_id: str, questions: list[dict], per_question: list[dict],
    now: datetime | None = None, with_updates: bool = False,
) -> dict:
    """Move the reader's mastery of the concepts a graded test was about. Returns what it did."""
    grades = to_grades(questions, per_question)
    updates = []
    if grades:  # no question names a concept: no round trip
        keys = sorted({key for grade in grades for key in grade.concept_keys})
        query = supabase.table("user_concept_mastery").select("*").eq("user_id", user_id).eq("book_id", book_id)
        current = [MasteryRow(**row) for row in query.in_("concept_key", keys).execute().data or []]
        updates = decide(current, grades, event_id)
    if updates:
        now = now or datetime.now(UTC)
        supabase.table("user_concept_mastery").upsert([
            {
                "user_id": user_id, "book_id": book_id, "concept_key": update.concept_key,
                "mastery": update.mastery, "attempts": update.attempts, "correct": update.correct,
                "last_seen": now.isoformat(), "last_event_id": update.last_event_id,
                "next_review": (now + timedelta(days=update.review_in_days)).isoformat(),
            }
            for update in updates
        ], on_conflict=CONFLICT_COLUMNS).execute()
    report = {"questions": len(grades), "concepts": len(updates)}
    return {**report, "updates": [update.model_dump() for update in updates]} if with_updates else report


def knowledge_state_node(state: AgentState) -> dict:
    started = time.perf_counter()
    user_id, book_id, event_id = state.get("user_id") or "", state.get("book_id") or "", state.get("session_id") or ""
    questions = state.get("test_questions") or []
    per_question = (state.get("evaluation_result") or {}).get("per_question") or []
    inputs = {"session_id": event_id, "questions": len(questions), "graded": len(per_question)}
    try:
        report = record_test(user_id, book_id, event_id, questions, per_question, with_updates=True)
    except Exception as error:  # noqa: BLE001 - the reader's result is already stored
        return {"errors": [f"knowledge_state: {error}"], "decisions": [decision(
            "knowledge_state", started, inputs, {"concepts": 0}, "Mastery update failed; the test result is kept.")]}
    updates = report.pop("updates")
    reason = f"Moved the mastery of {report['concepts']} concepts named by {report['questions']} graded questions."
    return {"mastery_updates": updates, "decisions": [decision("knowledge_state", started, inputs, report, reason)]}
