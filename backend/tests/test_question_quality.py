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


@pytest.mark.parametrize("sentence, reason", [
    # Front matter: labelled metadata, licence lines, title and author runs.
    ("Academic Editor: Hristos T. Anastassiu Received: 28 May 2025 Revised: 18 June 2025", "front_matter"),
    ("Keywords: microstrip antenna; convolutional neural network (CNN); inverse design", "front_matter"),
    ("Copyright: © 2025 by the authors, licensee of this open access article in Basel.", "front_matter"),
    ("Please send all correspondence about this article to the author at reader@example.org today.", "front_matter"),
    ("Article Inverse Design of Microstrip Antennas Based on Deep Learning Shiyang Chen and Kaixu Wang",
     "front_matter"),
    # Reference entries.
    ("Kingma, D.P.; Ba, J. Adam: A method for stochastic optimization. arXiv 2014, arXiv:1412.6980.",
     "reference_entry"),
    ("Balanis, C.A. Antenna Theory: Analysis and Design, 4th ed.; John Wiley and Sons: Hoboken, 2016.",
     "reference_entry"),
    ("The full data set for this study is available at https://example.org/data for other groups.",
     "reference_entry"),
    # Page furniture: running headers, captions, rows of numbers.
    ("Electronics 2025, 14, 2510 6 of 13 subsequent 5000 epochs adopt a learning rate of 0.001.",
     "page_furniture"),
    ("Figure 5. Convergence of the surrogate model for the four batch sizes that were tried.", "page_furniture"),
    ("Table 2: Comparison of the predicted and simulated values at the two resonant frequencies.",
     "page_furniture"),
    ("512 0.35 0.28 0.94 1024 0.41 0.33 0.91 loss", "page_furniture"),
    # Ordinary sentences, including ones with names, years, numbers and a citation.
    (GOOD_EVIDENCE, None),
    ("Marie Curie won 2 Nobel prizes for research on radioactivity.", None),
    ("In 1905 Einstein published four papers that changed physics.", None),
    ("Smith et al. [17] showed that a larger batch size is needed to keep training stable.", None),
    ("As illustrated in Figure 5, we compared the impact of different batch sizes on the model.", None),
    ("J. K. Rowling wrote the first book in 1997, long before the films were made.", None),
    ("We selected a batch size of 512 and a learning rate of 0.0005 for the final 5000 epochs.", None),
])
def test_boilerplate_reason(sentence, reason):
    assert quality.boilerplate_reason(sentence) == reason


def test_boilerplate_evidence_rejects_the_question():
    caption = "Figure 5. Convergence of the surrogate model for the four batch sizes that were tried."
    assert quality.reject_reason(question(evidence=[caption])) == "page_furniture"
    # Any one piece is enough, and line breaks in the raw span do not hide it.
    wrapped = "Kingma, D.P.; Ba, J. Adam: A method for\nstochastic optimization. arXiv 2014."
    assert quality.reject_reason(question(evidence=[GOOD_EVIDENCE, wrapped])) == "reference_entry"
    assert quality.reject_reason(question(answer="It", evidence=[caption])) == "answer_is_stopword"


def test_filter_caps_each_strategy_keeping_the_best():
    terms = [[], ["a", "b", "c"], ["a"], ["a", "b", "c"], ["a", "b"], [], ["a", "b", "c"]]
    questions = [question(prompt=str(i), key_terms=t) for i, t in enumerate(terms)]
    vectors = np.array([at(30 * i) for i in range(len(questions))])
    assert policy.QUESTION_CAPS["cloze"] == 5
    result = quality.filter_questions(questions, vectors)
    assert [q.prompt for q in result.accepted] == ["1", "2", "3", "4", "6"]
    assert [(r.question.prompt, r.reason) for r in result.rejected] == [("0", "over_cap"), ("5", "over_cap")]


def test_caps_are_per_strategy():
    ideas = [question(strategy="main_idea", type="summary", prompt=f"idea {i}") for i in range(2)]
    odd = [question(strategy="something_new", prompt=f"new {i}") for i in range(policy.QUESTION_CAP_DEFAULT + 1)]
    questions = [question(prompt="cloze"), *ideas, *odd]
    vectors = np.array([at(30 * i) for i in range(len(questions))])
    result = quality.filter_questions(questions, vectors)
    kept = [q.prompt for q in result.accepted]
    assert kept == ["cloze", "idea 0", *[f"new {i}" for i in range(policy.QUESTION_CAP_DEFAULT)]]
    assert result.counts() == {"over_cap": 2}
