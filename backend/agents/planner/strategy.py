"""Reading strategy, pure: decide(PlannerInput) -> SessionPlan. No I/O.

Order of rules:
1. The first entry of the re-read queue that is a candidate is read again.
2. Otherwise each anchor is scored on four components (weights in
   policy.PLANNER_WEIGHTS): the next unread section, and every section
   already read that has a weak concept or one due for review. The best
   score wins; a tie goes to the earlier section.
3. A new-reading anchor is extended with the sections that follow it while
   the words stay within the target (the optimizer's multiplier and
   recommended minutes); review and re-reading take one section.
4. No anchor at all means the book is finished.

The caller passes `now`, the candidate chunks and the reader's concept
states, so the same input always gives the same plan.
"""

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from backend.agents import policy

Mode = Literal["new", "re_read", "review", "finished"]


class ChunkInfo(BaseModel):
    index: int
    word_count: int
    concept_keys: list[str] = []
    difficulty: float | None = None  # 0..1, for example the mean difficulty of its bank questions


class ConceptState(BaseModel):
    concept_key: str
    label: str = ""
    mastery: float = policy.MASTERY_PRIOR
    attempts: int = 0
    correct: int = 0
    next_review: datetime | None = None


class PaceHint(BaseModel):
    """The parts of the optimizer's last pace_recommendation the planner uses."""
    next_chunk_multiplier: float = 1.0
    focus_duration_minutes: int | None = None


class PlannerInput(BaseModel):
    now: datetime
    chunks: list[ChunkInfo]  # the read sections and the next unread ones, any order
    concepts: list[ConceptState] = []
    last_chunk_index: int = -1  # -1: nothing read yet
    re_read_queue: list[int] = []
    recent_percentages: list[float] = []  # newest first, 0..100
    wpm: int | None = None
    pace: PaceHint | None = None


class ChunkScore(BaseModel):
    index: int
    score: float
    components: dict[str, float]


class SessionPlan(BaseModel):
    mode: Mode
    rule: str
    chunk_indices: list[int]
    assigned_words: int
    focus_duration_minutes: int
    question_mix: list[tuple[list[str], int]]
    reason: str
    scores: list[ChunkScore]  # every anchor, best first


def _recent_mean(data: PlannerInput) -> float | None:
    recent = data.recent_percentages[:policy.PLANNER_RECENT_TESTS]
    return sum(recent) / len(recent) / 100 if recent else None


def _target_difficulty(mean: float | None) -> float:
    if mean is not None and mean < policy.PLANNER_LOW_SCORE:
        return policy.PLANNER_TARGET_DIFFICULTY["low"]
    if mean is not None and mean >= policy.PLANNER_HIGH_SCORE:
        return policy.PLANNER_TARGET_DIFFICULTY["high"]
    return policy.PLANNER_TARGET_DIFFICULTY["mid"]


def _is_weak(state: ConceptState) -> bool:
    return state.attempts > 0 and state.mastery < policy.PLANNER_WEAK_BELOW


def _is_due(state: ConceptState, now: datetime) -> bool:
    return state.attempts > 0 and state.next_review is not None and state.next_review <= now


def _share(chunk: ChunkInfo, test) -> float:
    return sum(1 for key in chunk.concept_keys if test(key)) / len(chunk.concept_keys) if chunk.concept_keys else 0.0


def _score(chunk: ChunkInfo, unread: bool, weak: set[str], due: set[str], target: float) -> ChunkScore:
    fit = policy.PLANNER_UNKNOWN_DIFFICULTY_FIT if chunk.difficulty is None else max(
        0.0, 1 - abs(chunk.difficulty - target) / policy.PLANNER_DIFFICULTY_SPAN
    )
    components = {
        "weak_concept_coverage": _share(chunk, weak.__contains__),
        "unread": 1.0 if unread else 0.0,
        "difficulty_fit": fit,
        "due_for_review": _share(chunk, due.__contains__),
    }
    score = sum(policy.PLANNER_WEIGHTS[name] * value for name, value in components.items())
    return ChunkScore(index=chunk.index, score=score, components=components)


def _word_target(data: PlannerInput, wpm: int) -> float:
    pace = data.pace or PaceHint()
    low, high = policy.PLANNER_MULTIPLIER_RANGE
    target = policy.PLANNER_BASE_WORDS * min(high, max(low, pace.next_chunk_multiplier))
    if pace.focus_duration_minutes:
        target = min(target, pace.focus_duration_minutes * wpm)
    return target


