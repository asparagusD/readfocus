"""XP days, the daily goal and streaks with earned freezes (C24.1, docs/GAMIFICATION.md G4-G9): pure functions,
table-driven. A stored streak (days, freezes, last goal day) moves only on a goal day; the view on any other day
works out what the days since the last goal day did to it, without writing."""

from datetime import UTC, date, datetime

import pytest

from backend.xp.streaks import Streak, goal_met, local_day, on_goal_day, view

D = date(2026, 11, 2)  # a Monday


def day(n: int) -> date:
    return date.fromordinal(D.toordinal() + n)


# --- the reader's local day (G6) ------------------------------------------------------------------------------

@pytest.mark.parametrize(("moment", "zone", "expected"), [
    (datetime(2026, 11, 15, 23, 30, tzinfo=UTC), "UTC", date(2026, 11, 15)),
    (datetime(2026, 11, 15, 23, 30, tzinfo=UTC), "Asia/Dhaka", date(2026, 11, 16)),  # UTC+6: already tomorrow
    (datetime(2026, 11, 16, 3, 0, tzinfo=UTC), "America/Los_Angeles", date(2026, 11, 15)),  # UTC-8: still today
    (datetime(2026, 11, 15, 18, 0, tzinfo=UTC), "Asia/Dhaka", date(2026, 11, 16)),  # midnight exactly is the new day
    (datetime(2026, 11, 15, 17, 59, 59, tzinfo=UTC), "Asia/Dhaka", date(2026, 11, 15)),
    (datetime(2026, 11, 15, 10, 15, tzinfo=UTC), "Pacific/Kiritimati", date(2026, 11, 16)),  # UTC+14
    (datetime(2026, 11, 15, 10, 15, tzinfo=UTC), "Pacific/Pago_Pago", date(2026, 11, 14)),  # UTC-11
    (datetime(2026, 11, 15, 18, 15, tzinfo=UTC), "Asia/Kathmandu", date(2026, 11, 16)),  # UTC+5:45
    # Daylight saving: 2026-03-29 01:00 UTC Europe/London jumps 01:00 -> 02:00; 2026-10-25 it falls back.
    (datetime(2026, 3, 28, 23, 59, tzinfo=UTC), "Europe/London", date(2026, 3, 28)),
    (datetime(2026, 3, 29, 23, 30, tzinfo=UTC), "Europe/London", date(2026, 3, 30)),  # BST: 00:30 next day
    (datetime(2026, 10, 25, 23, 30, tzinfo=UTC), "Europe/London", date(2026, 10, 25)),  # back on GMT
    ("2026-11-15T23:30:00+00:00", "Asia/Dhaka", date(2026, 11, 16)),  # the stored ISO text
    ("2026-11-15T23:30:00Z", "Asia/Dhaka", date(2026, 11, 16)),
    (datetime(2026, 11, 15, 23, 30, tzinfo=UTC), "Not/AZone", date(2026, 11, 15)),  # unknown zone: UTC
    (datetime(2026, 11, 15, 23, 30, tzinfo=UTC), "", date(2026, 11, 15)),
    (datetime(2026, 11, 15, 23, 30, tzinfo=UTC), None, date(2026, 11, 15)),
])
def test_local_day(moment, zone, expected):
    assert local_day(moment, zone) == expected


# --- the daily goal (G5, G7) ----------------------------------------------------------------------------------

@pytest.mark.parametrize(("xp", "goal", "met"), [
    (0, 50, False), (49, 50, False), (50, 50, True), (51, 50, True), (500, 500, True), (10, 10, True), (9, 10, False),
])
def test_goal_met_when_the_days_xp_reaches_the_goal(xp, goal, met):
    assert goal_met(xp, goal) is met


# --- a goal day moves the stored streak (G7, G8) --------------------------------------------------------------

