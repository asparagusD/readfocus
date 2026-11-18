"""The gamification APIs (C24.5, docs/GAMIFICATION.md): GET/PUT /me/progress, GET /badges, GET /leagues/current, on
the in-memory database. Privacy first: no email and no other reader's user id ever leaves the server; a league row
names a reader by a per-week pseudonym and their display name; opted-out readers are hidden from everyone else."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import progress
from backend.tests.test_league_store import Db
from backend.xp import league_store

ME, ANN, BO, CY = ("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222",
                   "33333333-3333-3333-3333-333333333333", "44444444-4444-4444-4444-444444444444")
NOW = datetime(2026, 11, 18, 15, 0, tzinfo=UTC)  # a Wednesday; the week began Monday Nov 16
WEEK, LAST = datetime(2026, 11, 16, tzinfo=UTC), datetime(2026, 11, 9, tzinfo=UTC)


@pytest.fixture
def db(monkeypatch):
    fake = Db()
    for module in (progress, league_store):
        monkeypatch.setattr(module, "supabase", fake)
    monkeypatch.setattr(progress, "_now", lambda: NOW)
    monkeypatch.setattr(league_store, "_now", lambda: NOW)
    fake.tables["profiles"] = [{"user_id": u, "display_name": f"Real Name {n}", "email": f"person{n}@example.com"}
                               for n, u in enumerate((ME, ANN, BO, CY))]
    for name in ("user_progress", "user_badges"):
        fake.tables[name] = []
    return fake


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: ME
    yield TestClient(app)
    app.dependency_overrides.clear()


def ledger(db, user, amount, at, source="focus", tz_day=None):
    n = len(db.tables["xp_events"])
    db.tables["xp_events"].append({"user_id": user, "source": source, "source_id": f"x{n}", "amount": amount,
                                   "earned_at": at.isoformat(), "local_day": tz_day or at.date().isoformat()})


def progress_row(db, user=ME, **values):
    row = {"user_id": user, "total_xp": 0, "daily_goal": 50, "timezone": "UTC", "streak_days": 0,
           "streak_freezes": 0, "last_goal_day": None, "display_name": None, "leaderboard_opt_out": False, **values}
    db.tables["user_progress"].append(row)
    return row


def week_row(db, start, gid="g1", wid=None, status="open"):
    wid = wid or f"week-{start.date()}"
    db.tables["league_weeks"].append({"id": wid, "starts_at": start.isoformat(),
                                      "ends_at": (start + timedelta(days=7)).isoformat(), "status": status,
                                      "grouped_at": start.isoformat(), "closed_at": None})
    db.tables["league_groups"].append({"id": gid, "week_id": wid, "tier": "Hardcover"})
    return wid


def member(db, wid, user, gid="g1", tier="Hardcover", n=0):
    db.tables["league_members"].append({"week_id": wid, "group_id": gid, "user_id": user, "tier": tier,
                                        "joined_at": (LAST - timedelta(days=30, minutes=-n)).isoformat(),
                                        "weekly_xp": 0, "xp_reached_at": None, "final_rank": None, "outcome": None})


def no_leak(response, *others):
    text = response.text
    assert "@" not in text and "email" not in text.lower() and "user_id" not in text
    for other in others:
        assert other not in text
    assert "Real Name" not in text  # the sign-in's name is never used


# --- GET /me/progress --------------------------------------------------------------------------------------------

def test_a_new_reader_sees_the_defaults_and_nothing_is_written(client, db):
    body = client.get("/me/progress").json()
    assert body == {"total_xp": 0, "daily_goal": 50, "timezone": "UTC", "display_name": None,
                    "leaderboard_opt_out": False, "today": {"day": "2026-11-18", "xp": 0, "goal": 50, "met": False},
                    "streak": {"days": 0, "freezes": 0, "frozen_days": []}, "tier": "Pamphlet", "badges": []}
    assert db.tables["user_progress"] == []


def test_progress_counts_todays_focus_xp_in_the_readers_zone_and_shows_the_streak_and_badges(client, db):
    progress_row(db, total_xp=230, timezone="Asia/Dhaka", streak_days=8, streak_freezes=1, last_goal_day="2026-11-17")
    ledger(db, ME, 30, NOW - timedelta(hours=1), tz_day="2026-11-18")
    ledger(db, ME, 20, NOW, tz_day="2026-11-18")
    ledger(db, ME, 25, NOW, source="badge", tz_day="2026-11-18")  # badge XP is not goal XP
    ledger(db, ME, 99, NOW - timedelta(days=1), tz_day="2026-11-17")
    ledger(db, ANN, 500, NOW, tz_day="2026-11-18")
    db.tables["user_badges"] += [{"user_id": ME, "badge_id": "streak_7", "awarded_at": "2026-11-17T10:00:00+00:00"},
                                 {"user_id": ANN, "badge_id": "first_note", "awarded_at": "2026-11-17T10:00:00+00:00"}]
    response = client.get("/me/progress")
    body = response.json()
    assert body["today"] == {"day": "2026-11-18", "xp": 50, "goal": 50, "met": True}  # 21:00 in Dhaka: still Nov 18
    assert body["streak"] == {"days": 8, "freezes": 1, "frozen_days": []} and body["total_xp"] == 230
    assert body["badges"] == [{"id": "streak_7", "name": "7-day streak", "awarded_at": "2026-11-17T10:00:00+00:00"}]
    no_leak(response, ANN)


def test_a_missed_day_shows_frozen_and_the_tier_comes_from_this_weeks_group(client, db):
    progress_row(db, streak_days=8, streak_freezes=1, last_goal_day="2026-11-16")
    wid = week_row(db, WEEK)
    member(db, wid, ME, tier="Folio")
    body = client.get("/me/progress").json()
    assert body["streak"] == {"days": 8, "freezes": 0, "frozen_days": ["2026-11-17"]}
    assert body["tier"] == "Folio"


def test_progress_reads_in_two_rounds_not_one_query_after_another(client, db, monkeypatch):
    """C34.6 (issue 14): the row, badges and week at once, then today's XP with the group: two rounds, not five."""
    import time

    from backend.tests import test_league_store

    slow = 0.2
    progress_row(db)
    wid = week_row(db, WEEK)
    member(db, wid, ME, tier="Folio")
    execute = test_league_store.Query.execute
    monkeypatch.setattr(test_league_store.Query, "execute", lambda self: (time.sleep(slow), execute(self))[1])
    started = time.perf_counter()
    body = client.get("/me/progress").json()
    elapsed = time.perf_counter() - started
    assert body["tier"] == "Folio"
    assert elapsed < 3 * slow, f"{elapsed:.2f} s: about {elapsed / slow:.0f} queries one after another"


