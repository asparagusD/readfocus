"""Learning optimizer, pure: decide(OptimizerInput) -> PaceRecommendation. No I/O.

Rules, every bound in backend/agents/policy.py:
1. Bands. This test's percentage decides re-reading: reduce appends the
   session's sections to the re-read queue, fail puts them first and turns
   on re-read mode, a pass takes them off. The rolling mean (this test and
   the ones before it) picks the multiplier factor, so one test is damped.
2. A test below the hold band never grows the session, whatever the mean.
3. Recent abandonment caps the factor, so sessions shrink, not grow.
4. The multiplier compounds on the previous one and stays in the planner's
   range; the queue stays within its maximum.
5. Focus minutes: the next word target over the reading speed, measured
   from this session within bounds of the profile speed.
6. Question mix: the worst failing question type gets one place, taken from
   the passing group with most places; one move per test, places in range.

The output keeps the keys Results.jsx reads (next_chunk_multiplier,
focus_duration_minutes, re_read_mode, reason).
"""

import math

from pydantic import BaseModel

from backend.agents import policy

Mix = list[tuple[list[str], int]]

STRATEGY_NAMES = {
    "cloze": "fill-in-the-blank", "multiple_choice": "multiple-choice", "definition": "definition",
    "why_how": "why-or-how", "main_idea": "main-idea",
}
OPENERS = {
    "grow": "Strong result", "hold": "Solid result",
    "reduce": "Some of this did not stick", "fail": "This one was hard",
}
QUEUE_NOTES = {"reduce": "this section is on your re-read list", "fail": "you will re-read this section first"}


class QuestionOutcome(BaseModel):
    strategy: str | None = None
    score: float  # 0..1


class OptimizerInput(BaseModel):
    percentage: float  # this test, 0..100
    chunk_indices: list[int]  # the sections this session covered
    recent_percentages: list[float] = []  # earlier tests on this book, newest first
    re_read_queue: list[int] = []
    previous_multiplier: float = 1.0
    recent_abandoned: list[bool] = []  # earlier sessions, newest first: True if abandoned
    wpm: int | None = None
    session_words: int = 0
    actual_minutes: float | None = None
    outcomes: list[QuestionOutcome] = []  # this test's and recent tests' answers
    previous_mix: Mix | None = None


class PaceRecommendation(BaseModel):
    next_chunk_multiplier: float
    focus_duration_minutes: int
    re_read_mode: bool
    reason: str
    re_read_queue: list[int]
    question_mix: Mix
    reading_wpm: float  # the speed the minutes assume; the planner should use the same
    band: str
    rolling_percentage: float
    rules: list[str]


def _band(percentage: float) -> tuple[str, float]:
    for bound, band, factor in policy.OPT_BANDS:
        if percentage >= bound:
            return band, factor
    return policy.OPT_BANDS[-1][1], policy.OPT_BANDS[-1][2]


def _queue(data: OptimizerInput, band: str) -> list[int]:
    queue = list(data.re_read_queue)
    if band == "fail":
        queue = list(data.chunk_indices) + [index for index in queue if index not in data.chunk_indices]
    elif band == "reduce":
        queue += [index for index in data.chunk_indices if index not in queue]
    else:
        queue = [index for index in queue if index not in data.chunk_indices]
    return queue[:policy.OPT_REREAD_QUEUE_MAX]


def _reading_wpm(data: OptimizerInput) -> float:
    wpm = data.wpm if data.wpm and data.wpm > 0 else policy.PLANNER_DEFAULT_WPM
    if not data.actual_minutes or data.actual_minutes <= 0 or data.session_words <= 0:
        return float(wpm)
    low, high = policy.OPT_SPEED_RANGE
    return min(wpm * high, max(wpm * low, data.session_words / data.actual_minutes))


def _mix(data: OptimizerInput) -> tuple[Mix, str | None]:
    mix = [(list(strategies), places) for strategies, places in (data.previous_mix or policy.TEST_MIX)]
    low, high = policy.OPT_MIX_PLACES_RANGE
    means: list[float | None] = []
    for strategies, _ in mix:
        scores = [outcome.score for outcome in data.outcomes if outcome.strategy in strategies]
        means.append(sum(scores) / len(scores) if len(scores) >= policy.OPT_TYPE_MIN_SAMPLES else None)
    failing = [i for i, mean in enumerate(means) if mean is not None and mean < policy.OPT_TYPE_FAIL_BELOW]
    takers = sorted((i for i in failing if mix[i][1] < high), key=lambda i: (means[i], i))
    donors = sorted(
        (i for i, (_, places) in enumerate(mix) if i not in failing and places > low),
        key=lambda i: (-mix[i][1], -(means[i] if means[i] is not None else policy.OPT_TYPE_FAIL_BELOW), i),
    )
    if not takers or not donors:
        return mix, None
    taker, donor = takers[0], donors[0]
    mix[taker] = (mix[taker][0], mix[taker][1] + 1)
    mix[donor] = (mix[donor][0], mix[donor][1] - 1)
    weakest = min(mix[taker][0], key=lambda s: _type_mean(data, s))
    return mix, STRATEGY_NAMES.get(weakest, weakest)


def _type_mean(data: OptimizerInput, strategy: str) -> float:
    scores = [outcome.score for outcome in data.outcomes if outcome.strategy == strategy]
    return sum(scores) / len(scores) if scores else 1.0


def decide(data: OptimizerInput) -> PaceRecommendation:
    rules: list[str] = []
    band, _ = _band(data.percentage)
    window = [data.percentage, *data.recent_percentages[:policy.OPT_ROLLING_TESTS - 1]]
    rolling = sum(window) / len(window)
    rolling_band, factor = _band(rolling)
    rules.append(f"rolling_{rolling_band}")

    if band in ("reduce", "fail") and factor > 1.0:
        factor = 1.0
        rules.append("no_growth_after_low_test")
    abandoned = sum(data.recent_abandoned[:policy.OPT_ABANDON_WINDOW])
    if abandoned >= policy.OPT_ABANDON_LIMIT:
        factor = min(factor, policy.OPT_ABANDON_FACTOR)
        rules.append("abandonment")

    low, high = policy.PLANNER_MULTIPLIER_RANGE
    multiplier = round(min(high, max(low, data.previous_multiplier * factor)), 6)
    queue = _queue(data, band)
    reading_wpm = _reading_wpm(data)
    words = policy.PLANNER_BASE_WORDS * multiplier
    min_minutes, max_minutes = policy.PLANNER_MINUTES_RANGE
    minutes = min(max_minutes, max(min_minutes, math.ceil(round(words / reading_wpm, 6))))
    mix, more_of = _mix(data)
    if more_of:
        rules.append("question_mix")

    direction = ("a little longer" if multiplier > data.previous_multiplier
                 else "a little shorter" if multiplier < data.previous_multiplier else "the same length")
    verb = "stays" if direction == "the same length" else "is"
    reason = f"{OPENERS[band]} — the next session {verb} {direction}"
    reason += f", and {QUEUE_NOTES[band]}." if band in QUEUE_NOTES else "."
    if "abandonment" in rules:
        reason += " You stopped early recently, so sessions stay short for now."
    if more_of:
        reason += f" One more {more_of} question next time."

    return PaceRecommendation(
        next_chunk_multiplier=multiplier, focus_duration_minutes=minutes, re_read_mode=band == "fail",
        reason=reason, re_read_queue=queue, question_mix=mix, reading_wpm=reading_wpm, band=band,
        rolling_percentage=rolling, rules=rules,
    )
