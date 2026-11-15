"""Gamification end to end on the server (C24.7, docs/GAMIFICATION.md): two readers, A and B, plus C (a third
member, so a group of 3 promotes one: G13's 7 x n / 30, half up), on one in-memory database with the real keys
and a fake clock. Every step runs the code the app runs: the focus grade's hooks (award_focus_xp, then the badge
check), the HTTP APIs, and the scheduler's POST /internal/leagues/rollover.

A focus session's XP is added once however often it is credited; the daily goal moves the streak; a missed day is
covered by an earned freeze; a badge is awarded once; the rollover promotes A and the League page says so; B opts
out and leaves A's board. The answers A and B get are kept in frontend/e2e/fixtures/gamification-journey.json, which
e2e/gamification.spec.js replays in the browser at the same moments; this test fails when they drift (rewrite the
file with UPDATE_JOURNEY=1)."""

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import progress
from backend.tests import test_league_store as store
from backend.xp import award, badge_award, league_store

A, B, C = ("aaaaaaaa-0000-4000-8000-00000000000a", "bbbbbbbb-0000-4000-8000-00000000000b",
           "cccccccc-0000-4000-8000-00000000000c")
GOLDEN = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures" / "gamification-journey.json"
SECRET = "journey-secret-" + "x" * 32


class Query(store.Query):
    """The league tests' query, plus what the badge check asks for (a count and a limit)."""

    def select(self, columns="*", count=None):
        return self

    def limit(self, count):
        self.window = (0, count - 1)
        return self


class Db(store.Db):
    def __init__(self):
        super().__init__()
        self.tables |= {name: [] for name in ("user_progress", "user_badges", "focus_sessions", "books", "sessions",
                                              "chunks")}
        self.unique |= {"xp_events": [("source", "source_id")], "user_badges": [("user_id", "badge_id")],
                        "user_progress": [("user_id",)]}

    def table(self, name):
        return Query(self, name)


class Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)

    def at(self, *args):
        self.now = datetime(*args, tzinfo=UTC)


@pytest.fixture
def journey(monkeypatch):
    db, clock, who = Db(), Clock(), {"user": A}
    for module in (progress, league_store, award, badge_award):
        monkeypatch.setattr(module, "supabase", db)
    monkeypatch.setattr(progress, "_now", lambda: clock.now)
    monkeypatch.setattr(league_store, "_now", lambda: clock.now)

    class FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock.now

    monkeypatch.setattr(badge_award, "datetime", FakeDatetime)
    monkeypatch.setenv("CRON_SECRET", SECRET)
    app.dependency_overrides[get_current_user] = lambda: who["user"]
    yield db, clock, who, TestClient(app)
    app.dependency_overrides.clear()


def finish(db, user, sid, points, at):
    """What focus/quiz.py grade() does once a session is scored and its quiz passed: credit the XP, check badges."""
    session = {"id": sid, "user_id": user, "book_id": "book-" + user[:1], "status": "scored", "points_total": points,
               "active_seconds": points * 6, "quiz_correct": 2, "quiz_total": 3, "ended_at": at.isoformat()}
    db.tables["focus_sessions"].append(session)
    award.award_focus_xp(session)
    badge_award.check_quietly(user, "focus", session=session, passed=True)
    return session


def regrade(session):
    """A retried grade: the same hooks again, which must change nothing."""
    assert award.award_focus_xp(session)["awarded"] is False
    assert badge_award.check_quietly(session["user_id"], "focus", session=session, passed=True) == []


def ledger(db, user, source=None):
    return [e for e in db.tables["xp_events"] if e["user_id"] == user and source in (None, e["source"])]