def test_without_a_group_this_week_the_tier_is_carried_from_the_last_closed_week(client, db):
    wid = week_row(db, LAST, status="closed")
    member(db, wid, ME, tier="Paperback")
    db.tables["league_members"][0].update(final_rank=1, outcome="promoted")
    week_row(db, WEEK, gid="g2")  # this week formed without me
    assert client.get("/me/progress").json()["tier"] == "Hardcover"


# --- PUT /me/progress ----------------------------------------------------------------------------------------------

def test_settings_are_saved_and_returned(client, db):
    response = client.put("/me/progress", json={"daily_goal": 120, "display_name": "  Quiet   Owl ",
                                                "leaderboard_opt_out": True, "timezone": "America/Los_Angeles"})
    assert response.status_code == 200
    body = response.json()
    assert (body["daily_goal"], body["display_name"], body["leaderboard_opt_out"], body["timezone"]) == (
        120, "Quiet Owl", True, "America/Los_Angeles")
    assert body["today"]["day"] == "2026-11-18" and body["today"]["goal"] == 120  # 07:00 in Los Angeles
    stored = db.tables["user_progress"][0]
    assert (stored["user_id"], stored["daily_goal"], stored["display_name"]) == (ME, 120, "Quiet Owl")


def test_a_partial_change_keeps_the_rest_and_null_clears_the_name(client, db):
    progress_row(db, daily_goal=80, display_name="Owl", timezone="Europe/London", total_xp=40)
    client.put("/me/progress", json={"leaderboard_opt_out": True})
    stored = db.tables["user_progress"][0]
    assert (stored["daily_goal"], stored["display_name"], stored["timezone"], stored["total_xp"]) == (
        80, "Owl", "Europe/London", 40)
    client.put("/me/progress", json={"display_name": None})
    assert db.tables["user_progress"][0]["display_name"] is None and len(db.tables["user_progress"]) == 1


@pytest.mark.parametrize("body", [
    {"daily_goal": 19}, {"daily_goal": 201}, {"daily_goal": "lots"}, {"daily_goal": 50.5}, {"daily_goal": True},
    {"display_name": ""}, {"display_name": "   "}, {"display_name": "x" * 41}, {"display_name": "Owl\u0007"},
    {"display_name": "sh1t happens"}, {"display_name": "F U C K"}, {"display_name": "Big Phuck"},
    {"display_name": "admin"}, {"display_name": "ReadFocus Team"}, {"display_name": "Steve"},
    {"display_name": "me@example.com"}, {"display_name": "visit www.spam.example"},
    {"display_name": "https://x.example"}, {"timezone": "Mars/Olympus_Mons"}, {"timezone": ""},
    {"timezone": "Europe/" + "x" * 60}, {"leaderboard_opt_out": "yes"},
    {"total_xp": 99999}, {"streak_days": 400}, {}, {"daily_goal": 50, "user_id": ANN},
])
def test_bad_settings_are_refused_and_nothing_changes(client, db, body):
    progress_row(db, daily_goal=80, display_name="Owl")
    before = json.dumps(db.tables["user_progress"])
    assert client.put("/me/progress", json=body).status_code == 422
    assert json.dumps(db.tables["user_progress"]) == before