@pytest.mark.parametrize(("before", "goal_day", "after"), [
    # the first goal day ever
    (Streak(0, 0, None), day(0), Streak(1, 0, day(0))),
    # the next day: +1
    (Streak(1, 0, day(0)), day(1), Streak(2, 0, day(1))),
    # the same day again (a second session that day): no change
    (Streak(2, 0, day(1)), day(1), Streak(2, 0, day(1))),
    # an earlier day than the last goal day (a quiz graded late): no change
    (Streak(2, 0, day(1)), day(0), Streak(2, 0, day(1))),
    # the 7th consecutive day earns a freeze
    (Streak(6, 0, day(5)), day(6), Streak(7, 1, day(6))),
    # the 14th earns a second
    (Streak(13, 1, day(12)), day(13), Streak(14, 2, day(13))),
    # the 21st earns none: at most two held
    (Streak(20, 2, day(19)), day(20), Streak(21, 2, day(20))),
    # one missed day with a freeze held: the freeze covers it, the streak goes on
    (Streak(9, 1, day(8)), day(10), Streak(10, 0, day(10))),
    # two missed days, two freezes: both used
    (Streak(9, 2, day(8)), day(11), Streak(10, 0, day(11))),
    # two missed days, one freeze: the streak restarts quietly at 1, nothing held
    (Streak(9, 1, day(8)), day(11), Streak(1, 0, day(11))),
    # one missed day, no freeze: restarts at 1
    (Streak(5, 0, day(4)), day(6), Streak(1, 0, day(6))),
    # a long absence: restarts at 1
    (Streak(30, 2, day(0)), day(40), Streak(1, 0, day(40))),
    # a covered day does not count towards the next freeze: 7 counted days, not 7 calendar days
    (Streak(6, 1, day(5)), day(7), Streak(7, 1, day(7))),  # day 6 frozen (1 -> 0), the 7th counted day earns one
    (Streak(5, 1, day(4)), day(6), Streak(6, 0, day(6))),  # day 5 frozen: 6 counted, no freeze yet
])
def test_on_goal_day(before, goal_day, after):
    assert on_goal_day(before, goal_day) == after


def test_a_freeze_used_and_earned_on_the_same_goal_day_keeps_the_count_within_two():
    assert on_goal_day(Streak(13, 2, day(12)), day(14)) == Streak(14, 2, day(14))  # 2 - 1 used + 1 earned


def test_thirty_consecutive_days_hold_two_freezes():
    s = Streak(0, 0, None)
    for n in range(30):
        s = on_goal_day(s, day(n))
    assert s == Streak(30, 2, day(29))


# --- the view on any day (G7: the streak ends today or yesterday, freezes cover the days between) ---------------

@pytest.mark.parametrize(("stored", "today", "days", "freezes", "frozen"), [
    (Streak(0, 0, None), day(0), 0, 0, []),
    (Streak(4, 0, day(3)), day(3), 4, 0, []),  # met today
    (Streak(4, 0, day(3)), day(4), 4, 0, []),  # met yesterday: today is not missed yet
    (Streak(4, 0, day(3)), day(5), 0, 0, []),  # yesterday missed, no freeze: gone (shown as 0, no warning)
    (Streak(8, 1, day(7)), day(9), 8, 0, [day(8)]),  # yesterday frozen
    (Streak(8, 2, day(7)), day(10), 8, 0, [day(8), day(9)]),
    (Streak(8, 2, day(7)), day(9), 8, 1, [day(8)]),
    (Streak(8, 1, day(7)), day(10), 0, 0, []),  # two missed, one freeze: gone
    (Streak(4, 1, day(5)), day(3), 4, 1, []),  # a clock or zone change put today before the last goal day
])
def test_view(stored, today, days, freezes, frozen):
    current = view(stored, today)
    assert (current.days, current.freezes, current.frozen_days) == (days, freezes, frozen)


def test_the_view_agrees_with_the_next_goal_day():
    """Whatever the view shows today is what a goal met today builds on."""
    for stored in (Streak(8, 2, day(7)), Streak(8, 1, day(7)), Streak(3, 0, day(7))):
        for gap in range(5):
            today = day(8 + gap)
            shown = view(stored, today)
            moved = on_goal_day(stored, today)
            assert moved.days == (shown.days + 1 if shown.days else 1)
