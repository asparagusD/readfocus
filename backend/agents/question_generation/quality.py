"""Quality filter for generated questions. Pure: no I/O, no model.

reject_reason     why a question cannot be used, or None
score             0..1, how good a question that can be used is
filter_questions  drop rejects and near-duplicates, set `quality` on the rest

A question is rejected when its answer is only pronouns and stopwords, its
evidence is shorter than a real sentence, its prompt contains the answer,
or its evidence is not body text (boilerplate_reason: front matter, a
reference entry, page furniture). Of two questions whose prompt embeddings
are nearly the same, the one with the higher score stays, and each strategy
keeps only its best few. filter_questions is meant to be called with the
questions of one chunk. The embeddings are passed in; thresholds, weights
and caps are in backend/agents/policy.py.
"""

import re
from collections import Counter

import numpy as np
from pydantic import BaseModel

from backend.agents import policy
from backend.agents.question_generation.strategies import Question
from backend.nlp import text

_EMPTY_WORDS = text.STOPWORDS | text.PRONOUN_OPENERS

# Text that is in the book but is not the book: metadata, references, page furniture.
_FRONT_MATTER = re.compile(
    r"\b(?:received|accepted|published|revised|citation|keywords?|academic editor|correspondence"
    r"|copyright|licensee)\s*:|©|\b[\w.+-]+@[\w-]+\.\w+|\ball rights reserved\b|\bcreative commons\b",
    re.IGNORECASE,
)
_REFERENCE = re.compile(r"\bdoi\b|https?://|\bwww\.|\barxiv\b|\[crossref\]|\bisbn\b", re.IGNORECASE)
_CITED_AUTHOR = re.compile(r"\b[A-Z][a-z]+, (?:[A-Z]\.)+")  # "Balanis, C.A."
_YEAR = re.compile(r"\b(?:19|20)\d\d\b")
_PAGE_FURNITURE = re.compile(
    r"\b\d+ of \d+\b"                   # running header: "6 of 13"
    r"|\b(?:19|20)\d\d, \d+, \d+\b"     # journal header: "2025, 14, 2510"
    r"|^(?:Figure|Fig\.|Table)\s+\d+\s*[.:]"  # caption
)


class Rejection(BaseModel):
    question: Question
    reason: str


class FilterResult(BaseModel):
    accepted: list[Question]
    rejected: list[Rejection]

    def counts(self) -> dict[str, int]:
        return dict(Counter(rejection.reason for rejection in self.rejected))


def _contains(words: list[str], phrase: list[str]) -> bool:
    """True if `phrase` occurs in `words` as a run of whole words."""
    return any(words[i:i + len(phrase)] == phrase for i in range(len(words) - len(phrase) + 1))


def boilerplate_reason(sentence: str) -> str | None:
    """`front_matter`, `reference_entry` or `page_furniture` if the sentence is not body text, else None."""
    sentence = text.normalize(sentence)
    if _FRONT_MATTER.search(sentence):
        return "front_matter"
    if _REFERENCE.search(sentence) or (_CITED_AUTHOR.search(sentence) and _YEAR.search(sentence)):
        return "reference_entry"
    if _PAGE_FURNITURE.search(sentence):
        return "page_furniture"
    tokens = text.tokenize(sentence)
    numbers = sum(token.isdigit() for token in tokens)
    if len(tokens) >= policy.BOILERPLATE_MIN_WORDS and numbers / len(tokens) >= policy.BOILERPLATE_DIGIT_SHARE:
        return "page_furniture"  # a row of a table
    words = [word for word in sentence.split() if word[0].isalpha()]
    capitalised = sum(word[0].isupper() for word in words)
    if len(words) >= policy.BOILERPLATE_MIN_WORDS and capitalised / len(words) >= policy.BOILERPLATE_CAPITALISED_SHARE:
        return "front_matter"  # a title, a list of authors or affiliations
    return None


def reject_reason(question: Question) -> str | None:
    """The first reason the question cannot be used, or None if it can."""
    answer = text.tokenize(question.answer)
    if all(word in _EMPTY_WORDS for word in answer):  # also true of an empty answer
        return "answer_is_stopword"
    if len(text.tokenize(" ".join(question.evidence))) < policy.QUALITY_MIN_EVIDENCE_TOKENS:
        return "evidence_too_short"
    if _contains(text.tokenize(question.prompt), answer):
        return "answer_in_prompt"
    return next((reason for reason in map(boilerplate_reason, question.evidence) if reason), None)


def _answer_length_score(words: int) -> float:
    ideal, limit = policy.QUALITY_ANSWER_TOKENS
    if words == 0:
        return 0.0
    if words <= ideal:
        return 1.0
    return max(0.0, (limit - words) / (limit - ideal))


def score(question: Question) -> float:
    """Quality from 0 to 1: informative evidence, an answer short enough to grade, key terms to grade it by."""
    evidence = [text.informativeness(piece) for piece in question.evidence]
    parts = {
        "evidence": sum(evidence) / len(evidence) if evidence else 0.0,
        "answer": _answer_length_score(len(text.tokenize(question.answer))),
        "key_terms": min(len(question.key_terms), policy.QUALITY_KEY_TERMS_FULL) / policy.QUALITY_KEY_TERMS_FULL,
    }
    total = sum(policy.QUALITY_WEIGHTS[name] * value for name, value in parts.items())
    return round(min(1.0, max(0.0, total)), 4)


def _same_item(a: Question, b: Question) -> bool:
    """A multiple-choice question and the cloze it was made from: one item in two formats."""
    return a.strategy != b.strategy and a.evidence == b.evidence and a.answer == b.answer


def filter_questions(questions: list[Question], prompt_vectors: np.ndarray) -> FilterResult:
    """Accepted questions in their original order, each with `quality` set, and the rejects with reasons.

    `prompt_vectors` holds one embedding per question prompt, in order.
    """
    if len(prompt_vectors) != len(questions):
        raise ValueError(f"{len(questions)} questions but {len(prompt_vectors)} vectors")
    reasons: dict[int, str] = {}
    scores: dict[int, float] = {}
    for index, question in enumerate(questions):
        reason = reject_reason(question)
        if reason:
            reasons[index] = reason
        else:
            scores[index] = score(question)
    if not questions:
        return FilterResult(accepted=[], rejected=[])
    vectors = np.asarray(prompt_vectors, dtype=np.float64)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    vectors = vectors / np.where(norms == 0, 1.0, norms)
    kept: list[int] = []
    used: Counter[str] = Counter()
    for index in sorted(scores, key=lambda i: (-scores[i], i)):  # best first, so the better duplicate stays
        duplicate = any(
            float(vectors[index] @ vectors[other]) > policy.QUALITY_DUPLICATE_COSINE
            and not _same_item(questions[index], questions[other])
            for other in kept
        )
        strategy = questions[index].strategy
        if duplicate:
            reasons[index] = "near_duplicate"
        elif used[strategy] >= policy.QUESTION_CAPS.get(strategy, policy.QUESTION_CAP_DEFAULT):
            reasons[index] = "over_cap"
        else:
            used[strategy] += 1
            kept.append(index)
    return FilterResult(
        accepted=[questions[i].model_copy(update={"quality": scores[i]}) for i in sorted(kept)],
        rejected=[Rejection(question=questions[i], reason=reasons[i]) for i in sorted(reasons)],
    )