@pytest.mark.parametrize(("name", "kept"), [
    ("Scunthorpe Reader", "Scunthorpe Reader"), ("Classic Assassin", "Classic Assassin"),
    ("Anne-Marie O'Neil", "Anne-Marie O'Neil"), ("Zoë 🦉", "Zoë 🦉"), ("Kenji 健二", "Kenji 健二"), ("R2_D2", "R2_D2"),
    ("x" * 40, "x" * 40), ("Mr.Smith", "Mr.Smith"), ("Shitake Lover", "Shitake Lover"),
    ("Dick Francis", "Dick Francis"),
    ("J. R. R. Tolkien", "J. R. R. Tolkien"),
])
def test_ordinary_names_pass_the_check(client, db, name, kept):
    response = client.put("/me/progress", json={"display_name": name})
    assert response.status_code == 200 and response.json()["display_name"] == kept


@pytest.mark.parametrize(("goal"), [20, 200, 50])
def test_the_goal_bounds_are_inclusive(client, db, goal):
    assert client.put("/me/progress", json={"daily_goal": goal}).json()["daily_goal"] == goal


# --- GET /badges ---------------------------------------------------------------------------------------------------

def test_badges_list_the_whole_catalogue_with_only_my_awards(client, db):
    db.tables["user_badges"] += [{"user_id": ME, "badge_id": "first_focus", "awarded_at": "2026-11-17T09:00:00+00:00"},
                                 {"user_id": ANN, "badge_id": "streak_7", "awarded_at": "2026-11-17T09:00:00+00:00"}]
    response = client.get("/badges")
    body = response.json()
    assert (body["total"], body["earned"]) == (14, 1) and len(body["badges"]) == 14
    first = body["badges"][0]
    assert first == {"id": "first_focus", "name": "First focus session",
                     "description": "Finish a focus session and pass its quiz.", "xp_reward": 20, "kind": "seal",
                     "earned": True, "awarded_at": "2026-11-17T09:00:00+00:00"}
    streak = next(b for b in body["badges"] if b["id"] == "streak_7")
    assert streak["earned"] is False and streak["awarded_at"] is None
    no_leak(response, ANN)


# --- GET /leagues/current --------------------------------------------------------------------------------------------

def group_of_four(db):
    wid = week_row(db, WEEK)
    for n, user in enumerate((ME, ANN, BO, CY)):
        member(db, wid, user, n=n)
    ledger(db, ANN, 90, WEEK + timedelta(days=1))
    ledger(db, BO, 40, WEEK + timedelta(hours=5))
    ledger(db, BO, 20, WEEK + timedelta(days=2))
    ledger(db, ME, 60, WEEK + timedelta(days=1, hours=2))
    ledger(db, CY, 500, WEEK - timedelta(hours=1))  # last week's: not this week's XP
    return wid


def test_my_group_is_ranked_by_this_weeks_xp_with_zones(client, db):
    group_of_four(db)
    progress_row(db, display_name="Owl")
    progress_row(db, ANN, display_name="Heron")
    response = client.get("/leagues/current")
    body = response.json()
    assert body["week"] == {"starts_at": WEEK.isoformat(), "ends_at": (WEEK + timedelta(days=7)).isoformat()}
    assert (body["tier"], body["in_group"], body["opted_out"]) == ("Hardcover", True, False)
    assert body["zones"] == {"size": 4, "promote": 1, "demote": 0}
    rows = [(r["rank"], r["display_name"], r["weekly_xp"], r["zone"], r["you"]) for r in body["rows"]]
    assert rows[0] == (1, "Heron", 90, "promotion", False)
    assert rows[1] == (2, "Owl", 60, None, True)  # 60 reached before Bo's 60
    assert rows[2][2:] == (60, None, False) and rows[3][2:] == (0, None, False)
    assert all(set(r) == {"id", "rank", "display_name", "weekly_xp", "zone", "you"} for r in body["rows"])
    no_leak(response, ANN, BO, CY, "week-")


