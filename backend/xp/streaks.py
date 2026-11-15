"""Days, the daily goal and streaks with earned freezes (C24.1, docs/GAMIFICATION.md G5-G9). Pure: no I/O, no
clock; today is always passed in.

The stored streak (user_progress: streak_days, streak_freezes, last_goal_day) moves only on a goal day, in
on_goal_day(): the missed days since the last goal day each use a held freeze; if there are more missed days than
freezes, every freeze is spent and the streak starts again at 1, quietly. A freeze is earned when the streak
reaches a multiple of STREAK_FREEZE_EVERY_DAYS counted days, while fewer than STREAK_FREEZE_MAX are held. A frozen
day keeps the streak but is not counted (G8), so 7 counted days, not 7 calendar days, earn the next one.

On any other day, view() works out the same thing without writing: today is never missed yet, so a streak whose
last goal day was yesterday is still alive (G7)."""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backend.agents import policy


@dataclass(frozen=True)
class Streak:
    days: int
    freezes: int
    last_goal_day: date | None


@dataclass(frozen=True)
class Current:
    days: int  # 0 when the streak has gone
    freezes: int  # held now, after covering the missed days so far
    frozen_days: list[date] = field(default_factory=list)  # the missed days the held freezes cover, oldest first


def zone(name: str | None) -> ZoneInfo:
    """The reader's IANA time zone; UTC when it is missing or unknown (G6)."""
    try:
        return ZoneInfo(name) if name else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def local_day(moment: datetime | str, zone_name: str | None) -> date:
    """The calendar day of `moment` in the reader's zone; a stored ISO timestamp is accepted."""
    if isinstance(moment, str):
        moment = datetime.fromisoformat(moment)  # 3.11 reads a trailing Z
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(zone(zone_name)).date()


def goal_met(day_xp: int, goal: int) -> bool:
    return day_xp >= goal


def _missed(last: date, day: date) -> int:
    return max(0, (day - last).days - 1)


def on_goal_day(streak: Streak, day: date) -> Streak:
    """The stored streak after the goal is met on `day`. A day at or before the last goal day changes nothing."""
    if streak.last_goal_day is not None and day <= streak.last_goal_day:
        return streak
    missed = 0 if streak.last_goal_day is None else _missed(streak.last_goal_day, day)
    if streak.last_goal_day is None or missed > streak.freezes:
        days, freezes = 1, 0
    else:
        days, freezes = streak.days + 1, streak.freezes - missed
    if days % policy.STREAK_FREEZE_EVERY_DAYS == 0 and freezes < policy.STREAK_FREEZE_MAX:
        freezes += 1
    return Streak(days, freezes, day)


def view(streak: Streak, today: date) -> Current:
    """The streak as it stands today, without writing: the missed days since the last goal day (today never one)
    are covered by held freezes, or the streak has gone."""
    if streak.last_goal_day is None:
        return Current(0, streak.freezes)
    missed = _missed(streak.last_goal_day, today)
    if missed > streak.freezes:
        return Current(0, 0)
    frozen = [streak.last_goal_day + timedelta(days=n) for n in range(1, missed + 1)]
    return Current(streak.days, streak.freezes - missed, frozen)
