"""The focus session API (C23.4, docs/FOCUS_RULES.md): start, events, pause, resume, end, GET, the 3-hour cap and
the abandoned sweep. The server's clock is a test clock; the database is in memory."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.focus import policy, store
from backend.main import app
from backend.routers import focus
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
T0 = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


def pdf(page, y=100.0):
    return {"kind": "pdf", "page": page, "quads": [[50, y, 50, y]], "text": ""}


def epub(spine, step=2, offset=0):
    return {"kind": "epub", "cfi": f"epubcfi(/6/{2 * (spine + 1)}!/4/{step}/1:{offset})", "text": ""}


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return T0 + timedelta(seconds=self.t)


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(store, "now", c)
    return c


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [
        {"id": "pdf-book", "user_id": USER, "file_type": "pdf", "page_count": 300, "toc": [],
         "body_start": {"kind": "pdf", "page": 5, "title": "Chapter 1"}, "body_start_source": "outline"},
        {"id": "epub-book", "user_id": USER, "file_type": "epub", "page_count": None, "toc": [],
         "body_start": {"kind": "epub", "spine_index": 3, "title": "Chapter 1"}, "body_start_source": "outline"},
        {"id": "plain-book", "user_id": USER, "file_type": "pdf", "page_count": 10, "toc": [], "body_start": None,
         "body_start_source": None},
        {"id": "theirs", "user_id": OTHER, "file_type": "pdf", "page_count": 10, "toc": [], "body_start": None,
         "body_start_source": None},
    ]
    db.tables["page_regions"] = []
    db.tables["focus_sessions"] = []
    db.tables["focus_events"] = []
    monkeypatch.setattr(focus, "supabase", db)
    monkeypatch.setattr(store, "supabase", db)
    return db


@pytest.fixture
def client(db, clock):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def start(client, book="pdf-book", anchor=None):
    return client.post("/focus/start", json={"book_id": book, "anchor": anchor or pdf(6)})


def event(client, sid, kind="heartbeat", **extra):
    return client.post(f"/focus/{sid}/event", json={"kind": kind, **extra})


def stored(db, kind=None):
    return [e for e in db.tables["focus_events"] if kind is None or e["kind"] == kind]


def session_row(db, sid):
    return next(s for s in db.tables["focus_sessions"] if s["id"] == sid)


def read_for(client, clock, sid, seconds, every=25):
    """Heartbeats with input from now for `seconds`, every `every` s, through the API."""
    begin = clock.t
    while clock.t <= begin + seconds:
        assert event(client, sid, had_input=True).json()["accepted"]
        clock.t += every
    clock.t -= every


# --- start --------------------------------------------------------------------------------------------------------

def test_start_at_the_body_creates_an_active_session_and_its_start_event(client, db, clock):
    response = start(client, anchor=pdf(6, y=210.7))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "active" and body["state"] == "running" and body["active_seconds"] == 0
    row = session_row(db, body["id"])
    assert row["user_id"] == USER and row["book_id"] == "pdf-book" and row["rules_version"] == policy.RULES_VERSION
    assert row["start_position"] == 6 * 1_000_000 + 210 * 100
    assert [(e["kind"], e["server_ts"]) for e in stored(db)] == [("start", T0.isoformat())]


@pytest.mark.parametrize("book, anchor", [("pdf-book", pdf(4)), ("epub-book", epub(2))])
def test_start_before_the_body_start_is_refused(client, db, book, anchor):
    response = start(client, book, anchor)
    assert response.status_code == 409 and "Chapter 1" in response.json()["detail"]
    assert db.tables["focus_sessions"] == [] and db.tables["focus_events"] == []


def test_start_at_or_after_the_body_in_an_epub_and_anywhere_in_a_book_without_one(client, db):
    assert start(client, "epub-book", epub(3)).status_code == 200
    db.tables["focus_sessions"][0]["status"] = "abandoned"
    assert start(client, "plain-book", pdf(1)).status_code == 200


def test_a_second_open_session_is_refused_and_named(client, db):
    first = start(client).json()["id"]
    response = start(client, "epub-book", epub(5))
    assert response.status_code == 409 and response.json()["detail"]["session_id"] == first
    assert len(db.tables["focus_sessions"]) == 1


def test_start_checks_the_book_and_the_anchor(client, db):
    assert start(client, "theirs", pdf(1)).status_code == 404
    assert start(client, "pdf-book", epub(5)).status_code == 422  # an EPUB place in a PDF
    assert start(client, "pdf-book", pdf(301)).status_code == 422  # past the last page
    assert db.tables["focus_sessions"] == []


# --- events and the rate limit ------------------------------------------------------------------------------------

def test_heartbeats_faster_than_25_s_are_ignored_and_counted(client, db, clock):
    sid = start(client).json()["id"]
    assert event(client, sid, had_input=True).json()["accepted"] is True
    clock.t = 10
    ignored = event(client, sid).json()
    assert ignored["accepted"] is False and ignored["reason"] == "rate_limited"
    assert ignored["session"]["ignored_events"] == 1
    clock.t = 25
    assert event(client, sid).json()["accepted"] is True
    assert len(stored(db, "heartbeat")) == 2 and session_row(db, sid)["ignored_events"] == 1


def test_other_events_at_most_one_per_kind_every_2_s(client, db, clock):
    sid = start(client).json()["id"]
    assert event(client, sid, "page_turn", page_key="p7", position=7e6).json()["accepted"]
    clock.t = 1
    assert event(client, sid, "page_turn", page_key="p8").json()["reason"] == "rate_limited"
    assert event(client, sid, "hidden").json()["accepted"]  # another kind: a quick tab switch is not lost
    clock.t = 1.5
    assert event(client, sid, "visible").json()["accepted"]
    clock.t = 3
    assert event(client, sid, "page_turn", page_key="p8").json()["accepted"]
    assert session_row(db, sid)["ignored_events"] == 1


def test_a_resent_event_is_a_duplicate(client, db, clock):
    sid = start(client).json()["id"]
    cid = "8a3f0d6e-0d1c-4e4e-9c55-3f6f1b1f2a10"
    assert event(client, sid, "page_turn", client_event_id=cid).json()["accepted"]
    clock.t = 30
    assert event(client, sid, "page_turn", client_event_id=cid).json()["reason"] == "duplicate"
    assert len(stored(db, "page_turn")) == 1


def test_the_tabs_clock_is_stored_but_never_used(client, db, clock):
    sid = start(client).json()["id"]
    event(client, sid, had_input=True, client_ts="2030-01-01T00:00:00Z")
    clock.t = 25
    body = event(client, sid, had_input=True, client_ts="1999-01-01T00:00:00Z").json()
    assert body["session"]["active_seconds"] == 25
    assert stored(db, "heartbeat")[0]["client_ts"].startswith("2030") and stored(db, "heartbeat")[0]["server_ts"] == T0.isoformat()


@pytest.mark.parametrize("body", [
    {"kind": "heartbeat", "active_seconds": 600}, {"kind": "start"}, {"kind": "end"}, {"kind": "pause"},
    {"kind": "heartbeat", "page_key": "p" * 65}, {"kind": "heartbeat", "position": -1}, {"kind": "nap"},
])
def test_events_carry_no_numbers_of_the_clients_and_only_their_own_kinds(client, db, body):
    sid = start(client).json()["id"]
    assert client.post(f"/focus/{sid}/event", json=body).status_code == 422
    assert len(stored(db)) == 1  # the start event only


# --- the state machine --------------------------------------------------------------------------------------------

def test_pause_resume_end_and_what_each_state_allows(client, db, clock):
    sid = start(client).json()["id"]
    read_for(client, clock, sid, 300)
    clock.t += 25
    assert client.post(f"/focus/{sid}/pause").json()["status"] == "paused"
    assert client.post(f"/focus/{sid}/pause").status_code == 409
    clock.t += 300
    assert event(client, sid).json()["accepted"]  # stored; scored as paused
    clock.t += 30
    resumed = client.post(f"/focus/{sid}/resume").json()
    assert resumed["status"] == "active" and resumed["state"] == "running"
    assert client.post(f"/focus/{sid}/resume").status_code == 409
    read_for(client, clock, sid, 300)
    ended = client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(9)}).json()
    assert ended["status"] == "awaiting_quiz" and ended["ended_at"]
    assert ended["active_seconds"] == 600 and ended["reasons"].get("paused", 0) >= 300
    for path in ("pause", "resume"):
        assert client.post(f"/focus/{sid}/{path}").status_code == 409
    assert event(client, sid).status_code == 409
    assert client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(10)}).status_code == 409
    assert [e["kind"] for e in stored(db) if e["kind"] in ("pause", "resume", "end")] == ["pause", "resume", "end"]


def test_the_end_freezes_active_time(client, db, clock):
    sid = start(client).json()["id"]
    read_for(client, clock, sid, 600)
    clock.t += 1
    client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(8)})
    clock.t += 7200
    body = client.get(f"/focus/{sid}").json()
    assert body["status"] == "awaiting_quiz" and body["active_seconds"] == 600 and body["points_time"] == 100
    row = session_row(db, sid)
    assert row["active_seconds"] == 600 and row["end_position"] == 8 * 1_000_000 + 100 * 100
    assert row["end_anchor"] == pdf(8)


@pytest.mark.parametrize("bookmark", [pdf(6, y=50), pdf(6, y=100), pdf(5), epub(3)])
def test_the_bookmark_must_come_after_the_start(client, db, bookmark):
    sid = start(client, anchor=pdf(6, y=100)).json()["id"]
    response = client.post(f"/focus/{sid}/end", json={"bookmark_anchor": bookmark})
    assert response.status_code == 422
    assert session_row(db, sid)["status"] == "active"


def test_an_epub_bookmark_later_in_the_same_section_is_after(client, db):
    sid = start(client, "epub-book", epub(4, step=2, offset=10)).json()["id"]
    assert client.post(f"/focus/{sid}/end", json={"bookmark_anchor": epub(4, step=2, offset=5)}).status_code == 422
    assert client.post(f"/focus/{sid}/end", json={"bookmark_anchor": epub(4, step=6)}).status_code == 200


def test_get_reports_server_time_and_a_hidden_tab(client, db, clock):
    sid = start(client).json()["id"]
    read_for(client, clock, sid, 600)
    body = client.get(f"/focus/{sid}").json()
    assert (body["active_seconds"], body["points_time"], body["state"]) == (600, 100, "running")
    assert body["cap_remaining_s"] == policy.SESSION_CAP_S - 600
    clock.t += 5
    event(client, sid, "hidden")
    assert client.get(f"/focus/{sid}").json()["state"] == "hidden"


# --- the 3-hour cap -----------------------------------------------------------------------------------------------

def seed_heartbeats(db, sid, until):
    for n, t in enumerate(range(25, until + 1, 25)):
        db.tables["focus_events"].append({"id": f"seed-{n}", "session_id": sid, "user_id": USER, "kind": "heartbeat",
                                          "had_input": True, "page_key": None, "position": None, "client_ts": None,
                                          "client_event_id": None,
                                          "server_ts": (T0 + timedelta(seconds=t)).isoformat()})
    for n, t in enumerate(range(600, until, 600)):  # a page turn every ten minutes
        db.tables["focus_events"].append({"id": f"turn-{n}", "session_id": sid, "user_id": USER, "kind": "page_turn",
                                          "had_input": True, "page_key": f"p{n}", "position": None, "client_ts": None,
                                          "client_event_id": None,
                                          "server_ts": (T0 + timedelta(seconds=t + 1)).isoformat()})
    db.tables["focus_events"].sort(key=lambda e: e["server_ts"])
    session_row(db, sid)["updated_at"] = db.tables["focus_events"][-1]["server_ts"]  # as the API bumps it


def test_the_event_that_reaches_three_hours_moves_the_session_to_its_quiz(client, db, clock):
    sid = start(client).json()["id"]
    event(client, sid, had_input=True)
    seed_heartbeats(db, sid, policy.SESSION_CAP_S - 25)
    clock.t = policy.SESSION_CAP_S
    body = event(client, sid, had_input=True).json()
    assert body["accepted"] and body["session"]["status"] == "awaiting_quiz" and body["session"]["capped"]
    assert body["session"]["active_seconds"] == policy.SESSION_CAP_S and body["session"]["points_time"] == 1800
    row = session_row(db, sid)
    assert row["status"] == "awaiting_quiz" and row["ended_at"] and row["active_seconds"] == policy.SESSION_CAP_S
    clock.t += 25
    assert event(client, sid).status_code == 409


def test_get_also_moves_a_capped_session_to_its_quiz(client, db, clock):
    sid = start(client).json()["id"]
    event(client, sid, had_input=True)
    seed_heartbeats(db, sid, policy.SESSION_CAP_S + 1200)
    clock.t = policy.SESSION_CAP_S + 1210
    body = client.get(f"/focus/{sid}").json()
    assert body["status"] == "awaiting_quiz" and body["active_seconds"] == policy.SESSION_CAP_S
    assert body["reasons"]["session_cap"] == 1200


# --- abandoned sessions -------------------------------------------------------------------------------------------

def test_a_session_with_no_events_for_two_hours_is_abandoned_with_no_points(client, db, clock):
    sid = start(client).json()["id"]
    read_for(client, clock, sid, 300)
    clock.t += policy.ABANDON_AFTER_S - 1  # read_for leaves the clock at the last heartbeat
    assert client.get(f"/focus/{sid}").json()["status"] == "active"
    clock.t += 2
    body = client.get(f"/focus/{sid}").json()
    assert body["status"] == "abandoned" and body["points_time"] == 0 and body["points_total"] == 0
    row = session_row(db, sid)
    assert row["status"] == "abandoned" and row["ended_at"] and row["points_total"] == 0
    assert event(client, sid).status_code == 409
    assert start(client).status_code == 200  # no longer open: a new session may start


def test_the_startup_sweep_abandons_every_readers_stale_sessions_only(db, clock):
    stale = (T0 - timedelta(seconds=policy.ABANDON_AFTER_S + 1)).isoformat()
    fresh = (T0 - timedelta(seconds=60)).isoformat()
    for sid, status, updated in [("a", "active", stale), ("b", "paused", stale), ("c", "active", fresh),
                                 ("d", "awaiting_quiz", stale)]:
        db.tables["focus_sessions"].append({"id": sid, "user_id": OTHER, "book_id": "theirs", "status": status,
                                            "updated_at": updated, "points_total": 0})
    assert store.sweep_abandoned() == 2
    assert {s["id"]: s["status"] for s in db.tables["focus_sessions"]} == {
        "a": "abandoned", "b": "abandoned", "c": "active", "d": "awaiting_quiz"}


def test_the_app_sweeps_at_startup_when_enabled(monkeypatch):
    calls = []
    monkeypatch.setenv("FOCUS_SWEEP", "1")
    monkeypatch.setattr(store, "sweep_abandoned", lambda: calls.append(1) or 0)
    with TestClient(app):
        pass
    assert calls == [1]


# --- owner only ---------------------------------------------------------------------------------------------------

def test_another_readers_session_is_not_found_anywhere(client, db):
    sid = start(client).json()["id"]
    app.dependency_overrides[get_current_user] = lambda: OTHER
    assert client.get(f"/focus/{sid}").status_code == 404
    assert event(client, sid).status_code == 404
    for path in ("pause", "resume"):
        assert client.post(f"/focus/{sid}/{path}").status_code == 404
    assert client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(9)}).status_code == 404
    assert len(stored(db)) == 1 and session_row(db, sid)["status"] == "active"


# --- C23.6: the reader's current session, and discarding one ------------------------------------------------------

def test_current_returns_the_open_or_waiting_session_for_a_book_or_none(client, db, clock):
    assert client.get("/focus/current", params={"book_id": "pdf-book"}).json() == {"session": None}
    sid = start(client).json()["id"]
    body = client.get("/focus/current", params={"book_id": "pdf-book"}).json()["session"]
    assert body["id"] == sid and body["status"] == "active" and body["state"] == "running"
    assert client.get("/focus/current", params={"book_id": "epub-book"}).json() == {"session": None}
    clock.t = 30
    client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(9)})
    assert client.get("/focus/current", params={"book_id": "pdf-book"}).json()["session"]["status"] == "awaiting_quiz"
    session_row(db, sid)["status"] = "scored"
    assert client.get("/focus/current", params={"book_id": "pdf-book"}).json() == {"session": None}
    assert client.get("/focus/current", params={"book_id": "theirs"}).status_code == 404


def test_discarding_a_session_abandons_it_with_no_points(client, db, clock):
    sid = start(client).json()["id"]
    read_for(client, clock, sid, 300)
    body = client.post(f"/focus/{sid}/discard").json()
    assert body["status"] == "abandoned" and body["points_total"] == 0
    row = session_row(db, sid)
    assert row["status"] == "abandoned" and row["points_total"] == 0 and row["ended_at"]
    assert client.post(f"/focus/{sid}/discard").status_code == 409
    assert start(client).status_code == 200


def test_a_session_waiting_for_its_quiz_can_be_discarded_but_not_a_scored_one(client, db, clock):
    sid = start(client).json()["id"]
    clock.t = 30
    client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(9)})
    assert client.post(f"/focus/{sid}/discard").json()["status"] == "abandoned"
    session_row(db, sid)["status"] = "scored"
    assert client.post(f"/focus/{sid}/discard").status_code == 409


def test_a_capped_session_takes_its_bookmark_afterwards_without_more_time(client, db, clock):
    sid = start(client).json()["id"]
    event(client, sid, had_input=True)
    seed_heartbeats(db, sid, policy.SESSION_CAP_S + 600)
    clock.t = policy.SESSION_CAP_S + 610
    assert client.get(f"/focus/{sid}").json()["status"] == "awaiting_quiz"
    assert session_row(db, sid).get("end_anchor") is None
    body = client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(40)}).json()
    assert body["active_seconds"] == policy.SESSION_CAP_S and session_row(db, sid)["end_anchor"] == pdf(40)
    assert client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(41)}).status_code == 409  # set once


@pytest.mark.parametrize("book, began, bookmark", [
    ("epub-book", epub(4), {"kind": "epub", "cfi": "epubcfi(/6/11!/4)", "text": ""}),  # an odd spine step
    ("pdf-book", pdf(6), {"kind": "pdf", "page": 8, "quads": [[50, -20_000, 50, -20_000]], "text": ""}),
    ("pdf-book", pdf(6), {"kind": "pdf", "page": 400, "quads": [[50, 100, 50, 100]], "text": ""}),  # past the last page
])
def test_a_bookmark_that_is_not_a_place_in_the_book_is_refused(client, db, book, began, bookmark):
    """C23.G (DEBUG_LOG): a bookmark the quiz cannot map, or the database refuses, is refused before anything is
    stored, and the session stays open for a proper one."""
    sid = start(client, book, began).json()["id"]
    response = client.post(f"/focus/{sid}/end", json={"bookmark_anchor": bookmark})
    assert response.status_code == 422
    assert session_row(db, sid)["status"] == "active" and stored(db, "end") == []


def test_a_start_with_quads_off_the_page_is_refused(client, db):
    assert start(client, anchor={"kind": "pdf", "page": 6, "quads": [[50, -2_000, 50, 100]], "text": ""}).status_code == 422
    assert start(client, anchor={"kind": "pdf", "page": 6, "quads": [[-0.5, 99.6, 50, 100]], "text": ""}).status_code == 200
