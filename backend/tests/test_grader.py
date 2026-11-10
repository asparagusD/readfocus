"""backend.agents.evaluation.grader: closed and free-text grading with a confidence.

decide() is pure and takes its cosines as numbers, so these tests need no
model. The last test grades the labelled answers in fixtures/answers.json
with the real model and is skipped when it is not in the local cache.
"""

import json
from pathlib import Path

import numpy as np
import pytest

from backend.agents import policy
from backend.agents.evaluation import grader
from backend.agents.evaluation.grader import GradeInput, decide

REAL_CACHE = Path(__file__).resolve().parents[2] / ".cache" / "fastembed"
FIXTURE = Path(__file__).parent / "fixtures" / "answers.json"
LOW, HIGH = policy.GRADE_AMBIGUOUS_COSINE
CLEAR = policy.GRADE_COSINE_FULL  # a cosine well above the ambiguous band

CLOZE = "The printing press was introduced to Europe by Johannes _____ around 1450."
ROADS = {
    "question": 'Why is this so: "The Roman roads stayed usable for centuries"?',
    "evidence": "The Roman roads stayed usable for centuries because engineers laid them on deep "
                "foundations of layered stone and gravel that drained water away.",
    "key_terms": ["deep foundations", "layered stone", "gravel", "drained water"],
}
FULL = "They sat on deep foundations of layered stone and gravel, which drained water away."


def cloze(answer, **extra):
    return decide(GradeInput(question=CLOZE, answer=answer, key_terms=["gutenberg"], **extra))


def free(answer, cosine=CLEAR, question_cosine=0.5, **extra):
    return decide(GradeInput(answer=answer, cosine=cosine, question_cosine=question_cosine, **{**ROADS, **extra}))


# --- closed questions --------------------------------------------------------

@pytest.mark.parametrize("answer", ["Gutenberg", "gutenberg", " GUTENBERG. ", "Johannes Gutenberg", "gutenbergg"])
def test_cloze_exact_or_fuzzy_match_is_full_marks_at_high_confidence(answer):
    grade = cloze(answer)
    assert (grade.score, grade.confidence) == (1.0, "high")
    assert grade.matched_concepts == ["gutenberg"] and grade.missing_concepts == []


def test_cloze_is_recognised_by_strategy_and_uses_the_stored_answer():
    grade = decide(GradeInput(question="Plants make _____.", answer="glucose", strategy="cloze", expected="Glucose"))
    assert (grade.score, grade.method) == (1.0, "exact")


def test_cloze_wrong_answer_is_zero_at_high_confidence():
    grade = cloze("Kepler")
    assert (grade.score, grade.confidence) == (0.0, "high")
    assert grade.missing_concepts == ["gutenberg"]


def test_cloze_near_miss_below_the_fuzzy_threshold_is_never_certain():
    grade = cloze("gutenburg")  # rapidfuzz ratio 88.9, under 90
    assert grade.score == policy.GRADE_NEAR_MISS_SCORE and grade.confidence == "low"
    assert grade.method == "near_miss"


@pytest.mark.parametrize("answer", ["b", "(b)", "B.", "b) oxygen", "oxygen", "Oxygn"])
def test_multiple_choice_accepts_the_letter_or_the_option_text(answer):
    options = ["glucose", "oxygen", "nitrogen", "water"]
    grade = decide(GradeInput(
        question="Plants release _____.", answer=answer, strategy="multiple_choice", expected="oxygen", options=options,
    ))
    assert (grade.score, grade.confidence) == (1.0, "high")


def test_multiple_choice_wrong_option_is_zero_and_unmatched_text_is_low_confidence():
    question = {"question": "Plants release _____.", "strategy": "multiple_choice", "expected": "oxygen",
                "options": ["glucose", "oxygen", "nitrogen", "water"]}
    wrong = decide(GradeInput(answer="c", **question))
    assert (wrong.score, wrong.confidence) == (0.0, "high")
    unknown = decide(GradeInput(answer="the green one", **question))
    assert (unknown.score, unknown.confidence) == (0.0, "low")


@pytest.mark.parametrize("answer", ["", "   ", "\n"])
def test_an_empty_answer_is_zero_and_certain_for_every_kind(answer):
    for grade in (cloze(answer), free(answer, cosine=None)):
        assert (grade.score, grade.confidence, grade.method) == (0.0, "high", "empty")


# --- free text ---------------------------------------------------------------

def test_free_text_score_is_the_weighted_sum_of_its_three_components():
    grade = free("It had deep foundations and gravel under it.", cosine=CLEAR)
    weights = policy.GRADE_WEIGHTS
    assert grade.components == {"cosine": 1.0, "coverage": 0.5, "relevance": 1.0}
    assert grade.score == pytest.approx(weights["cosine"] + weights["coverage"] * 0.5 + weights["relevance"])
    assert grade.matched_concepts == ["deep foundations", "gravel"]
    assert grade.missing_concepts == ["layered stone", "drained water"]


def test_weights_sum_to_one_and_a_complete_answer_scores_one():
    assert sum(policy.GRADE_WEIGHTS.values()) == pytest.approx(1.0)
    grade = free(FULL)
    assert grade.score == pytest.approx(1.0)


def test_free_text_is_never_high_confidence_even_when_every_signal_is_perfect():
    # A fluent answer that reverses the evidence in its own words looks the same to the grader.
    grade = free(FULL, cosine=0.99)
    assert grade.score == pytest.approx(1.0)
    assert grade.confidence == policy.GRADE_FREE_TEXT_MAX_CONFIDENCE == "medium"
    assert grade.reasons == ["free_text_cap"]


