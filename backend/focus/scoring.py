"""Focus scoring (C23.3, docs/FOCUS_RULES.md F3-F14): a session's time and points from its events. Pure: no I/O,
no clock; the same events always give the same result.

Time is the server's (`server_ts`); the tab's own clock (`client_ts`) is never read. The session runs from its
first event to its `end` (or its last event); every second of it gets one reason, in this order:
  paused        focus mode turned off (pause .. resume, F1);
  hidden        the tab in the background (hidden .. visible, F5);
  no_heartbeat  not between two accepted heartbeats at most MAX_GAP_S apart (a closed tab, a lost connection,
                a forged end: F3); heartbeats sooner than MIN_HEARTBEAT_GAP_S after the last accepted one, and
                any event resent with the same client id, are ignored;
  idle          from IDLE_PROMPT_S after the last input (start, page turn, heartbeat with input, idle answer,
                resume, visible) until the next input, when that input came more than IDLE_ANSWER_S after the
                prompt (F6);
  active        the rest, until SESSION_CAP_S of active time (then session_cap, F8). Active time on one page
                visit (from a page turn to the next) beyond PAGE_CAP_S is voided: active, but worth 0 (F7).
Points: floor(counted minutes x POINTS_PER_MINUTE); with a quiz, BONUS_PER_CORRECT per correct answer, and
everything 0 when the score is below PASS_SCORE (F11-F12).
"""

from bisect import bisect_right
from datetime import datetime
from fractions import Fraction
from itertools import pairwise
from math import floor
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.focus import policy

Kind = Literal["start", "heartbeat", "page_turn", "hidden", "visible", "idle_prompt", "idle_confirm", "pause",
               "resume", "end"]
INPUT_KINDS = {"start", "page_turn", "idle_confirm", "resume", "visible"}
REASONS = ("paused", "hidden", "no_heartbeat", "idle", "page_cap", "session_cap")


class Event(BaseModel):
    """One stored focus event (focus_events). Nothing in it is a duration or a score."""
    model_config = ConfigDict(extra="forbid")
    id: int = 0  # the row id: ties in server time keep the order they arrived in
    kind: Kind
    server_ts: datetime
    client_ts: datetime | None = None  # kept for diagnosis; never scored
    client_event_id: str | None = None
    page_key: str | None = None
    had_input: bool | None = None


class Quiz(BaseModel):
    """Correct answers (a low-confidence one counts half, C23.5) out of the questions asked."""
    model_config = ConfigDict(extra="forbid")
    correct: float = Field(ge=0)
    total: int = Field(ge=1)

    @model_validator(mode="after")
    def at_most_all(self):
        if self.correct > self.total:
            raise ValueError("more correct answers than questions")
        return self


class ScoringInput(BaseModel):
    events: list[Event]
    quiz: Quiz | None = None  # None while the session is open or its quiz not yet taken: points are provisional


class Line(BaseModel):
    """One row of the results breakdown (C23.7)."""
    code: str
    label: str
    seconds: int | None = None
    points: int
    capped: bool = False  # C23.8: the quiz bonus held to the time points


class ScoringOutput(BaseModel):
    active_seconds: int  # counted + voided, at most SESSION_CAP_S
    voided_seconds: int  # active, but beyond the page cap
    counted_seconds: int
    capped: bool
    reasons: dict[str, int]  # seconds not counted, by reason (non-zero only)
    points_time: int
    points_bonus: int
    points_total: int
    passed: bool | None
    final: bool
    quiz_correct: float | None
    quiz_total: int | None
    rules_version: str
    lines: list[Line]


def _ordered(events: list[Event]) -> list[Event]:
    """Server order; one copy of each client id; nothing after the first end."""
    seen, out = set(), []
    for e in sorted(events, key=lambda e: (e.server_ts, e.id)):
        if e.client_event_id is not None:
            if e.client_event_id in seen:
                continue
            seen.add(e.client_event_id)
        out.append(e)
        if e.kind == "end":
            break
    return out


def _toggled(timed: list[tuple[float, Event]], on: str, off: str, end: float) -> list[tuple[float, float]]:
    windows, since = [], None
    for t, e in timed:
        if e.kind == on and since is None:
            since = t
        elif e.kind == off and since is not None:
            windows.append((since, t))
            since = None
    if since is not None:
        windows.append((since, end))
    return windows


def _covered(timed: list[tuple[float, Event]]) -> list[tuple[float, float]]:
    beats, last = [], None
    for t, e in timed:
        if e.kind == "heartbeat" and (last is None or t - last >= policy.MIN_HEARTBEAT_GAP_S):
            beats.append(t)
            last = t
    return [(a, b) for a, b in pairwise(beats) if b - a <= policy.MAX_GAP_S]


def _idle(timed: list[tuple[float, Event]], end: float) -> list[tuple[float, float]]:
    inputs = [t for t, e in timed if e.kind in INPUT_KINDS or (e.kind == "heartbeat" and e.had_input)]
    windows = []
    for a, b in zip(inputs, [*inputs[1:], end]):
        prompt = a + policy.IDLE_PROMPT_S
        if b > prompt + policy.IDLE_ANSWER_S:
            windows.append((prompt, b))
    return windows