def test_two_readers_through_xp_streaks_freezes_badges_rollover_and_opt_out(journey):
    db, clock, who, client = journey
    seen = []

    def call(user, method, path, label=None, **body):
        who["user"] = user
        response = client.request(method, path, **({"json": body} if body else {}))
        assert response.status_code == 200, response.text
        if label:
            seen.append({"step": label, "reader": {A: "A", B: "B"}[user], "at": clock.now.isoformat(), "path": path,
                         "body": response.json()})
        return response.json()

    def rollover():
        response = client.post("/internal/leagues/rollover", headers={"Authorization": f"Bearer {SECRET}"})
        assert response.status_code == 200
        return response.json()

    call(A, "PUT", "/me/progress", display_name="Quiet Owl", timezone="Europe/London")
    call(B, "PUT", "/me/progress", display_name="Marginalia", timezone="Europe/London")

    # Thursday 12 Nov: each reader passes one focus session. A's is credited twice (a retried grade): one row.
    clock.at(2026, 11, 12, 10, 0)
    first = finish(db, A, "focus-a-1", 60, clock.now)
    regrade(first)
    finish(db, B, "focus-b-1", 60, clock.now)
    finish(db, C, "focus-c-1", 60, clock.now)
    assert [e["amount"] for e in ledger(db, A, "focus")] == [60]
    clock.at(2026, 11, 12, 10, 30)
    me = call(A, "GET", "/me/progress", "xp-once")
    assert (me["total_xp"], me["today"]["xp"], me["today"]["met"], me["streak"]["days"]) == (80, 60, True, 1)
    assert [b["id"] for b in me["badges"]] == ["first_focus"]  # +20 XP, once

    # Monday 16 Nov 00:05: the scheduler forms the week's group from the three readers with XP.
    clock.at(2026, 11, 16, 0, 5)
    assert rollover()["grouped"] == 3
    assert rollover() == {"closed": [], "week": "2026-11-16T00:00:00+00:00", "grouped": 0}  # a repeat does nothing

    # 16-22 Nov: A meets the goal every day (Thursday's streak is gone: three days missed, no freeze held). The 7th
    # counted day earns a freeze and the 7-day badge. B reads once, on Tuesday.
    for day in range(16, 23):
        clock.at(2026, 11, day, 10, 0)
        session = finish(db, A, f"focus-a-{day}", 60, clock.now)
        regrade(session)
        if day == 17:
            finish(db, B, "focus-b-17", 30, clock.now)
            clock.at(2026, 11, 17, 10, 30)
            me = call(A, "GET", "/me/progress", "goal-streak")
            assert (me["today"]["met"], me["streak"]["days"], me["streak"]["freezes"]) == (True, 2, 0)
    clock.at(2026, 11, 22, 10, 30)
    me = call(A, "GET", "/me/progress", "streak-7")
    assert me["streak"] == {"days": 7, "freezes": 1, "frozen_days": []}
    shelf = call(A, "GET", "/badges", "badges")
    assert [b["id"] for b in shelf["badges"] if b["earned"]] == ["first_focus", "streak_7"]
    assert sorted(e["source_id"] for e in ledger(db, A, "badge")) == [f"{A}:first_focus", f"{A}:streak_7"]
    assert me["total_xp"] == sum(e["amount"] for e in ledger(db, A)) == 8 * 60 + 20 + 50

    # Still Sunday: A's board shows the whole group; then B opts out and leaves it, while B still sees their place.
    league = call(A, "GET", "/leagues/current", "board")
    names = [r["display_name"] for r in league["rows"]]
    assert names == ["Quiet Owl", "Marginalia", f"Reader {league['rows'][2]['id'][:4]}"]
    call(B, "GET", "/me/progress", "b-progress")
    assert call(B, "GET", "/leagues/current", "b-board")["rows"] == [{**r, "you": not r["you"]} if r["rank"] < 3 else r
                                                                     for r in league["rows"]]
    call(B, "PUT", "/me/progress", leaderboard_opt_out=True)
    league = call(A, "GET", "/leagues/current", "b-opted-out")
    assert [r["display_name"] for r in league["rows"]] == [names[0], names[2]]
    assert [r["rank"] for r in league["rows"]] == [1, 3] and "Marginalia" not in json.dumps(league)
    theirs = call(B, "GET", "/leagues/current", "b-own-board")
    assert theirs["opted_out"] is True and [r["display_name"] for r in theirs["rows"] if r["you"]] == ["Marginalia"]

    # Monday 23 Nov: A does not read. The rollover closes last week: A first of three with XP, so promoted.
    clock.at(2026, 11, 23, 0, 5)
    assert rollover()["closed"] == ["2026-11-16T00:00:00+00:00"]
    league = call(A, "GET", "/leagues/current", "promoted")
    assert league["tier"] == "Paperback" and [r["you"] for r in league["rows"]] == [True]
    assert league["last_week"] == {"starts_at": "2026-11-16T00:00:00+00:00", "tier": "Pamphlet", "rank": 1, "size": 3,
                                   "weekly_xp": 7 * 60 + 50, "outcome": "promoted", "now_in": "Paperback"}

    # Tuesday 24 Nov: the missed Monday shows as frozen; meeting the goal keeps the streak (8 days, freeze spent).
    clock.at(2026, 11, 24, 9, 0)
    me = call(A, "GET", "/me/progress", "frozen")
    assert me["streak"] == {"days": 7, "freezes": 0, "frozen_days": ["2026-11-23"]}
    finish(db, A, "focus-a-24", 60, clock.now)
    clock.at(2026, 11, 24, 10, 30)
    me = call(A, "GET", "/me/progress", "streak-kept")
    assert me["streak"] == {"days": 8, "freezes": 0, "frozen_days": []}
    assert len(ledger(db, A, "focus")) == 9 and len(db.tables["user_badges"]) == 4  # A: 2; B and C: first_focus

    snapshot = json.dumps(seen, indent=1, sort_keys=True) + "\n"
    if os.getenv("UPDATE_JOURNEY"):
        GOLDEN.write_text(snapshot, encoding="utf-8")
    assert GOLDEN.read_text(encoding="utf-8") == snapshot, "the e2e journey is stale: re-run with UPDATE_JOURNEY=1"