def test_a_reader_without_a_name_is_shown_by_their_pseudonym(client, db):
    group_of_four(db)
    rows = client.get("/leagues/current").json()["rows"]
    for row in rows:
        assert row["display_name"] == f"Reader {row['id'][:4]}"
        assert len(row["id"]) == 12 and int(row["id"], 16) >= 0


def test_pseudonyms_hold_for_a_week_and_change_with_the_next(client, db, monkeypatch):
    group_of_four(db)
    first = client.get("/leagues/current").json()["rows"]
    assert first == client.get("/leagues/current").json()["rows"]  # the same all week
    assert len({r["id"] for r in first}) == 4
    mine = next(r["id"] for r in first if r["you"])
    nxt = WEEK + timedelta(days=7)
    wid = week_row(db, nxt, gid="g9")
    member(db, wid, ME, gid="g9")
    for name in (progress, league_store):
        monkeypatch.setattr(name, "_now", lambda: nxt + timedelta(hours=1))
    later = next(r["id"] for r in client.get("/leagues/current").json()["rows"] if r["you"])
    assert later != mine and ME.replace("-", "")[:12] not in (mine, later)


def test_opted_out_readers_are_hidden_from_others_with_ranks_kept(client, db):
    group_of_four(db)
    progress_row(db, ANN, leaderboard_opt_out=True, display_name="Heron")
    body = client.get("/leagues/current").json()
    assert [r["rank"] for r in body["rows"]] == [2, 3, 4] and "Heron" not in json.dumps(body)
    assert body["zones"]["size"] == 4  # the hidden reader still counts


def test_an_opted_out_reader_still_sees_their_group_and_themselves(client, db):
    group_of_four(db)
    progress_row(db, leaderboard_opt_out=True, display_name="Owl")
    body = client.get("/leagues/current").json()
    assert body["opted_out"] is True and len(body["rows"]) == 4
    assert next(r for r in body["rows"] if r["you"])["display_name"] == "Owl"


def test_a_reader_not_grouped_this_week_sees_their_tier_and_no_rows(client, db):
    wid = week_row(db, WEEK)
    member(db, wid, ANN)
    response = client.get("/leagues/current")
    week = {"starts_at": WEEK.isoformat(), "ends_at": (WEEK + timedelta(days=7)).isoformat()}
    assert response.json() == {"week": week,
                               "tier": "Pamphlet", "in_group": False, "opted_out": False,
                               "zones": None, "rows": [], "last_week": None}
    no_leak(response, ANN)


def test_an_overdue_week_is_rolled_over_on_read(client, db):
    wid = week_row(db, LAST)  # still open, though it ended Monday
    member(db, wid, ME)
    ledger(db, ME, 70, LAST + timedelta(days=2))
    body = client.get("/leagues/current").json()
    closed = next(w for w in db.tables["league_weeks"] if w["id"] == wid)
    assert closed["status"] == "closed" and db.tables["league_members"][0]["outcome"] == "stayed"
    assert body["week"]["starts_at"] == WEEK.isoformat() and body["in_group"] is True  # formed on this read
    assert body["tier"] == "Hardcover" and body["rows"][0]["you"] is True


def test_no_rollover_runs_when_nothing_is_due(client, db, monkeypatch):
    group_of_four(db)
    calls = []
    monkeypatch.setattr(league_store, "roll_over", lambda now=None: calls.append(now))
    client.get("/leagues/current")
    assert calls == []


def test_the_endpoints_need_a_signed_in_reader(db):
    app.dependency_overrides.clear()
    plain = TestClient(app)
    for method, url in (("get", "/me/progress"), ("put", "/me/progress"), ("get", "/badges"),
                        ("get", "/leagues/current")):
        assert getattr(plain, method)(url).status_code in (401, 403), url


# --- last week's outcome (C24.6c) -------------------------------------------------------------------------------------

def test_last_weeks_outcome_comes_from_my_latest_closed_week(client, db):
    wid = week_row(db, LAST, gid="g0", status="closed")
    member(db, wid, ME, gid="g0", tier="Paperback")
    member(db, wid, ANN, gid="g0", tier="Paperback", n=1)
    db.tables["league_members"][0].update(final_rank=2, outcome="promoted", weekly_xp=180)
    db.tables["league_members"][1].update(final_rank=1, outcome="promoted", weekly_xp=200)
    group_of_four(db)
    response = client.get("/leagues/current")
    assert response.json()["last_week"] == {"starts_at": LAST.isoformat(), "tier": "Paperback", "rank": 2, "size": 2,
                                            "weekly_xp": 180, "outcome": "promoted", "now_in": "Hardcover"}
    no_leak(response, ANN, BO, CY)


def test_no_last_week_before_a_week_has_closed(client, db):
    group_of_four(db)
    assert client.get("/leagues/current").json()["last_week"] is None
