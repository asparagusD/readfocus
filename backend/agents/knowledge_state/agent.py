"""Knowledge state: the I/O around mastery.decide for one graded test.

record_test reads the reader's mastery rows for the concepts the test's
questions name, lets mastery.decide move them, and upserts the result: two
round trips, or none when no question names a concept. The session id is
the event id, so a test submitted twice counts once.

apply_test is what the submit flow calls: the same, but a failure is logged
and never reaches the reader, whose result is already stored. It is called
directly for now; C8 moves it into the LangGraph workflow.
"""

from datetime import UTC, datetime, timedelta

from backend.agents.knowledge_state.mastery import ConceptGrade, MasteryRow, decide
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
    now: datetime | None = None,
) -> dict:
    """Move the reader's mastery of the concepts a graded test was about. Returns what it did."""
    grades = to_grades(questions, per_question)
    if not grades:
        return {"questions": 0, "concepts": 0}
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
    return {"questions": len(grades), "concepts": len(updates)}


def apply_test(user_id: str, book_id: str, event_id: str, questions: list[dict], per_question: list[dict]) -> None:
    """record_test for the submit flow: a failure is logged, never raised."""
    try:
        record_test(user_id, book_id, event_id, questions, per_question)
    except Exception as error:  # noqa: BLE001 - the reader's result is already stored
        print(f"Mastery update failed for session {event_id}: {error}")
