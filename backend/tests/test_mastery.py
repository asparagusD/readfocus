"""The knowledge state's mastery update: pure decide() on hand-made rows and grades. No database, no model."""

import inspect

import pytest

from backend.agents import policy
from backend.agents.knowledge_state import mastery as mastery_module
from backend.agents.knowledge_state.mastery import (
    ConceptGrade,
    MasteryRow,
    MasteryUpdate,
    decide,
)

EVENT = "session-1"


def row(mastery=0.5, key="gravel", **fields):
    return MasteryRow(concept_key=key, mastery=mastery, **fields)


def grade(score, keys=("gravel",), confidence="high"):
    return ConceptGrade(concept_keys=list(keys), score=score, confidence=confidence)


def after(mastery, score, confidence="high"):
    (update,) = decide([row(mastery)], [grade(score, confidence=confidence)], EVENT)
    return update.mastery


def test_a_correct_answer_closes_part_of_the_gap_to_one():
    assert after(0.5, 1.0) == pytest.approx(0.5 + 0.30 * 0.5)
    assert after(0.5, policy.MASTERY_CORRECT_FROM) == pytest.approx(0.65)  # the boundary counts as correct
    assert after(0.0, 0.9) == pytest.approx(0.30)


def test_a_wrong_answer_loses_a_quarter():
    assert after(0.8, 0.0) == pytest.approx(0.8 * 0.75)
    assert after(0.8, 0.39) == pytest.approx(0.6)
    assert after(0.0, 0.0) == 0.0


def test_partial_credit_interpolates_between_wrong_and_correct_by_score():
    wrong, correct = 0.5 * 0.75, 0.5 + 0.30 * 0.5
    assert after(0.5, policy.MASTERY_WRONG_BELOW) == pytest.approx(wrong)  # the boundary starts the partial band
    assert after(0.5, 0.55) == pytest.approx((wrong + correct) / 2)
    assert after(0.5, 0.6) == pytest.approx(wrong + (correct - wrong) * 2 / 3)
    assert after(0.5, 0.6999) == pytest.approx(correct, abs=1e-3)  # no jump at the correct boundary


@pytest.mark.parametrize("start", [0.0, 0.1, 0.3, 0.5, 0.8, 0.99, 1.0])
def test_mastery_stays_in_bounds_and_moves_the_right_way(start):
    scores = [i / 20 for i in range(21)]
    results = [after(start, score) for score in scores]
    assert all(0.0 <= value <= 1.0 for value in results)
    assert results == sorted(results)  # a better answer never gives a lower mastery
    assert all(after(start, s) >= start for s in scores if s >= policy.MASTERY_CORRECT_FROM)
    assert all(after(start, s) <= start for s in scores if s < policy.MASTERY_WRONG_BELOW)


@pytest.mark.parametrize("score", [0.0, 0.3, 0.5, 0.7, 1.0])
def test_a_higher_mastery_before_is_never_a_lower_mastery_after(score):
    results = [after(start / 10, score) for start in range(11)]
    assert results == sorted(results)


def test_repeated_answers_approach_the_bounds_without_passing_them():
    rows, values = [row(0.3)], []
    for event in range(40):
        (update,) = decide(rows, [grade(1.0)], f"e{event}")
        rows = [row(update.mastery)]
        values.append(update.mastery)
    assert values == sorted(values) and 0.99 < values[-1] <= 1.0
    for event in range(60):
        (update,) = decide(rows, [grade(0.0)], f"w{event}")
        rows = [row(update.mastery)]
    assert 0.0 <= update.mastery < 0.01


def test_stored_values_outside_the_range_are_clamped():
    assert MasteryRow(concept_key="k", mastery=1.4).mastery == 1.0
    assert MasteryRow(concept_key="k", mastery=-0.2).mastery == 0.0
    assert ConceptGrade(concept_keys=["k"], score=1.3).score == 1.0


