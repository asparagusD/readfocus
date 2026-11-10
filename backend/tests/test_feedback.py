"""backend.agents.evaluation.feedback: every sentence comes from a template, the key terms or the evidence."""

import json
import re
from pathlib import Path

import numpy as np
import pytest

from backend.agents import policy
from backend.agents.evaluation import feedback, grader
from backend.agents.evaluation.feedback import LOW_CONFIDENCE, render, snippet
from backend.agents.evaluation.grader import Grade, GradeInput

FIXTURE = Path(__file__).parent / "fixtures" / "answers.json"
EVIDENCE = (
    "The Roman roads stayed usable for centuries because engineers laid them on deep "
    "foundations of layered stone and gravel that drained water away."
)
TWO_PIECES = (
    "During deep sleep the brain replays the day's experiences and moves them from short-term to long-term storage."
    "\n\nPeople who sleep after learning remember far more than those who stay awake."
)


def semantic(matched, missing, score=0.6, confidence="medium", reasons=("free_text_cap",), relevance=1.0):
    return Grade(
        score=score, confidence=confidence, method="semantic", matched_concepts=list(matched),
        missing_concepts=list(missing), reasons=list(reasons),
        components={"cosine": score, "coverage": 0.5, "relevance": relevance},
    )


def test_names_what_was_captured_and_what_was_missed_with_the_evidence():
    text = render(semantic(["deep foundations", "gravel"], ["drained water"]), EVIDENCE)
    assert text == f"You captured deep foundations and gravel. You missed drained water — see: “{EVIDENCE}”"


def test_lists_of_terms_read_naturally_and_stop_at_the_limit():
    assert render(semantic(["gravel"], []), EVIDENCE) == "You captured gravel."
    assert render(semantic(["a", "b", "c"], []), EVIDENCE) == "You captured a, b and c."
    many = render(semantic(["a", "b", "c", "d", "e"], []), EVIDENCE)
    assert policy.FEEDBACK_MAX_TERMS == 3 and many == "You captured a, b and c."


def test_nothing_captured_only_says_what_was_missed():
    text = render(semantic([], ["gravel", "drained water"], score=0.2), EVIDENCE)
    assert text.startswith("You missed gravel and drained water — see: “") and "captured" not in text


def test_low_confidence_never_gives_a_verdict():
    for reasons in (["short_answer"], ["ambiguous_cosine"], ["question_copy"], ["no_embedding"]):
        text = render(semantic(["gravel"], ["drained water"], confidence="low", reasons=reasons), EVIDENCE)
        assert text.startswith(LOW_CONFIDENCE) and EVIDENCE in text
        assert "captured" not in text and "missed" not in text and "Correct" not in text
    assert LOW_CONFIDENCE == (
        "We couldn't judge this confidently; compare your answer with the passage below."
    )


def test_a_doubtful_medium_grade_is_called_an_estimate_and_a_plain_one_is_not():
    doubtful = render(semantic(["gravel"], [], reasons=["signals_disagree"]), EVIDENCE)
    assert doubtful == "You captured gravel. This score is an estimate."
    assert "estimate" not in render(semantic(["gravel"], []), EVIDENCE)


def test_an_answer_that_is_not_about_the_passage_is_told_so_gently():
    text = render(semantic([], ["gravel"], score=0.0, relevance=0.0), EVIDENCE)
    assert text == f"Your answer doesn't seem to be about this part of the passage — see: “{EVIDENCE}”"


def test_free_text_without_key_terms_falls_back_to_how_close_the_answer_is():
    close = render(semantic([], [], score=policy.FEEDBACK_CLOSE_SCORE), EVIDENCE)
    far = render(semantic([], [], score=policy.FEEDBACK_CLOSE_SCORE - 0.01), EVIDENCE)
    assert close == "Your answer is close to what the passage says."
    assert far.startswith("Your answer differs from what the passage says — see: “")


def test_closed_questions_name_the_expected_answer():
    right = Grade(score=1.0, confidence="high", method="exact", matched_concepts=["gutenberg"])
    wrong = Grade(score=0.0, confidence="high", method="no_match", missing_concepts=["gutenberg"])
    assert render(right, EVIDENCE) == "Correct — the answer is gutenberg."
    assert render(wrong, EVIDENCE) == f"Not quite — the answer is gutenberg. See: “{EVIDENCE}”"
    near = Grade(score=0.5, confidence="low", method="near_miss", missing_concepts=["gutenberg"], reasons=["near_miss"])
    assert render(near, EVIDENCE).startswith(LOW_CONFIDENCE)


def test_an_empty_answer_points_at_the_passage_without_scolding():
    empty = Grade(score=0.0, confidence="high", method="empty", missing_concepts=["gravel"])
    assert render(empty, EVIDENCE) == f"No answer was given. Here is the part of the passage to look at: “{EVIDENCE}”"
    assert render(empty, "") == "No answer was given."


def test_snippet_is_verbatim_short_and_from_the_sentence_that_has_the_missed_term():
    assert snippet(TWO_PIECES, ["stay awake"]) == "People who sleep after learning remember far more than those who stay awake."
    assert snippet(TWO_PIECES, ["nowhere"]).startswith("During deep sleep")
    long = "word " * 80
    cut = snippet(long, [])
    assert cut.endswith("…") and len(cut) <= policy.FEEDBACK_SNIPPET_CHARS + 1
    assert long.startswith(cut[:-1]) and not cut[:-1].endswith(" ")
    assert snippet("", ["x"]) == "" and snippet("  \n\n ", []) == ""


def test_no_evidence_means_no_quote_and_no_dangling_see():
    text = render(semantic(["gravel"], ["drained water"]), "")
    assert text == "You captured gravel. You missed drained water." and "“" not in text


def test_every_fixture_answer_gets_feedback_made_only_of_templates_terms_and_evidence():
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def embed(texts):  # every text gets the same vector: cosine 1 everywhere, no model needed
        return np.ones((len(texts), 2), dtype=np.float32) / np.sqrt(2)

    grades = grader.grade_all([GradeInput(**case) for case in cases], embed)
    for case, grade in zip(cases, grades):
        text = render(grade, case["evidence"])
        assert text and len(text) <= policy.FEEDBACK_SNIPPET_CHARS + 200, case["id"]
        for quote in re.findall(r"“(.*?)”", text, re.DOTALL):
            assert quote.rstrip("…") in case["evidence"], case["id"]
        # Outside the quotes there are only template words and the question's own key terms.
        rest = re.sub(r"“.*?”", "", text, flags=re.DOTALL).lower()
        for term in case["key_terms"]:
            rest = rest.replace(term.lower(), "")
        assert set(re.findall(r"[a-z']+", rest)) <= feedback.TEMPLATE_WORDS, (case["id"], text)
        if grade.confidence == "low":
            assert text.startswith(LOW_CONFIDENCE), case["id"]
        if grade.method == "semantic":
            assert "Correct" not in text, case["id"]


@pytest.mark.parametrize("confidence", ["high", "medium", "low"])
def test_render_is_deterministic_and_handles_a_grade_with_nothing_in_it(confidence):
    bare = Grade(score=0.0, confidence=confidence, method="semantic")
    assert render(bare, EVIDENCE) == render(bare, EVIDENCE) != ""


def test_feedback_uses_no_llm_no_database_and_no_model():
    source = Path(feedback.__file__).read_text(encoding="utf-8")
    for banned in ("langchain", "services.llm", "supabase", "embedder", "numpy"):
        assert banned not in source
