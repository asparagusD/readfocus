"""The labelled answers in fixtures/answers.json are well formed and cover every case the grader must handle."""

import json
from collections import Counter
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "answers.json"
FIELDS = {"id", "category", "question", "type", "evidence", "key_terms", "answer", "human_score"}
TYPES = {"factual", "inference", "summary"}
CATEGORIES = {"correct", "paraphrase", "partial", "wrong", "off_topic", "empty", "question_copy"}
# The band of human_score each category may use: (lowest, highest).
BANDS = {
    "correct": (1.0, 1.0), "paraphrase": (0.8, 1.0), "partial": (0.3, 0.7), "wrong": (0.0, 0.2),
    "off_topic": (0.0, 0.0), "empty": (0.0, 0.0), "question_copy": (0.0, 0.0),
}


def load_cases() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_every_case_has_the_fields_and_a_unique_id():
    cases = load_cases()
    assert 28 <= len(cases) <= 40
    assert all(set(case) == FIELDS for case in cases)
    assert len({case["id"] for case in cases}) == len(cases)
    assert all(case["type"] in TYPES for case in cases)
    assert all(case["question"].strip() and case["evidence"].strip() for case in cases)


def test_every_category_and_type_is_covered():
    cases = load_cases()
    per_category = Counter(case["category"] for case in cases)
    assert set(per_category) == CATEGORIES
    assert min(per_category.values()) >= 4
    assert {case["type"] for case in cases} == TYPES


def test_scores_are_in_range_and_in_their_category_band():
    for case in load_cases():
        low, high = BANDS[case["category"]]
        assert 0.0 <= case["human_score"] <= 1.0
        assert low <= case["human_score"] <= high, case["id"]


def test_key_terms_come_from_the_evidence():
    for case in load_cases():
        assert case["key_terms"], case["id"]
        assert all(term.lower() in case["evidence"].lower() for term in case["key_terms"]), case["id"]


def test_empty_and_copied_answers_are_what_they_say():
    for case in load_cases():
        if case["category"] == "empty":
            assert case["answer"].strip() == "", case["id"]
        elif case["category"] == "question_copy":
            words = set(case["answer"].lower().replace('"', "").replace("?", "").replace(".", "").split())
            asked = set(case["question"].lower().replace('"', "").replace("?", "").replace(".", "").split())
            assert words <= asked, case["id"]
        else:
            assert case["answer"].strip(), case["id"]
