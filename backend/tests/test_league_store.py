"""The weekly rollover against the database (C24.3b, docs/GAMIFICATION.md G11-G14), on an in-memory database with
the league tables' keys: forming a week's groups from the readers active in the 14 days before it, closing a past
week with ranks and outcomes from the XP ledger, carrying tiers, and doing each of these once however often or
however late it runs."""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from backend.xp import league_store

MON = datetime(2026, 11, 16, tzinfo=UTC)  # a Monday
WEEK = timedelta(days=7)


class UniqueViolation(Exception):
    code = "23505"


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.action = db, name, [], ("select", None)
        self.orders, self.window = [], None

    def select(self, columns="*"):
        return self

    def insert(self, values):
        self.action = ("insert", values)
        return self

    def update(self, values):
        self.action = ("update", values)
        return self

    def eq(self, column, value):
        self.filters.append(lambda r: r.get(column) == value)
        return self

    def in_(self, column, values):
        self.filters.append(lambda r: r.get(column) in values)
        return self

    def is_(self, column, value):
        assert value == "null"
        self.filters.append(lambda r: r.get(column) is None)
        return self

    def gte(self, column, value):
        self.filters.append(lambda r: r.get(column) is not None and _t(r[column]) >= _t(value))
        return self

    def lt(self, column, value):
        self.filters.append(lambda r: r.get(column) is not None and _t(r[column]) < _t(value))
        return self

    def lte(self, column, value):
        self.filters.append(lambda r: r.get(column) is not None and _t(r[column]) <= _t(value))
        return self

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def execute(self):
        self.db.calls.append((self.name, self.action[0]))
        rows = self.db.tables.setdefault(self.name, [])
        kind, values = self.action
        if kind == "insert":
            new = []
            for value in values if isinstance(values, list) else [values]:
                row = json.loads(json.dumps(value))
                if self.name in ("league_weeks", "league_groups"):
                    row.setdefault("id", f"{self.name}-{len(rows) + len(new)}")
                for keys in self.db.unique.get(self.name, ()):
                    if any(all(r.get(k) == row.get(k) for k in keys) for r in [*rows, *new]):
                        raise UniqueViolation(f"duplicate key on {self.name}")
                new.append(row)
            rows.extend(new)
            return SimpleNamespace(data=json.loads(json.dumps(new)))
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if kind == "update":
            for r in matched:
                r.update(json.loads(json.dumps(values)))
        for column, desc in reversed(self.orders):
            matched.sort(key=lambda r: r[column], reverse=desc)
        if self.window:
            matched = matched[self.window[0]:self.window[1] + 1]
        return SimpleNamespace(data=json.loads(json.dumps(matched)))


def _t(value):
    return datetime.fromisoformat(value) if isinstance(value, str) else value


