"""Test assembly: choose a session's questions from its chunks' bank rows. Pure, no I/O.

decide(AssemblyInput) fills the places of a mix (by default two multiple
choice, one cloze, one definition or why/how, one main idea) and then any
places still empty from the rest. Within a place a question is preferred
when it has been used less, comes from a chunk the test has drawn on less,
is nearer the target difficulty, and has the higher quality. One sentence
is never asked about twice, so a cloze and its multiple-choice twin cannot
both appear, and no two questions have the same answer, so the options of
one cannot give another away. The mix is an argument so the optimizer can
change it later.

session_question() is what is stored with the session for grading;
public_question() is the only form that may be sent to the client: it has
no answer, evidence, key terms or hints.
"""

import hashlib
from collections import Counter

from pydantic import BaseModel

from backend.agents import policy

PUBLIC_KEYS = ("question", "type", "options")
OPTION_LETTERS = "abcdefgh"


class BankQuestion(BaseModel):
    """The columns of a question_bank row that assembly and grading use."""

    id: str
    chunk_index: int
    type: str
    strategy: str
    prompt: str
    answer: str | None = None
    evidence: str | None = None
    key_terms: list[str] | None = None
    distractors: list[str] | None = None
    difficulty: float | None = None
    quality: float | None = None
    times_used: int | None = 0


class AssemblyInput(BaseModel):
    questions: list[BankQuestion]
    mix: list[tuple[list[str], int]] | None = None  # (strategies that may fill the place, how many)
    count: int = policy.TEST_QUESTION_COUNT
    target_difficulty: float = policy.TEST_TARGET_DIFFICULTY


class AssemblyOutput(BaseModel):
    questions: list[BankQuestion]
    missing: dict[str, int]  # places of the mix that no question of that kind could fill


def _answer(question: BankQuestion) -> str:
    return (question.answer or "").strip().lower()


def decide(data: AssemblyInput) -> AssemblyOutput:
    mix = data.mix if data.mix is not None else policy.TEST_MIX
    picked: list[BankQuestion] = []
    asked: set[str | None] = set()
    answers: set[str] = set()
    per_chunk: Counter[int] = Counter()

    def rank(question: BankQuestion):
        difficulty = data.target_difficulty if question.difficulty is None else question.difficulty
        return (
            question.times_used or 0, per_chunk[question.chunk_index],
            round(abs(difficulty - data.target_difficulty), 6), -(question.quality or 0.0), question.id,
        )

    def take(candidates: list[BankQuestion], places: int) -> int:
        taken = 0
        while taken < places and len(picked) < data.count:
            chosen = {q.id for q in picked}
            pool = [
                q for q in candidates
                if q.id not in chosen and (q.evidence is None or q.evidence not in asked) and _answer(q) not in answers
            ]
            if not pool:
                break
            best = min(pool, key=rank)
            picked.append(best)
            asked.add(best.evidence)
            answers.add(_answer(best) or best.id)
            per_chunk[best.chunk_index] += 1
            taken += 1
        return taken

    missing = {}
    for strategies, places in mix:
        short = places - take([q for q in data.questions if q.strategy in strategies], places)
        if short and len(picked) < data.count:
            missing["+".join(strategies)] = short
    take(data.questions, data.count - len(picked))
    picked.sort(key=lambda question: question.strategy == "main_idea")  # stable: the summary closes the test
    return AssemblyOutput(questions=picked, missing=missing)


def _options(question: BankQuestion) -> list[str]:
    """The answer among its distractors, in an order fixed by the question's id."""
    options = dict.fromkeys([question.answer or "", *(question.distractors or [])])
    return sorted(options, key=lambda option: hashlib.sha256(f"{question.id}:{option}".encode()).hexdigest())


def session_question(question: BankQuestion) -> dict:
    """A picked question as stored in sessions.test_questions, with what grading needs."""
    stored = {
        "id": question.id, "question": question.prompt, "type": question.type, "strategy": question.strategy,
        "answer": question.answer or "", "evidence": question.evidence or "", "key_terms": question.key_terms or [],
        "guidance": f"A good answer says: {question.answer or ''}",
        "chunk_index": question.chunk_index, "difficulty": question.difficulty,
    }
    if question.strategy == "multiple_choice":
        stored["options"] = _options(question)
        # The test page shows only the question text, so the options are part of it.
        listed = "  ".join(f"({letter}) {option}" for letter, option in zip(OPTION_LETTERS, stored["options"]))
        stored["question"] = f"{question.prompt}\n{listed}"
    return stored


def public_question(stored: dict) -> dict:
    """The part of a session question the client may see."""
    return {key: stored[key] for key in PUBLIC_KEYS if key in stored}


def fallback_question() -> dict:
    """The one open question asked when a session's chunks have no bank rows at all."""
    return {
        "id": None, "question": "In your own words, what is the main idea of the passage you just read?",
        "type": "summary", "strategy": "fallback", "answer": "", "evidence": "", "key_terms": [],
        "guidance": "A good answer names the subject of the passage and the main thing said about it.",
        "chunk_index": None, "difficulty": None,
    }
