"""Mastery update: pure decide() from a reader's current rows and one test's grades.

Each graded question names the concepts it was about (`concept_keys`) and
has a score from 0 to 1. For every concept it names, mastery m moves:

- correct (score at or above MASTERY_CORRECT_FROM): m + GAIN * (1 - m);
- wrong (score below MASTERY_WRONG_BELOW): m * (1 - LOSS);
- partial: between those two values, in proportion to the score.

A low-confidence grade moves mastery by half as much. The result stays
within 0 to 1, and the next review is sooner the lower it is. A concept
with no row starts from MASTERY_PRIOR. A row whose last_event_id is this
event is skipped, so applying a test twice changes nothing.

No I/O and no clock: the caller turns `review_in_days` into a date. Every
number is in backend/agents/policy.py.
"""

from pydantic import BaseModel, field_validator

from backend.agents import policy


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


class MasteryRow(BaseModel):
    """A user_concept_mastery row, as far as the update needs it."""

    concept_key: str
    mastery: float = policy.MASTERY_PRIOR
    attempts: int = 0
    correct: int = 0
    last_event_id: str | None = None

    _bounded = field_validator("mastery", mode="before")(_clamp)


class ConceptGrade(BaseModel):
    """One graded question: the concepts it was about, its 0..1 score and the grader's confidence."""

    concept_keys: list[str]
    score: float
    confidence: str = "high"

    _bounded = field_validator("score", mode="before")(_clamp)


class MasteryUpdate(BaseModel):
    concept_key: str
    previous: float
    mastery: float
    attempts: int
    correct: int
    review_in_days: int
    last_event_id: str


def is_correct(score: float) -> bool:
    return score >= policy.MASTERY_CORRECT_FROM


def step(mastery: float, score: float, confidence: str = "high") -> float:
    """Mastery after one graded question."""
    gained = mastery + policy.MASTERY_GAIN * (1.0 - mastery)
    lost = mastery * (1.0 - policy.MASTERY_LOSS)
    if is_correct(score):
        target = gained
    elif score < policy.MASTERY_WRONG_BELOW:
        target = lost
    else:
        share = (score - policy.MASTERY_WRONG_BELOW) / (policy.MASTERY_CORRECT_FROM - policy.MASTERY_WRONG_BELOW)
        target = lost + share * (gained - lost)
    weight = policy.MASTERY_CONFIDENCE_WEIGHT.get(confidence, 1.0)
    return _clamp(mastery + weight * (target - mastery))


def review_in_days(mastery: float) -> int:
    """Days until the concept is due again: sooner for a weaker concept."""
    for below, days in policy.MASTERY_REVIEW_DAYS:
        if mastery < below:
            return days
    return policy.MASTERY_REVIEW_DAYS_MAX


def decide(current_rows: list[MasteryRow], grades: list[ConceptGrade], event_id: str) -> list[MasteryUpdate]:
    """The rows to write after one graded test, in the order the grades first name each concept."""
    rows = {row.concept_key: row for row in current_rows}
    updates: dict[str, MasteryUpdate] = {}
    for grade in grades:
        for key in dict.fromkeys(key for key in grade.concept_keys if key):
            row = rows.get(key) or MasteryRow(concept_key=key)
            if row.last_event_id == event_id:
                continue
            last = updates.get(key)
            mastery = step(last.mastery if last else row.mastery, grade.score, grade.confidence)
            updates[key] = MasteryUpdate(
                concept_key=key, previous=row.mastery, mastery=mastery,
                attempts=(last.attempts if last else row.attempts) + 1,
                correct=(last.correct if last else row.correct) + is_correct(grade.score),
                review_in_days=review_in_days(mastery), last_event_id=event_id,
            )
    return list(updates.values())