def _minutes(words: int, wpm: int, slow: bool) -> int:
    low, high = policy.PLANNER_MINUTES_RANGE
    minutes = words / wpm * (1 + (policy.PLANNER_SLOW_BUFFER if slow else 0))
    return min(high, max(low, math.ceil(round(minutes, 6))))


def _sections(indices: list[int]) -> str:
    first, last = indices[0] + 1, indices[-1] + 1
    return f"section {first}" if first == last else f"sections {first}–{last}"


def _times(n: int) -> str:
    return {1: "once", 2: "twice"}.get(n, f"{n} times")


def _label(state: ConceptState) -> str:
    return state.label or state.concept_key.replace("-", " ")


def _review_reason(chunk: ChunkInfo, states: dict[str, ConceptState], weak: set[str], due: set[str]) -> tuple[str, str]:
    weak_here = [states[key] for key in chunk.concept_keys if key in weak]
    if weak_here:
        worst = min(weak_here, key=lambda s: (-(s.attempts - s.correct), s.mastery, s.concept_key))
        misses = worst.attempts - worst.correct
        tail = f"you missed it {_times(misses)}" if misses else "it still needs work"
        return "weak_concepts", f"Revisiting *{_label(worst)}* — {tail}."
    first_due = min((states[key] for key in chunk.concept_keys if key in due), key=lambda s: s.concept_key)
    return "due_for_review", f"Revisiting *{_label(first_due)}* — it is due for review."


def decide(data: PlannerInput) -> SessionPlan:
    wpm = data.wpm if data.wpm and data.wpm > 0 else policy.PLANNER_DEFAULT_WPM
    by_index = {chunk.index: chunk for chunk in data.chunks}
    mean = _recent_mean(data)
    slow = mean is not None and mean < policy.PLANNER_LOW_SCORE

    def plan(mode: Mode, rule: str, indices: list[int], reason: str, scores: list[ChunkScore]) -> SessionPlan:
        words = sum(by_index[i].word_count for i in indices)
        return SessionPlan(
            mode=mode, rule=rule, chunk_indices=indices, assigned_words=words,
            focus_duration_minutes=_minutes(words, wpm, slow or mode != "new") if indices else 0,
            question_mix=policy.PLANNER_QUESTION_MIX.get(mode, []), reason=reason, scores=scores,
        )

    # 1. Re-read queue first.
    queued = next((index for index in data.re_read_queue if index in by_index), None)
    if queued is not None:
        reason = f"Re-reading {_sections([queued])} before moving on — your last test on it was low."
        return plan("re_read", "re_read_queue", [queued], reason, [])

    # 2. Score the anchors.
    states = {state.concept_key: state for state in data.concepts}
    weak = {key for key, state in states.items() if _is_weak(state)}
    due = {key for key, state in states.items() if _is_due(state, data.now)}
    target = _target_difficulty(mean)
    unread = sorted(index for index in by_index if index > data.last_chunk_index)
    anchors = [
        _score(chunk, False, weak, due, target) for chunk in data.chunks
        if chunk.index <= data.last_chunk_index and any(key in weak or key in due for key in chunk.concept_keys)
    ]
    if unread:
        anchors.append(_score(by_index[unread[0]], True, weak, due, target))
    scores = sorted(anchors, key=lambda s: (-round(s.score, 9), s.index))
    if not scores:
        return plan("finished", "finished", [], "You have read every section and nothing is due for review.", [])

    best = by_index[scores[0].index]
    if best.index <= data.last_chunk_index:
        rule, reason = _review_reason(best, states, weak, due)
        return plan("review", rule, [best.index], reason, scores)

    # 3. Extend new reading with the sections that follow, within the target.
    target_words, indices, words = _word_target(data, wpm), [best.index], best.word_count
    while len(indices) < policy.PLANNER_MAX_CHUNKS and indices[-1] + 1 in by_index:
        following = by_index[indices[-1] + 1]
        if words + following.word_count > target_words:
            break
        indices.append(following.index)
        words += following.word_count
    multiplier = (data.pace or PaceHint()).next_chunk_multiplier
    tail = (" — a lighter session after your last test" if multiplier < 1
            else " — a little more, since you are scoring well" if multiplier > 1 else "")
    opening = "Starting the book with" if data.last_chunk_index < 0 else "Continuing with"
    return plan("new", "next_unread", indices, f"{opening} {_sections(indices)}, about {words} words{tail}.", scores)
