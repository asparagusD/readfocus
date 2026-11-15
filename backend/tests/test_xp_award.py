"""Awarding XP for a scored focus session (C24.1, docs/GAMIFICATION.md G2, G4-G8): one ledger row per session,
whatever happens twice; the day is the reader's local day of the session's end; the stored streak moves on the
first award that meets the day's goal. An in-memory database that enforces the ledger's unique key."""

import json
from datetime import date
from types import SimpleNamespace

import pytest

from backend.xp import award


class UniqueViolation(Exception):
    code = "23505"


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.action = db, name, [], ("select", None)

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

    def is_(self, column, value):
        assert value == "null"
        self.filters.append(lambda r: r.get(column) is None)
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.name, [])
        kind, values = self.action
        if kind == "insert":
            row = json.loads(json.dumps(values))
            for keys in self.db.unique.get(self.name, ()):
                if any(all(r.get(k) == row.get(k) for k in keys) for r in rows):
                    raise UniqueViolation(f"duplicate key on {self.name} {keys}")
            rows.append(row)
            return SimpleNamespace(data=[row])
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if kind == "update":
            if self.name in self.db.race_once:  # another award moved the row between our read and our write
                self.db.race_once.discard(self.name)
                matched[0].update(self.db.race_values)
                return SimpleNamespace(data=[])
            for r in matched:
                r.update(json.loads(json.dumps(values)))
        return SimpleNamespace(data=json.loads(json.dumps(matched)))


class Db:
    def __init__(self):
        self.tables = {"xp_events": [], "user_progress": []}
        self.unique = {"xp_events": [("source", "source_id")], "user_progress": [("user_id",)]}
        self.race_once, self.race_values = set(), {}

    def table(self, name):
        return Query(self, name)


USER = "user-1"


@pytest.fixture
def db(monkeypatch):
    fake = Db()
    monkeypatch.setattr(award, "supabase", fake)
    return fake


def session(sid="fs-1", points=120, ended="2026-11-15T10:00:00+00:00", status="scored", user=USER):
    return {"id": sid, "user_id": user, "status": status, "points_total": points, "ended_at": ended}


def progress(db, **values):
    db.tables["user_progress"].append({"user_id": USER, "total_xp": 0, "daily_goal": 50, "timezone": "UTC",
                                       "streak_days": 0, "streak_freezes": 0, "last_goal_day": None, **values})


def row(db):
    return db.tables["user_progress"][0]


# --- once per session --------------------------------------------------------------------------------------------

def test_a_scored_session_writes_one_ledger_row_and_the_total(db):
    out = award.award_focus_xp(session())
    assert out["awarded"] is True and out["amount"] == 120
    assert db.tables["xp_events"] == [{"user_id": USER, "source": "focus", "source_id": "fs-1", "amount": 120,
                                       "earned_at": "2026-11-15T10:00:00+00:00", "local_day": "2026-11-15"}]
    assert row(db)["total_xp"] == 120
    assert (row(db)["streak_days"], row(db)["last_goal_day"]) == (1, "2026-11-15")


@pytest.mark.parametrize("attempts", [2, 3, 5])
def test_awarding_the_same_session_again_changes_nothing(db, attempts):
    first = award.award_focus_xp(session())
    before = dict(row(db))
    for _ in range(attempts - 1):
        again = award.award_focus_xp(session())
        assert again["awarded"] is False and again["total_xp"] == first["total_xp"]
    assert len(db.tables["xp_events"]) == 1
    assert row(db) == before


def test_a_duplicate_caught_only_by_the_unique_key_is_not_counted(db, monkeypatch):
    """Two grades racing: both see no ledger row, the database refuses the second insert."""
    award.award_focus_xp(session())
    before = dict(row(db))
    monkeypatch.setattr(award, "_already_awarded", lambda source, source_id: False)
    out = award.award_focus_xp(session())
    assert out["awarded"] is False
    assert len(db.tables["xp_events"]) == 1 and row(db) == before


