"""Feedback for one graded answer, built only from templates, key terms and the evidence.

render(grade, evidence) returns one or two short sentences. Nothing in them
is generated: the wording is one of the templates below, the terms are the
question's own key terms (which come from the passage), and the quotation
is a verbatim stretch of the evidence. So the feedback cannot state a fact
the passage does not.

What is said depends on how sure the grade is:

- low confidence: no verdict at all, only an invitation to compare the
  answer with the passage;
- closed questions (string matches): right or not, and the expected answer;
- free text: what the answer captured and what it missed. It never says
  "correct": the grader cannot check meaning for a reversal, so it reports
  the terms it found, and calls the score an estimate when its signals
  were in doubt.

Pure: no I/O, no model.
"""

import re

from backend.agents import policy
from backend.agents.evaluation.grader import Grade

LOW_CONFIDENCE = "We couldn't judge this confidently; compare your answer with the passage below."
EMPTY = "No answer was given."
EMPTY_POINTER = "Here is the part of the passage to look at:"
CLOSED_RIGHT = "Correct — the answer is {expected}."
CLOSED_WRONG = "Not quite — the answer is {expected}."
CLOSED_RIGHT_BARE = "Correct."
CLOSED_WRONG_BARE = "Not quite."
CLOSED_SEE = "See:"
CAPTURED = "You captured {terms}."
MISSED = "You missed {terms}"
SEE = "— see:"
OFF_TOPIC = "Your answer doesn't seem to be about this part of the passage"
CLOSE = "Your answer is close to what the passage says."
FAR = "Your answer differs from what the passage says"
ESTIMATE = "This score is an estimate."
JOINER = "and"

_TEMPLATES = (
    LOW_CONFIDENCE, EMPTY, EMPTY_POINTER, CLOSED_RIGHT, CLOSED_WRONG, CLOSED_RIGHT_BARE, CLOSED_WRONG_BARE,
    CLOSED_SEE, CAPTURED, MISSED, SEE, OFF_TOPIC, CLOSE, FAR, ESTIMATE, JOINER,
)
# Every word the templates can contribute; the tests check that feedback holds nothing else.
TEMPLATE_WORDS = frozenset(
    word for template in _TEMPLATES for word in re.findall(r"[a-z']+", re.sub(r"\{\w+\}", "", template).lower())
)


def snippet(evidence: str, missing: list[str]) -> str:
    """A verbatim stretch of the evidence: the sentence holding a missed term, else the first, cut at a word."""
    pieces = [piece.strip() for piece in evidence.split("\n\n") if piece.strip()]
    if not pieces:
        return ""
    wanted = [term.lower() for term in missing]
    piece = next((p for p in pieces if any(term in p.lower() for term in wanted)), pieces[0])
    if len(piece) <= policy.FEEDBACK_SNIPPET_CHARS:
        return piece
    return piece[:policy.FEEDBACK_SNIPPET_CHARS].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"


def _listed(terms: list[str]) -> str:
    terms = terms[:policy.FEEDBACK_MAX_TERMS]
    return terms[0] if len(terms) == 1 else f"{', '.join(terms[:-1])} {JOINER} {terms[-1]}"


def _with(sentence: str, link: str, quote: str) -> str:
    """`sentence` followed by the quotation, or closed with a full stop when there is none."""
    if quote:
        return f"{sentence} {link} {quote}"
    return sentence if sentence.endswith(".") else f"{sentence}."


def render(grade: Grade, evidence: str = "") -> str:
    shown = snippet(evidence, grade.missing_concepts)
    quote = f"“{shown}”" if shown else ""

    if grade.method == "empty":
        return f"{EMPTY} {EMPTY_POINTER} {quote}" if quote else EMPTY
    if grade.confidence == "low":
        return f"{LOW_CONFIDENCE} {quote}".strip()

    if grade.method != "semantic":  # cloze and multiple choice: a string match, so a verdict is safe
        expected = next(iter([*grade.matched_concepts, *grade.missing_concepts]), "")
        if grade.score >= 1.0:
            return CLOSED_RIGHT.format(expected=expected) if expected else CLOSED_RIGHT_BARE
        wrong = CLOSED_WRONG.format(expected=expected) if expected else CLOSED_WRONG_BARE
        return f"{wrong} {CLOSED_SEE} {quote}" if quote else wrong

    if grade.components.get("relevance", 1.0) == 0.0 and not grade.matched_concepts:
        return _with(OFF_TOPIC, SEE, quote)
    parts = []
    if grade.matched_concepts:
        parts.append(CAPTURED.format(terms=_listed(grade.matched_concepts)))
    if grade.missing_concepts:
        parts.append(_with(MISSED.format(terms=_listed(grade.missing_concepts)), SEE, quote))
    if not parts:
        parts.append(CLOSE if grade.score >= policy.FEEDBACK_CLOSE_SCORE else _with(FAR, SEE, quote))
    if any(reason != "free_text_cap" for reason in grade.reasons):
        parts.append(ESTIMATE)
    return " ".join(parts)
