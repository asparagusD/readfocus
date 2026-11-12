"""Grade one answer: a score from 0 to 1, how sure the grade is, and why.

decide(GradeInput) is pure. Closed questions (cloze, multiple choice) are
string matches: exact or a rapidfuzz ratio at or above the policy threshold.
Free text is a weighted sum of three parts, each 0..1:

    cosine     meaning: cosine(answer, evidence), rescaled between a floor
               and the value a faithful paraphrase reaches
    coverage   the share of the question's key terms found in the answer
    relevance  a sanity check that the answer is about the passage at all

Confidence is low when the grade should not be read as certain: an answer of
fewer than four tokens, a copy of the question, a cosine inside the
ambiguous band, a near-miss spelling, or no embedding. It is medium next to
the band or when meaning and key terms disagree, and free text is never
above medium: an answer that reverses the evidence in its own words scores
like a right one. High is for string matches and for an empty answer.

grade_all() is the only function that embeds; the embedder is passed in.
"""

import re
from collections.abc import Callable
from typing import Literal

import numpy as np
from pydantic import BaseModel
from rapidfuzz import fuzz

from backend.agents import policy
from backend.nlp import text
from backend.nlp.concepts import lemma, normalize_phrase

CLOSED = ("cloze", "multiple_choice")
# "(b) oxygen", "b) oxygen", "b. oxygen", "(b)": an option letter set off by punctuation, then the rest.
_MARKED = re.compile(r"^(?:\(([a-h])\)|([a-h])[.):])\s*(.*)$", re.DOTALL)


class GradeInput(BaseModel):
    question: str
    answer: str  # what the reader wrote
    evidence: str = ""  # verbatim sentences, pieces separated by a blank line
    key_terms: list[str] = []
    strategy: str | None = None
    expected: str | None = None  # the stored reference answer, if any
    options: list[str] | None = None
    cosine: float | None = None  # cosine(answer, evidence); free text only
    question_cosine: float | None = None  # cosine(answer, question)


class Grade(BaseModel):
    score: float
    confidence: Literal["high", "medium", "low"]
    matched_concepts: list[str] = []
    missing_concepts: list[str] = []
    method: str  # the rule that produced the score
    components: dict[str, float] = {}
    reasons: list[str] = []  # why the confidence is not high


def is_closed(data: GradeInput) -> bool:
    if data.strategy is not None:
        return data.strategy in CLOSED
    return policy.BLANK in data.question


def _rescale(value: float, floor: float, full: float) -> float:
    return min(1.0, max(0.0, (value - floor) / (full - floor)))


def _ratio(expected: str, answer: str) -> float:
    """Best rapidfuzz ratio (0..100) of `expected` against the answer or any stretch of it as long."""
    want, got = text.tokenize(expected), text.tokenize(answer)
    if not want or not got:
        return 0.0
    target = " ".join(want)
    windows = [" ".join(got[i:i + len(want)]) for i in range(max(1, len(got) - len(want) + 1))]
    return max(fuzz.ratio(target, candidate) for candidate in [" ".join(got), *windows])


def _closed_result(expected: str, right: bool, confidence: str, method: str, score: float | None = None) -> Grade:
    return Grade(
        score=(1.0 if right else 0.0) if score is None else score, confidence=confidence, method=method,
        matched_concepts=[expected] if right else [], missing_concepts=[] if right else [expected],
        reasons=[method] if confidence == "low" else [],
    )


def _chosen_option(options: list[str], answer: str) -> str | None:
    """The option an answer picks: by its words first, by a letter only when the words do not settle it.

    "a computer" is the option "computer", not option (a); a bare "a" or "(a)" is option (a).
    """
    given = answer.strip().lower()
    marked = _MARKED.match(given)
    letter = (marked.group(1) or marked.group(2)) if marked else (given if len(given) == 1 else None)
    body = marked.group(3) if marked else given
    by_letter = None
    if letter and "a" <= letter <= "h" and ord(letter) - ord("a") < len(options):
        by_letter = options[ord(letter) - ord("a")]
    if by_letter and not body.strip(letter + " "):
        return by_letter  # nothing but the letter
    spoken = " ".join(text.tokenize(body))
    whole = [o for o in options if fuzz.ratio(" ".join(text.tokenize(o)), spoken) >= policy.GRADE_FUZZY_RATIO]
    inside = [o for o in options if _ratio(o, body) >= policy.GRADE_FUZZY_RATIO]
    for matches in (whole, inside):
        if len(matches) == 1:
            return matches[0]
    return by_letter if marked else None


def _grade_closed(data: GradeInput) -> Grade:
    expected = data.expected or (data.key_terms[0] if data.key_terms else "")
    if data.options:
        chosen = _chosen_option(data.options, data.answer)
        if chosen is None:
            return _closed_result(expected, False, "low", "unmatched_option")
        right = " ".join(text.tokenize(chosen)) == " ".join(text.tokenize(expected))
        return _closed_result(expected, right, "high", "option")
    ratio = _ratio(expected, data.answer)
    if ratio >= policy.GRADE_FUZZY_RATIO:
        return _closed_result(expected, True, "high", "exact" if ratio == 100 else "fuzzy")
    if ratio >= policy.GRADE_NEAR_MISS_RATIO:
        return _closed_result(expected, False, "low", "near_miss", policy.GRADE_NEAR_MISS_SCORE)
    return _closed_result(expected, False, "high", "no_match")


