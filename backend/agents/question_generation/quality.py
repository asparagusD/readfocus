"""Quality filter for generated questions. Pure: no I/O, no model.

reject_reason     why a question cannot be used, or None
score             0..1, how good a question that can be used is
filter_questions  drop rejects and near-duplicates, set `quality` on the rest

A question is rejected when its answer is only pronouns and stopwords, its
evidence is shorter than a real sentence, or its prompt contains the answer.
Of two questions whose prompt embeddings are nearly the same, the one with
the higher score stays. The embeddings are passed in; thresholds and
weights are in backend/agents/policy.py.
"""

from collections import Counter

import numpy as np
from pydantic import BaseModel

from backend.agents import policy
from backend.agents.question_generation.strategies import Question
from backend.nlp import text

_EMPTY_WORDS = text.STOPWORDS | text.PRONOUN_OPENERS


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


def reject_reason(question: Question) -> str | None:
    """The first reason the question cannot be used, or None if it can."""
    answer = text.tokenize(question.answer)
    if all(word in _EMPTY_WORDS for word in answer):  # also true of an empty answer
        return "answer_is_stopword"
    if len(text.tokenize(" ".join(question.evidence))) < policy.QUALITY_MIN_EVIDENCE_TOKENS:
        return "evidence_too_short"
    if _contains(text.tokenize(question.prompt), answer):
        return "answer_in_prompt"
    return None


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
    for index in sorted(scores, key=lambda i: (-scores[i], i)):  # best first, so the better duplicate stays
        duplicate = any(
            float(vectors[index] @ vectors[other]) > policy.QUALITY_DUPLICATE_COSINE
            and not _same_item(questions[index], questions[other])
            for other in kept
        )
        if duplicate:
            reasons[index] = "near_duplicate"
        else:
            kept.append(index)
    return FilterResult(
        accepted=[questions[i].model_copy(update={"quality": scores[i]}) for i in sorted(kept)],
        rejected=[Rejection(question=questions[i], reason=reasons[i]) for i in sorted(reasons)],
    )
