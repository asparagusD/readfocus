"""Tests for the pure helpers in scripts/eval_grader.py (C15.3). No model, no network."""

from backend.agents import policy
from backend.agents.evaluation.grader import GradeInput
from scripts import eval_grader

CASES = [
    {"human_score": 1.0, "category": "correct"},
    {"human_score": 0.0, "category": "wrong"},
    {"human_score": 0.5, "category": "partial"},
]


def test_graded_applies_constants_for_the_call_only():
    before = {name: getattr(policy, name) for name in eval_grader.NAMES}
    data = GradeInput(question="What do plants make?", answer="plants make glucose from light", evidence="Plants make glucose.",
                      key_terms=["glucose"], cosine=0.5, question_cosine=0.4)
    low = eval_grader.graded([{}], [data], {"GRADE_COSINE_FLOOR": 0.45, "GRADE_COSINE_FULL": 0.9})[0].score
    high = eval_grader.graded([{}], [data], {"GRADE_COSINE_FLOOR": 0.0, "GRADE_COSINE_FULL": 0.5})[0].score
    assert high > low
    assert {name: getattr(policy, name) for name in eval_grader.NAMES} == before


def test_best_on_counts_agreements_first_then_error():
    rows = [({"name": "close"}, [0.8, 0.2, 0.5]),  # 3 agree, error 0.4
            ({"name": "exact"}, [1.0, 0.0, 0.9]),  # 2 agree (0.9 is off by 0.4), error 0.4
            ({"name": "best"}, [0.9, 0.1, 0.5])]   # 3 agree, error 0.2
    assert eval_grader.best_on(CASES, rows, [0, 1, 2])[0]["name"] == "best"
    assert eval_grader.best_on(CASES, rows, [0, 1])[0]["name"] == "exact"  # case 2 left out