class Db:
    def __init__(self):
        self.tables = {name: [] for name in ("league_weeks", "league_groups", "league_members", "xp_events")}
        self.unique = {"league_weeks": [("starts_at",)], "league_members": [("week_id", "user_id")]}
        self.calls = []

    def table(self, name):
        return Query(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = Db()
    monkeypatch.setattr(league_store, "supabase", fake)
    monkeypatch.setattr(league_store, "PAGE", 3)  # small pages, so paging is exercised
    return fake


def xp(db, user, amount, at, n=[0]):  # noqa: B006 - a counter for unique source ids
    n[0] += 1
    db.tables["xp_events"].append({"user_id": user, "source": "focus", "source_id": f"s{n[0]}", "amount": amount,
                                   "earned_at": at.isoformat()})


def week(db, start):
    return next(w for w in db.tables["league_weeks"] if _t(w["starts_at"]) == start)


def members(db, start):
    wid = week(db, start)["id"]
    return {m["user_id"]: m for m in db.tables["league_members"] if m["week_id"] == wid}


# --- forming a week's groups -----------------------------------------------------------------------------------------

def test_the_first_rollover_groups_readers_active_in_the_last_fourteen_days(db):
    xp(db, "ann", 60, MON - timedelta(days=2))
    xp(db, "bo", 10, MON - timedelta(days=13, hours=23))
    xp(db, "cy", 90, MON - timedelta(days=15))  # outside the 14 days: not grouped
    out = league_store.roll_over(MON + timedelta(hours=1))
    assert out == {"closed": [], "week": MON.isoformat(), "grouped": 2}
    assert week(db, MON)["ends_at"] == (MON + WEEK).isoformat() and week(db, MON)["status"] == "open"
    got = members(db, MON)
    assert sorted(got) == ["ann", "bo"] and {m["tier"] for m in got.values()} == {"Pamphlet"}
    assert len(db.tables["league_groups"]) == 1 and got["ann"]["group_id"] == got["bo"]["group_id"]
    assert got["ann"]["joined_at"] == (MON - timedelta(days=2)).isoformat()  # first XP


def test_running_it_again_the_same_week_changes_nothing(db):
    xp(db, "ann", 60, MON - timedelta(days=2))
    league_store.roll_over(MON + timedelta(hours=1))
    before = json.loads(json.dumps(db.tables))
    for hours in (2, 30, 100):
        assert league_store.roll_over(MON + timedelta(hours=hours))["grouped"] == 0
    assert db.tables == before


def test_a_week_already_grouped_by_another_run_is_not_grouped_again(db):
    xp(db, "ann", 60, MON - timedelta(days=2))
    db.tables["league_weeks"].append({"id": "w", "starts_at": MON.isoformat(), "ends_at": (MON + WEEK).isoformat(),
                                      "status": "open", "grouped_at": MON.isoformat(), "closed_at": None})
    assert league_store.roll_over(MON + timedelta(hours=1))["grouped"] == 0
    assert db.tables["league_groups"] == [] and db.tables["league_members"] == []


def test_thirty_five_readers_make_two_groups_in_join_order(db):
    for n in range(35):
        xp(db, f"u{n:02}", 10, MON - timedelta(days=3, minutes=-n))
    league_store.roll_over(MON)
    sizes = sorted((sum(1 for m in db.tables["league_members"] if m["group_id"] == g["id"]) for g in
                    db.tables["league_groups"]), reverse=True)
    assert sizes == [18, 17]
    first = db.tables["league_groups"][0]["id"]
    assert sorted(m["user_id"] for m in db.tables["league_members"] if m["group_id"] == first) == [
        f"u{n:02}" for n in range(18)]


# --- closing a week --------------------------------------------------------------------------------------------------

def full_week(db, scores, tier=None):
    """Group the readers for the week at MON (XP the day before), then give each `scores[user]` XP in the week."""
    for n, user in enumerate(scores):
        xp(db, user, 5, MON - timedelta(days=1, minutes=-n))
    league_store.roll_over(MON)
    if tier:
        for m in db.tables["league_members"]:
            m["tier"] = tier
    for n, (user, amount) in enumerate(scores.items()):
        if amount:
            xp(db, user, amount, MON + timedelta(days=2, minutes=n))


def test_closing_ranks_by_the_weeks_xp_writes_outcomes_and_moves_tiers(db):
    scores = {f"u{n:02}": 300 - n * 10 for n in range(12)}  # zones(12): 3 up, 2 down
    full_week(db, scores, tier="Hardcover")
    out = league_store.roll_over(MON + WEEK + timedelta(minutes=5))
    assert out["closed"] == [MON.isoformat()] and out["week"] == (MON + WEEK).isoformat()
    closed = members(db, MON)
    assert [(closed[u]["final_rank"], closed[u]["outcome"], closed[u]["weekly_xp"]) for u in ("u00", "u02", "u03",
            "u09", "u10", "u11")] == [(1, "promoted", 300), (3, "promoted", 280), (4, "stayed", 270),
                                      (10, "stayed", 210), (11, "demoted", 200), (12, "demoted", 190)]
    assert week(db, MON)["status"] == "closed" and week(db, MON)["closed_at"]
    after = members(db, MON + WEEK)  # everyone had XP in the 14 days before the new week
    assert (after["u00"]["tier"], after["u05"]["tier"], after["u11"]["tier"]) == ("Folio", "Hardcover", "Paperback")


def test_only_xp_inside_the_week_counts(db):
    full_week(db, {"ann": 0, "bo": 0})
    xp(db, "ann", 40, MON)  # the first instant counts
    xp(db, "bo", 40, MON + WEEK)  # the next week's first instant does not
    xp(db, "bo", 30, MON + WEEK - timedelta(seconds=1))
    league_store.roll_over(MON + WEEK)
    closed = members(db, MON)
    assert (closed["ann"]["weekly_xp"], closed["bo"]["weekly_xp"]) == (40, 30)


def test_a_tie_goes_to_whoever_reached_the_xp_first(db):
    full_week(db, {"ann": 0, "bo": 0})
    xp(db, "ann", 20, MON + timedelta(hours=12))  # ann starts first
    xp(db, "bo", 50, MON + timedelta(days=1))
    xp(db, "ann", 30, MON + timedelta(days=3))  # but reaches 50 two days after bo
    league_store.roll_over(MON + WEEK)
    closed = members(db, MON)
    assert (closed["bo"]["final_rank"], closed["ann"]["final_rank"]) == (1, 2)
    assert closed["bo"]["xp_reached_at"] == (MON + timedelta(days=1)).isoformat()


def test_closing_twice_writes_the_same_and_closes_once(db):
    full_week(db, {f"u{n:02}": 100 - n for n in range(12)})
    league_store.roll_over(MON + WEEK)
    before = json.loads(json.dumps(db.tables))
    again = league_store.roll_over(MON + WEEK + timedelta(hours=3))
    assert again["closed"] == [] and again["grouped"] == 0 and db.tables == before


def test_missed_weeks_close_in_order_and_only_the_current_week_is_formed(db):
    full_week(db, {"ann": 80, "bo": 0, "cy": 10})  # zones(3): 1 up
    xp(db, "ann", 10, MON + 3 * WEEK - timedelta(days=1))  # ann active before the week the rollover lands in
    out = league_store.roll_over(MON + 3 * WEEK + timedelta(hours=2))
    assert out["closed"] == [MON.isoformat()] and out["week"] == (MON + 3 * WEEK).isoformat()
    assert sorted(_t(w["starts_at"]) for w in db.tables["league_weeks"]) == [MON, MON + 3 * WEEK]
    assert members(db, MON + 3 * WEEK) == {"ann": members(db, MON + 3 * WEEK)["ann"]}
    assert members(db, MON + 3 * WEEK)["ann"]["tier"] == "Paperback"  # promoted in the closed week


def test_a_reader_away_for_a_while_comes_back_at_their_last_tier(db):
    full_week(db, {"ann": 80, "bo": 0, "cy": 10})  # ann promoted to Paperback
    league_store.roll_over(MON + WEEK)
    league_store.roll_over(MON + 2 * WEEK)  # the week at MON + WEEK closes; ann was in it, with no XP: stays
    xp(db, "ann", 10, MON + 5 * WEEK - timedelta(days=2))
    league_store.roll_over(MON + 5 * WEEK)
    assert members(db, MON + 5 * WEEK)["ann"]["tier"] == "Paperback"


def test_an_open_week_still_running_is_not_closed(db):
    full_week(db, {"ann": 80})
    out = league_store.roll_over(MON + WEEK - timedelta(seconds=1))
    assert out["closed"] == [] and week(db, MON)["status"] == "open"
    assert members(db, MON)["ann"]["final_rank"] is None