def coverage(key_terms: list[str], answer: str) -> tuple[list[str], list[str]]:
    """Key terms found in the answer and those missing; every word of a term must be there."""
    words = [lemma(token) for token in text.tokenize(answer)]

    def found(term: str) -> bool:
        parts = normalize_phrase(term).split()
        return bool(parts) and all(
            any(fuzz.ratio(part, word) >= policy.GRADE_FUZZY_RATIO for word in words) for part in parts
        )

    matched = [term for term in key_terms if found(term)]
    return matched, [term for term in key_terms if term not in matched]


def copies_question(question: str, answer: str) -> bool:
    asked, given = text.tokenize(question), text.tokenize(answer)
    if not given:
        return False
    return set(given) <= set(asked) or fuzz.ratio(" ".join(asked), " ".join(given)) >= policy.GRADE_COPY_RATIO


def _grade_free(data: GradeInput) -> Grade:
    matched, missing = coverage(data.key_terms, data.answer)
    if copies_question(data.question, data.answer):
        return Grade(
            score=0.0, confidence="low", method="question_copy", matched_concepts=[], missing_concepts=data.key_terms,
            components={"cosine": 0.0, "coverage": 0.0, "relevance": 0.0}, reasons=["question_copy"],
        )
    cosine = data.cosine
    related = max((value for value in (cosine, data.question_cosine) if value is not None), default=0.0)
    components = {
        "cosine": 0.0 if cosine is None else _rescale(cosine, policy.GRADE_COSINE_FLOOR, policy.GRADE_COSINE_FULL),
        "coverage": len(matched) / len(data.key_terms) if data.key_terms else 0.0,
        "relevance": _rescale(related, policy.GRADE_RELEVANCE_FLOOR, policy.GRADE_RELEVANCE_FULL)
        if text.content_words(data.answer) else 0.0,
    }
    weights = dict(policy.GRADE_WEIGHTS)
    if not data.key_terms:  # nothing to cover: the coverage share goes to meaning
        weights["cosine"] += weights.pop("coverage")
    score = sum(weight * components[name] for name, weight in weights.items())

    low, high = policy.GRADE_AMBIGUOUS_COSINE
    margin = policy.GRADE_AMBIGUOUS_MARGIN
    reasons, confidence = [], "high"
    if cosine is None:
        reasons.append("no_embedding")
    elif low <= cosine <= high:
        reasons.append("ambiguous_cosine")
    if len(text.tokenize(data.answer)) < policy.GRADE_MIN_TOKENS:
        reasons.append("short_answer")
    if reasons:
        confidence = "low"
    else:
        if low - margin <= cosine <= high + margin:
            reasons.append("near_ambiguous_cosine")
        if data.key_terms and abs(components["cosine"] - components["coverage"]) >= policy.GRADE_DISAGREEMENT:
            reasons.append("signals_disagree")
        if not reasons:  # meaning cannot be checked for a reversal, so free text is never certain
            reasons.append("free_text_cap")
        confidence = policy.GRADE_FREE_TEXT_MAX_CONFIDENCE
    return Grade(
        score=round(min(1.0, max(0.0, score)), 4), confidence=confidence, method="semantic",
        matched_concepts=matched, missing_concepts=missing, components=components, reasons=reasons,
    )


def decide(data: GradeInput) -> Grade:
    if not data.answer.strip():
        return Grade(score=0.0, confidence="high", method="empty", missing_concepts=data.key_terms)
    return _grade_closed(data) if is_closed(data) else _grade_free(data)


def _pieces(data: GradeInput) -> list[str]:
    """The texts an answer is compared with: each evidence sentence, all of them, the reference answer."""
    parts = [part.strip() for part in data.evidence.split("\n\n") if part.strip()]
    whole = [" ".join(parts)] if len(parts) > 1 else []
    return list(dict.fromkeys([*parts, *whole, *([data.expected] if data.expected else [])]))


def grade_all(inputs: list[GradeInput], embed: Callable[[list[str]], np.ndarray]) -> list[Grade]:
    """Grade a test: one embedding call for every free-text answer, then decide() on each."""
    free = [data for data in inputs if data.answer.strip() and not is_closed(data)]
    texts = list(dict.fromkeys(t for data in free for t in (data.answer, data.question, *_pieces(data))))
    try:
        vectors = dict(zip(texts, embed(texts))) if texts else {}
    except Exception as error:  # noqa: BLE001 - any embedder failure: grade on key terms, marked uncertain
        print(f"Grader: embedding failed, grading on key terms only: {error}")
        vectors = {}
    grades = []
    for data in inputs:
        if data in free and vectors:
            answer = vectors[data.answer]
            near = [float(answer @ vectors[piece]) for piece in _pieces(data)]
            data = data.model_copy(update={
                "cosine": max(near, default=None), "question_cosine": float(answer @ vectors[data.question]),
            })
        grades.append(decide(data))
    return grades