def test_a_low_confidence_grade_counts_at_half_weight():
    assert after(0.5, 1.0, "low") == pytest.approx(0.5 + 0.15 * 0.5)
    assert after(0.8, 0.0, "low") == pytest.approx(0.8 - 0.5 * 0.2)
    assert after(0.5, 0.55, "low") == pytest.approx(0.5 + 0.5 * (after(0.5, 0.55) - 0.5))
    assert after(0.5, 1.0, "medium") == after(0.5, 1.0, "high")
    assert policy.MASTERY_CONFIDENCE_WEIGHT["low"] == 0.5


def test_an_untested_concept_starts_from_the_prior():
    (update,) = decide([], [grade(1.0)], EVENT)
    assert update.previous == policy.MASTERY_PRIOR == 0.3
    assert update.mastery == pytest.approx(0.3 + 0.30 * 0.7)
    assert (update.attempts, update.correct, update.last_event_id) == (1, 1, EVENT)


def test_attempts_and_correct_are_counted_per_grade():
    current = [row(0.5, attempts=4, correct=2)]
    (update,) = decide(current, [grade(1.0), grade(0.5), grade(0.1, confidence="low")], EVENT)
    assert (update.attempts, update.correct) == (7, 3)
    # Grades of one concept apply in order.
    step = 0.65
    step = step * 0.75 + (step + 0.30 * (1 - step) - step * 0.75) / 3
    assert update.mastery == pytest.approx(step - 0.5 * 0.25 * step, abs=1e-4)


def test_one_grade_updates_every_concept_it_names_and_no_other():
    current = [row(0.5, "gravel"), row(0.9, "road"), row(0.2, "bridge")]
    updates = decide(current, [grade(0.0, ("road", "gravel", "road", "")), grade(1.0, ())], EVENT)
    assert [(u.concept_key, u.mastery, u.attempts) for u in updates] == [
        ("road", pytest.approx(0.675), 1), ("gravel", pytest.approx(0.375), 1),
    ]
    assert decide(current, [], EVENT) == []


def test_the_same_event_is_applied_once():
    current = [row(0.5, "gravel", last_event_id=EVENT), row(0.5, "road", last_event_id="session-0")]
    updates = decide(current, [grade(1.0, ("gravel", "road"))], EVENT)
    assert [u.concept_key for u in updates] == ["road"]
    replay = [MasteryRow(**u.model_dump(include={"concept_key", "mastery", "attempts", "correct", "last_event_id"}))
              for u in decide([], [grade(1.0)], EVENT)]
    assert decide(replay, [grade(1.0)], EVENT) == []
    assert len(decide(replay, [grade(1.0)], "session-2")) == 1


@pytest.mark.parametrize(("value", "days"), [
    (0.0, 1), (0.39, 1), (0.4, 3), (0.59, 3), (0.6, 7), (0.79, 7), (0.8, 14), (1.0, 14),
])
def test_review_interval_by_mastery_band(value, days):
    assert mastery_module.review_in_days(value) == days


def test_the_update_carries_the_review_interval_of_the_new_mastery():
    (update,) = decide([row(0.55)], [grade(1.0)], EVENT)  # 0.55 -> 0.685
    assert isinstance(update, MasteryUpdate) and update.review_in_days == 7
    (update,) = decide([row(0.5)], [grade(0.0)], EVENT)  # 0.5 -> 0.375
    assert update.review_in_days == 1


def test_decide_is_pure_and_deterministic():
    current, grades = [row(0.5, attempts=1)], [grade(0.6), grade(0.9, confidence="low")]
    assert decide(current, grades, EVENT) == decide(current, grades, EVENT)
    assert current == [row(0.5, attempts=1)]  # the input is not changed
    source = inspect.getsource(mastery_module)
    for banned in ("supabase", "embedder", "datetime", "time.", "random", "llm", "langchain"):
        assert banned not in source
