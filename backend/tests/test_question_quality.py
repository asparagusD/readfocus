"""Question quality filter on hand-made questions and vectors: no model, no database."""

import numpy as np
import pytest

from backend.agents import policy
from backend.agents.question_generation import quality
from backend.agents.question_generation.strategies import Question

GOOD_EVIDENCE = "Green plants turn sunlight into chemical energy inside the chloroplasts of their leaves."


def question(**changes) -> Question:
    fields = {
        "type": "factual", "strategy": "cloze", "difficulty": 0.3,
        "prompt": f"Fill in the blank: Green plants turn {policy.BLANK} into chemical energy.",
        "answer": "sunlight", "evidence": [GOOD_EVIDENCE], "key_terms": ["sunlight"], "concept": "sunlight",
    }
    return Question(**{**fields, **changes})


def at(degrees: float) -> np.ndarray:
    return np.array([np.cos(np.radians(degrees)), np.sin(np.radians(degrees))])


@pytest.mark.parametrize("changes, reason", [
    ({}, None),
    ({"answer": "It"}, "answer_is_stopword"),
    ({"answer": "the"}, "answer_is_stopword"),
    ({"answer": "because it is"}, "answer_is_stopword"),
    ({"answer": "  "}, "answer_is_stopword"),
    ({"answer": "because it rains"}, None),
    ({"evidence": ["Plants need light."]}, "evidence_too_short"),
    ({"evidence": ["One two three four five six seven."]}, "evidence_too_short"),          # 7 tokens
    ({"evidence": ["One two three four five six seven eight."]}, None),                    # 8 tokens
    ({"evidence": ["Sunlight is weaker in winter.", "Therefore, growth slows."]}, None),   # 8 in two pieces
    ({"prompt": "What is sunlight?"}, "answer_in_prompt"),
    ({"prompt": "Why does Sunlight, more than water, matter?"}, "answer_in_prompt"),
    ({"prompt": "What are sunlights?"}, None),                                             # whole words only
    ({"answer": "chemical energy", "prompt": "Is it chemical or light energy?"}, None),    # words apart
    ({"answer": "It", "evidence": ["Too short."]}, "answer_is_stopword"),                  # first reason wins
])
def test_reject_reason(changes, reason):
    assert quality.reject_reason(question(**changes)) == reason


def test_quality_is_between_0_and_1_and_ranks_as_expected():
    good = quality.score(question())
    assert 0.0 <= good <= 1.0
    weak_evidence = quality.score(question(evidence=["It is so in most of the cases that we saw."]))
    long_answer = quality.score(question(answer=" ".join(["photosynthesis"] * 70)))
    no_terms = quality.score(question(key_terms=[]))
    assert good > weak_evidence and good > long_answer and good > no_terms
    assert quality.score(question(evidence=[], answer="", key_terms=[])) == 0.0
    # Everything at its best: informative evidence, short answer, enough key terms.
    best = question(evidence=["Marie Curie won 2 Nobel prizes for research on radioactivity."],
                    key_terms=["curie", "nobel", "radioactivity"])
    assert quality.score(best) == pytest.approx(1.0)


def test_filter_drops_rejects_and_sets_quality():
    questions = [question(), question(answer="It"), question(evidence=["Plants need light."])]
    result = quality.filter_questions(questions, np.array([at(0), at(40), at(80)]))
    assert [q.answer for q in result.accepted] == ["sunlight"]
    assert result.accepted[0].quality == pytest.approx(quality.score(questions[0]))
    assert questions[0].quality is None  # the input is not changed
    assert [(r.question.answer, r.reason) for r in result.rejected] == [
        ("It", "answer_is_stopword"), ("sunlight", "evidence_too_short"),
    ]
    assert result.counts() == {"answer_is_stopword": 1, "evidence_too_short": 1}


def test_filter_keeps_the_better_of_two_near_duplicates():
    weaker = question(prompt="A", key_terms=[])
    better = question(prompt="B")
    other = question(prompt="C")
    edge = question(prompt="D")
    # cos 20 = 0.94 (duplicate), cos 60 = 0.5; D is 26 degrees from C: cos = 0.899, just under.
    vectors = np.array([at(0), at(20), at(60), at(86)])
    result = quality.filter_questions([weaker, better, other, edge], vectors)
    assert [q.prompt for q in result.accepted] == ["B", "C", "D"]  # original order, better one kept
    assert [(r.question.prompt, r.reason) for r in result.rejected] == [("A", "near_duplicate")]


def test_filter_keeps_the_first_of_two_equal_duplicates():
    result = quality.filter_questions([question(prompt="A"), question(prompt="B")], np.array([at(0), at(5)]))
    assert [q.prompt for q in result.accepted] == ["A"]


def test_a_multiple_choice_question_is_not_a_duplicate_of_its_cloze():
    cloze = question()
    choice = question(strategy="multiple_choice", distractors=["water", "soil", "oxygen"],
                      prompt=cloze.prompt.replace("Fill in the blank", "Choose the answer that fills the blank"))
    result = quality.filter_questions([cloze, choice], np.array([at(0), at(1)]))
    assert [q.strategy for q in result.accepted] == ["cloze", "multiple_choice"]


def test_filter_edge_cases():
    empty = quality.filter_questions([], np.zeros((0, 2)))
    assert empty.accepted == [] and empty.rejected == [] and empty.counts() == {}
    with pytest.raises(ValueError):
        quality.filter_questions([question()], np.zeros((2, 2)))
    # A zero vector (nothing to compare) never counts as a duplicate.
    result = quality.filter_questions([question(prompt="A"), question(prompt="B")], np.zeros((2, 2)))
    assert len(result.accepted) == 2