def test_other_errors_are_not_mistaken_for_duplicates(db, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("xp_events is down")
    monkeypatch.setattr(award, "_insert_event", broken)
    with pytest.raises(RuntimeError):
        award.award_focus_xp(session())


@pytest.mark.parametrize("bad", [
    session(points=0),  # the quiz failed (F12): no XP, no row
    session(status="awaiting_quiz"),
    session(status="abandoned", points=0),
    session(status="active"),
])
def test_nothing_is_awarded_for_a_session_that_did_not_earn_points(db, bad):
    assert award.award_focus_xp(bad) is None
    assert db.tables["xp_events"] == [] and db.tables["user_progress"] == []


def test_a_reader_without_a_progress_row_gets_one_with_the_defaults(db):
    award.award_focus_xp(session(points=20))
    assert row(db)["daily_goal"] == 50 and row(db)["timezone"] == "UTC" and row(db)["total_xp"] == 20
    assert row(db)["streak_days"] == 0 and row(db)["last_goal_day"] is None  # 20 < 50: no goal day yet


# --- the reader's day and goal -----------------------------------------------------------------------------------

@pytest.mark.parametrize(("zone", "ended", "expected"), [
    ("UTC", "2026-11-15T23:30:00+00:00", "2026-11-15"),
    ("Asia/Dhaka", "2026-11-15T23:30:00+00:00", "2026-11-16"),
    ("America/Los_Angeles", "2026-11-16T03:00:00+00:00", "2026-11-15"),
    ("Not/AZone", "2026-11-15T23:30:00+00:00", "2026-11-15"),
])
def test_the_xp_goes_to_the_readers_local_day_of_the_sessions_end(db, zone, ended, expected):
    progress(db, timezone=zone)
    award.award_focus_xp(session(ended=ended))
    assert db.tables["xp_events"][0]["local_day"] == expected
    assert row(db)["last_goal_day"] == expected


def test_the_goal_is_met_by_the_days_total_not_one_session(db):
    progress(db)
    assert award.award_focus_xp(session("a", 30))["goal_met"] is False
    assert row(db)["streak_days"] == 0
    out = award.award_focus_xp(session("b", 30, ended="2026-11-15T12:00:00+00:00"))
    assert (out["day_xp"], out["goal_met"]) == (60, True)
    assert (row(db)["streak_days"], row(db)["last_goal_day"]) == (1, "2026-11-15")
    award.award_focus_xp(session("c", 200, ended="2026-11-15T20:00:00+00:00"))
    assert row(db)["streak_days"] == 1 and row(db)["total_xp"] == 260  # one goal day, however much XP


def test_the_readers_own_goal_is_used(db):
    progress(db, daily_goal=200)
    assert award.award_focus_xp(session(points=150))["goal_met"] is False
    assert award.award_focus_xp(session("b", 60, ended="2026-11-15T11:00:00+00:00"))["goal_met"] is True


def test_another_readers_xp_does_not_count_towards_this_day(db):
    db.tables["xp_events"].append({"user_id": "user-2", "source": "focus", "source_id": "x", "amount": 400,
                                   "earned_at": "2026-11-15T09:00:00+00:00", "local_day": "2026-11-15"})
    assert award.award_focus_xp(session(points=20))["day_xp"] == 20


# --- streaks over days (table-driven: each entry is a session's end and points) ------------------------------------

def days(*spec):
    """'d0:60' -> a 60-point session ending at noon UTC on 2026-11-02 + 0 days."""
    out = []
    for n, item in enumerate(spec):
        offset, points = item.split(":")
        moment = date.fromordinal(date(2026, 11, 2).toordinal() + int(offset)).isoformat() + "T12:00:00+00:00"
        out.append(session(f"s{n}", int(points), ended=moment))
    return out


@pytest.mark.parametrize(("spec", "streak", "freezes", "last"), [
    (["0:60", "1:60", "2:60"], 3, 0, 2),
    ([f"{n}:60" for n in range(7)], 7, 1, 6),  # a week of goal days earns a freeze
    ([f"{n}:60" for n in range(14)], 14, 2, 13),
    ([f"{n}:60" for n in range(21)], 21, 2, 20),  # never more than two
    ([*[f"{n}:60" for n in range(7)], "8:60"], 8, 0, 8),  # day 7 missed: the freeze covers it
    ([*[f"{n}:60" for n in range(7)], "9:60"], 1, 0, 9),  # two missed, one freeze: quietly back to 1
    (["0:60", "1:30", "2:60"], 1, 0, 2),  # day 1 under the goal is a missed day
    (["0:60", "0:60", "0:60"], 1, 0, 0),  # three sessions, one day
    (["3:60", "1:60"], 1, 0, 3),  # a session graded late for an earlier day leaves the streak alone
])
def test_streaks_and_freezes_over_days(db, spec, streak, freezes, last):
    progress(db)
    for s in days(*spec):
        award.award_focus_xp(s)
    assert (row(db)["streak_days"], row(db)["streak_freezes"]) == (streak, freezes)
    assert row(db)["last_goal_day"] == date.fromordinal(date(2026, 11, 2).toordinal() + last).isoformat()


def test_replaying_every_session_twice_gives_the_same_streak(db):
    progress(db)
    sessions = days(*[f"{n}:60" for n in range(9)])
    for s in sessions:
        award.award_focus_xp(s)
    once = dict(row(db))
    for s in sessions:
        award.award_focus_xp(s)
    assert row(db) == once and len(db.tables["xp_events"]) == 9


def test_a_streak_write_that_lost_a_race_is_redone_on_the_fresh_row(db):
    """Another award moved the streak between our read and our write: the update matched nothing, so we read the
    row again and apply the goal day to what is there now."""
    progress(db, streak_days=3, last_goal_day="2026-11-14")
    db.race_once.add("user_progress")
    db.race_values = {"streak_days": 4, "last_goal_day": "2026-11-15"}  # the racing award met today's goal first
    award.award_focus_xp(session(points=60, ended="2026-11-15T18:00:00+00:00"))
    assert (row(db)["streak_days"], row(db)["last_goal_day"]) == (4, "2026-11-15")  # not 5: one goal day