def test_cosine_is_rescaled_between_the_floor_and_full_and_clamped():
    floor, full = policy.GRADE_COSINE_FLOOR, policy.GRADE_COSINE_FULL
    assert free(FULL, cosine=floor - 0.1).components["cosine"] == 0.0
    assert free(FULL, cosine=(floor + full) / 2).components["cosine"] == pytest.approx(0.5)
    assert free(FULL, cosine=0.99).components["cosine"] == 1.0


def test_key_terms_match_plurals_and_misspellings_and_need_every_word():
    grade = free("Deep foundation, layers of stones, gravell; water drains.", cosine=CLEAR)
    assert grade.matched_concepts == ["deep foundations", "gravel"]
    assert grade.missing_concepts == ["layered stone", "drained water"]


def test_an_off_topic_answer_scores_near_zero():
    grade = free("I had pasta for dinner and then watched a film.", cosine=0.02, question_cosine=0.01)
    assert grade.score == 0.0 and grade.components["relevance"] == 0.0
    assert grade.confidence == "medium"


def test_fewer_than_four_tokens_is_low_confidence():
    assert free("Stone and gravel.").confidence == "low"
    assert "short_answer" in free("Stone and gravel.").reasons
    assert free("Stone and gravel foundations.").confidence != "low"


@pytest.mark.parametrize("answer", [ROADS["question"], "The Roman roads stayed usable for centuries.",
                                    "why is this so the roman roads stayed usable"])
def test_a_copy_of_the_question_earns_nothing_and_is_low_confidence(answer):
    grade = free(answer, cosine=0.85, question_cosine=0.99)
    assert grade.score == 0.0 and grade.confidence == "low"
    assert grade.method == "question_copy" and grade.components["relevance"] == 0.0


def test_cosine_in_the_ambiguous_band_is_low_and_next_to_it_medium():
    margin = policy.GRADE_AMBIGUOUS_MARGIN
    assert free(FULL, cosine=LOW).confidence == "low"
    assert free(FULL, cosine=(LOW + HIGH) / 2).confidence == "low"
    assert free(FULL, cosine=HIGH).confidence == "low"
    for cosine in (HIGH + margin / 2, LOW - margin / 2):
        grade = free(FULL, cosine=cosine)
        assert grade.confidence == "medium" and "near_ambiguous_cosine" in grade.reasons
    assert "near_ambiguous_cosine" not in free(FULL, cosine=HIGH + margin + 0.01).reasons


def test_meaning_and_key_terms_that_disagree_are_medium_confidence():
    grade = free("Because the Romans repaved every road each year.", cosine=CLEAR)  # close in meaning, no key term
    assert grade.components["coverage"] == 0.0
    assert grade.confidence == "medium" and "signals_disagree" in grade.reasons


def test_a_missing_cosine_is_graded_on_key_terms_alone_at_low_confidence():
    grade = free(FULL, cosine=None, question_cosine=None)
    assert grade.confidence == "low" and "no_embedding" in grade.reasons
    assert grade.score == pytest.approx(policy.GRADE_WEIGHTS["coverage"])


def test_decide_is_deterministic_and_stays_between_zero_and_one():
    for cosine in (-0.2, 0.0, 0.3, 0.5, 0.7, 1.0):
        first, second = free(FULL, cosine=cosine), free(FULL, cosine=cosine)
        assert first == second and 0.0 <= first.score <= 1.0


# --- grade_all: the only part that embeds ------------------------------------

def test_grade_all_embeds_free_text_in_one_call_and_skips_closed_questions():
    calls = []

    def embed(texts):
        calls.append(list(texts))
        vectors = np.zeros((len(texts), 3), dtype=np.float32)
        for row, text in enumerate(texts):
            vectors[row, 0 if "foundations" in text else 1] = 1.0
        return vectors

    items = [
        {"question": CLOZE, "answer": "Gutenberg", "key_terms": ["gutenberg"]},
        {**ROADS, "answer": FULL},
        {**ROADS, "answer": ""},
    ]
    grades = grader.grade_all([GradeInput(**item) for item in items], embed)
    assert [grade.method for grade in grades] == ["exact", "semantic", "empty"]
    assert len(calls) == 1 and FULL in calls[0] and "Gutenberg" not in calls[0]
    assert grades[1].components["cosine"] == 1.0


def test_grade_all_survives_an_embedder_that_raises():
    def embed(texts):
        raise RuntimeError("model missing")

    grade = grader.grade_all([GradeInput(**ROADS, answer=FULL)], embed)[0]
    assert grade.confidence == "low" and "no_embedding" in grade.reasons


def test_the_grader_uses_no_llm_and_no_database():
    source = Path(grader.__file__).read_text(encoding="utf-8")
    for banned in ("langchain", "services.llm", "supabase"):
        assert banned not in source


# --- agreement with the labelled answers (real model) ------------------------

@pytest.mark.skipif(
    not any(REAL_CACHE.glob("*all-MiniLM-L6-v2*/**/*.onnx")),
    reason="all-MiniLM-L6-v2 is not in .cache/fastembed",
)
def test_agreement_with_human_labels_on_the_fixture(monkeypatch):
    from backend.nlp import embedder

    monkeypatch.setenv("FASTEMBED_CACHE", str(REAL_CACHE))
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setattr(embedder, "_model", None)
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))
    grades = grader.grade_all([GradeInput(**case) for case in cases], embedder.embed)
    agree = [abs(grade.score - case["human_score"]) <= policy.GRADE_AGREEMENT_TOLERANCE
             for grade, case in zip(grades, cases)]
    assert sum(agree) / len(cases) >= policy.GRADE_AGREEMENT_TARGET
    # No grade is both certain and off: every high-confidence grade agrees with the human one.
    assert all(ok for ok, grade in zip(agree, grades) if grade.confidence == "high")
    assert all(grade.confidence != "high" for grade in grades if grade.method == "semantic")