def _merge(windows: list[tuple[float, float]]) -> tuple[list[float], list[float]]:
    starts, ends = [], []
    for a, b in sorted(windows):
        if b <= a:
            continue
        if ends and a <= ends[-1]:
            ends[-1] = max(ends[-1], b)
        else:
            starts.append(a)
            ends.append(b)
    return starts, ends


def _inside(merged: tuple[list[float], list[float]], t: float) -> bool:
    starts, ends = merged
    i = bisect_right(starts, t) - 1
    return i >= 0 and t < ends[i]


def _whole(seconds: float) -> int:
    return floor(seconds + 1e-6)


def decide(data: ScoringInput) -> ScoringOutput:
    events = _ordered(data.events)
    reasons = dict.fromkeys(REASONS, 0.0)
    counted = voided = 0.0
    if events:
        t0 = events[0].server_ts
        timed = [((e.server_ts - t0).total_seconds(), e) for e in events]
        end = timed[-1][0]
        windows = {
            "paused": _merge(_toggled(timed, "pause", "resume", end)),
            "hidden": _merge(_toggled(timed, "hidden", "visible", end)),
            "covered": _merge(_covered(timed)),
            "idle": _merge(_idle(timed, end)),
        }
        visits = [t for t, e in timed if e.kind in ("start", "page_turn")] or [0.0]
        on_page: dict[int, float] = {}
        edges = sorted({0.0, end, *(t for t, _e in timed), *(x for w in windows.values() for side in w for x in side)})
        for a, b in pairwise(edges):
            if not 0 <= a < b <= end:
                continue
            mid, span = (a + b) / 2, b - a
            if _inside(windows["paused"], mid):
                reasons["paused"] += span
            elif _inside(windows["hidden"], mid):
                reasons["hidden"] += span
            elif not _inside(windows["covered"], mid):
                reasons["no_heartbeat"] += span
            elif _inside(windows["idle"], mid):
                reasons["idle"] += span
            else:
                room = max(0.0, policy.SESSION_CAP_S - counted - voided)
                reasons["session_cap"] += span - min(span, room)
                span = min(span, room)
                visit = bisect_right(visits, mid) - 1
                used = on_page.get(visit, 0.0)
                fresh = min(span, max(0.0, policy.PAGE_CAP_S - used))
                on_page[visit] = used + span
                counted += fresh
                voided += span - fresh
    active = _whole(counted + voided)
    voided_s = _whole(voided)
    counted_s = active - voided_s
    reasons["page_cap"] = voided
    points_time = counted_s * policy.POINTS_PER_MINUTE // 60

    quiz, passed, bonus = data.quiz, None, 0
    if quiz is not None:
        passed = Fraction(str(quiz.correct)) / quiz.total >= Fraction(str(policy.PASS_SCORE))
        # F11 (C23.8): the bonus is for questions on pages read in focus, so it is at most the time points
        # (none without counted time); a far bookmark after a few minutes cannot buy a range's worth of bonus.
        earned = round(quiz.correct * policy.BONUS_PER_CORRECT) if passed else 0
        bonus = min(earned, points_time)
    lines = _lines(counted_s, points_time, {k: _whole(v) for k, v in reasons.items()}, quiz, passed, bonus,
                   capped_bonus=bool(passed) and bonus < earned)
    if passed is False:
        points_time = 0
    return ScoringOutput(
        active_seconds=active, voided_seconds=voided_s, counted_seconds=counted_s,
        capped=active >= policy.SESSION_CAP_S,
        reasons={k: _whole(v) for k, v in reasons.items() if _whole(v)},
        points_time=points_time, points_bonus=bonus, points_total=points_time + bonus,
        passed=passed, final=quiz is not None, quiz_correct=quiz.correct if quiz else None,
        quiz_total=quiz.total if quiz else None, rules_version=policy.RULES_VERSION, lines=lines,
    )


def _lines(counted: int, points_time: int, reasons: dict[str, int], quiz, passed, bonus,
           capped_bonus: bool = False) -> list[Line]:
    """What each number came from, in plain words, for the results page."""
    page_min, cap_h = policy.PAGE_CAP_S // 60, policy.SESSION_CAP_S // 3600
    labels = {
        "page_cap": f"Time on one page beyond {page_min} minutes without turning it",
        "session_cap": f"Beyond the {cap_h}-hour session limit",
        "hidden": "The book's tab was in the background",
        "paused": "Focus mode was off",
        "idle": "No answer to “Still with the book?”",
        "no_heartbeat": "No signal from the book (tab closed or offline)",
    }
    lines = [Line(code="counted", label="Focused reading", seconds=counted, points=points_time)]
    lines += [Line(code=code, label=labels[code], seconds=reasons[code], points=0) for code in
              ("page_cap", "session_cap", "hidden", "paused", "idle", "no_heartbeat") if reasons[code]]
    if quiz is not None:
        lines.append(Line(code="quiz_bonus", label=f"Quiz: {quiz.correct:g} of {quiz.total} correct", points=bonus,
                          capped=capped_bonus))
        if not passed:
            pass_pct = round(policy.PASS_SCORE * 100)
            lines.append(Line(code="quiz_failed", points=0,
                              label=f"Quiz below {pass_pct}%: this session earns 0 points"))
    return lines


def active_time(events: list[Event]) -> int:
    """Active seconds (counted and voided, capped at SESSION_CAP_S) of a session's events."""
    return decide(ScoringInput(events=events)).active_seconds
