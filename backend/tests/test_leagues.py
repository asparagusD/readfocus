"""Weekly leagues, pure (C24.3, docs/GAMIFICATION.md G10-G14): the week, grouping by tier and join time, zones,
standings with ties, outcomes at the tier edges, the next tier and what others see of an opted-out reader."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from backend.agents import policy
from backend.xp.leagues import (
    Member,
    Reader,
    assign_groups,
    board,
    group_sizes,
    next_tier,
    outcomes,
    standings,
    week_start,
    zones,
)

T0 = datetime(2026, 11, 16, tzinfo=UTC)  # a Monday
PAMPHLET, PAPERBACK, HARDCOVER, FOLIO, FIRST, ILLUMINATED = policy.LEAGUE_TIERS


def test_the_tiers_are_ours_lowest_first():
    assert policy.LEAGUE_TIERS == ("Pamphlet", "Paperback", "Hardcover", "Folio", "First Edition", "Illuminated")


# --- the week: Monday 00:00 UTC to the next (G11) --------------------------------------------------------------------

@pytest.mark.parametrize(("moment", "start"), [
    (datetime(2026, 11, 16, 0, 0, tzinfo=UTC), datetime(2026, 11, 16, tzinfo=UTC)),
    (datetime(2026, 11, 15, 23, 59, 59, tzinfo=UTC), datetime(2026, 11, 9, tzinfo=UTC)),  # Sunday night
    (datetime(2026, 11, 22, 12, tzinfo=UTC), datetime(2026, 11, 16, tzinfo=UTC)),
    (datetime(2026, 11, 16, 5, tzinfo=ZoneInfo("Asia/Dhaka")), datetime(2026, 11, 9, tzinfo=UTC)),  # Sunday in UTC
    (datetime(2027, 1, 1, tzinfo=UTC), datetime(2026, 12, 28, tzinfo=UTC)),  # across the year
])
def test_week_start(moment, start):
    assert week_start(moment) == start


# --- grouping: ~30 per group within a tier, by join time, no fake readers (G12) ----------------------------------------

@pytest.mark.parametrize(("n", "sizes"), [
    (0, []), (1, [1]), (7, [7]), (30, [30]), (31, [16, 15]), (45, [23, 22]), (60, [30, 30]), (61, [21, 20, 20]),
    (100, [25, 25, 25, 25]),
])
def test_group_sizes_are_about_thirty_and_even(n, sizes):
    assert group_sizes(n) == sizes
    assert sum(sizes) == n and all(s <= policy.LEAGUE_GROUP_SIZE for s in sizes)


def reader(n, tier=PAMPHLET, minutes=None):
    return Reader(f"u{n:03}", tier, T0 + timedelta(minutes=n if minutes is None else minutes))


def test_readers_are_grouped_within_their_tier_in_join_order():
    readers = [reader(n, FOLIO if n % 3 == 0 else PAMPHLET) for n in range(70)][::-1]  # shuffled order in
    groups = assign_groups(readers)
    assert [(g.tier, len(g.readers)) for g in groups] == [(PAMPHLET, 23), (PAMPHLET, 23), (FOLIO, 24)]
    for group in groups:
        assert all(r.tier == group.tier for r in group.readers)
        joined = [r.joined_at for r in group.readers]
        assert joined == sorted(joined)
    assert groups[0].readers[0].user_id == "u001" and groups[1].readers[0].user_id == "u035"


def test_a_small_tier_is_one_small_group_and_nothing_is_padded():
    groups = assign_groups([reader(1, ILLUMINATED), reader(2, ILLUMINATED)])
    assert [(g.tier, [r.user_id for r in g.readers]) for g in groups] == [(ILLUMINATED, ["u001", "u002"])]
    assert assign_groups([]) == []


def test_join_time_ties_break_by_user_id():
    groups = assign_groups([reader(5, minutes=0), reader(2, minutes=0)])
    assert [r.user_id for r in groups[0].readers] == ["u002", "u005"]


def test_an_unknown_tier_is_refused():
    with pytest.raises(ValueError):
        assign_groups([Reader("u1", "Scroll", T0)])


# --- zones (G13 with the C24.3 prompt): demotion only in groups of 10 or more ---------------------------------------

@pytest.mark.parametrize(("n", "promote", "demote"), [
    (30, 7, 5), (31, 7, 5), (24, 6, 4), (20, 5, 3), (15, 4, 3), (10, 2, 2), (9, 2, 0), (5, 1, 0), (3, 1, 0),
    (2, 0, 0), (1, 0, 0), (0, 0, 0),
])
def test_zones_scale_with_the_group(n, promote, demote):
    assert zones(n) == (promote, demote)
    assert promote + demote <= n


# --- standings and outcomes ----------------------------------------------------------------------------------------

def member(n, xp, tier=HARDCOVER, reached_minutes=None):
    reached = None if reached_minutes is None else T0 + timedelta(minutes=reached_minutes)
    return Member(f"u{n:03}", tier, T0 + timedelta(minutes=n), xp, reached)


def test_standings_rank_by_xp_then_who_reached_it_first():
    rows = [member(1, 50, reached_minutes=90), member(2, 80, reached_minutes=10), member(3, 50, reached_minutes=30),
            member(4, 0)]
    assert [m.user_id for m in standings(rows)] == ["u002", "u003", "u001", "u004"]


def test_a_full_group_promotes_seven_and_demotes_five():
    rows = [member(n, 300 - n * 10, reached_minutes=n) for n in range(30)]
    result = {r.member.user_id: (r.rank, r.outcome) for r in outcomes(rows)}
    assert [result[f"u{n:03}"] for n in (0, 6, 7, 24, 25, 29)] == [
        (1, "promoted"), (7, "promoted"), (8, "stayed"), (25, "stayed"), (26, "demoted"), (30, "demoted")]
    assert sum(1 for v in result.values() if v[1] == "promoted") == 7
    assert sum(1 for v in result.values() if v[1] == "demoted") == 5


def test_nobody_promotes_without_xp_and_a_small_group_demotes_nobody():
    rows = [member(1, 40, reached_minutes=1), member(2, 0), member(3, 0), member(4, 0), member(5, 0)]  # zones(5) = 1, 0
    assert [(r.member.user_id, r.outcome) for r in outcomes(rows)] == [
        ("u001", "promoted"), ("u002", "stayed"), ("u003", "stayed"), ("u004", "stayed"), ("u005", "stayed")]
    nobody = outcomes([member(1, 0), member(2, 0), member(3, 0)])
    assert {r.outcome for r in nobody} == {"stayed"}


@pytest.mark.parametrize(("tier", "top", "bottom"), [
    (ILLUMINATED, "stayed", "demoted"),  # nothing above Illuminated
    (PAMPHLET, "promoted", "stayed"),  # nothing below Pamphlet
    (FOLIO, "promoted", "demoted"),
])
def test_no_promotion_from_the_top_and_no_demotion_from_the_bottom(tier, top, bottom):
    rows = [member(n, 100 - n, tier, reached_minutes=n) for n in range(12)]
    result = outcomes(rows)
    assert (result[0].outcome, result[-1].outcome) == (top, bottom)


def test_equal_xp_reached_at_the_same_moment_breaks_by_join_time():
    rows = [member(9, 70, reached_minutes=5), member(3, 70, reached_minutes=5)]
    assert [r.member.user_id for r in outcomes(rows)] == ["u003", "u009"]


@pytest.mark.parametrize(("tier", "outcome", "after"), [
    (PAMPHLET, "promoted", PAPERBACK), (PAMPHLET, "demoted", PAMPHLET), (PAMPHLET, "stayed", PAMPHLET),
    (FIRST, "promoted", ILLUMINATED), (ILLUMINATED, "promoted", ILLUMINATED), (HARDCOVER, "demoted", PAPERBACK),
    (None, None, PAMPHLET),  # a new reader starts in Pamphlet
    (FOLIO, None, FOLIO),  # a week not yet closed keeps the tier
])
def test_next_tier(tier, outcome, after):
    assert next_tier(tier, outcome) == after


def test_outcomes_are_the_same_every_time_they_are_worked_out():
    rows = [member(n, (n * 37) % 120, reached_minutes=(n * 11) % 50) for n in range(30)]
    assert outcomes(rows) == outcomes(list(reversed(rows))) == outcomes(rows)


# --- what others see (G3, G14): an opted-out reader keeps a tier but is hidden from everyone else ---------------------

def test_an_opted_out_reader_is_hidden_from_others_but_sees_their_own_row():
    rows = outcomes([member(1, 90, reached_minutes=1), member(2, 80, reached_minutes=2), member(3, 70, reached_minutes=3)])
    others = board(rows, viewer_id="u003", hidden={"u002"})
    assert [(r.rank, r.member.user_id) for r in others] == [(1, "u001"), (3, "u003")]  # the gap keeps true ranks
    own = board(rows, viewer_id="u002", hidden={"u002"})
    assert [r.member.user_id for r in own] == ["u001", "u002", "u003"]


def test_opting_out_changes_no_rank_or_outcome():
    rows = [member(n, 300 - n * 10, reached_minutes=n) for n in range(30)]
    shown = board(outcomes(rows), viewer_id="u010", hidden={"u000", "u029"})
    full = {r.member.user_id: (r.rank, r.outcome) for r in outcomes(rows)}
    assert all(full[r.member.user_id] == (r.rank, r.outcome) for r in shown) and len(shown) == 28
