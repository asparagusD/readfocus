"""Forged requests earn nothing they did not read for (C23.8, docs/FOCUS_RULES.md F3, F7, F12, F14): an end with no
heartbeats, heartbeat spam, a tab clock in the future, two tabs on one session, and writes to the focus tables
with the anon key. Through the API on the in-memory database, with the real grader and scoring engine."""

import re
from math import ceil
from pathlib import Path

from backend.tests.test_api_focus_quiz import (  # noqa: F401
    BOOK,
    answer,
    api,
    focus_row,
    pdf,
    read_and_end,
    stored_questions,
)

ROOT = Path(__file__).resolve().parents[2]
TAB_A = "11111111-1111-4111-8111-1111111111{:02x}"


def start(env, page=3):
    return env.client.post("/focus/start", json={"book_id": BOOK, "anchor": pdf(page)}).json()["id"]


def beat(env, sid, **extra):
    return env.client.post(f"/focus/{sid}/event", json={"kind": "heartbeat", "had_input": True, **extra}).json()


def end(env, sid, page=6):
    assert env.client.post(f"/focus/{sid}/end", json={"bookmark_anchor": pdf(page)}).status_code == 200


def take_quiz(env, sid, right):
    """Answers the session's quiz with `right` of its questions correct; the graded response."""
    env.client.post(f"/focus/{sid}/quiz")
    questions = stored_questions(env, sid)
    answers = [q["answer"] if i < right else "" for i, q in enumerate(questions)]
    return answer(env, sid, answers).json()


def count(env, sid):
    env.client.post(f"/focus/{sid}/quiz")
    return len(stored_questions(env, sid))


# --- forged timing --------------------------------------------------------------------------------------------------

def test_an_end_with_no_heartbeats_earns_nothing_even_with_every_answer_right(api):  # noqa: F811
    sid = start(api)
    api.clock.t = 3600  # an hour on the wall clock, not one heartbeat
    end(api, sid)
    body = take_quiz(api, sid, right=count(api, sid))
    assert body["passed"] is True and body["active_seconds"] == 0
    assert (body["points_time"], body["points_bonus"], body["points_total"]) == (0, 0, 0)
    assert focus_row(api, sid)["points_total"] == 0


def test_heartbeat_spam_counts_no_faster_than_the_clock(api):  # noqa: F811
    sid = start(api)
    for n in range(10 * 60 + 1):  # one a second for ten minutes
        api.clock.t = n
        beat(api, sid)
    kept = [e for e in api.db.tables["focus_events"] if e["kind"] == "heartbeat"]
    assert len(kept) <= 10 * 60 // 25 + 1  # at most one per 25 s is stored
    view = api.client.get(f"/focus/{sid}").json()
    assert view["active_seconds"] <= 600 and view["points_time"] <= 100  # ten minutes is 100 points, at most


def test_a_tab_clock_in_the_future_buys_no_time(api):  # noqa: F811
    sid = start(api)
    for n, t in enumerate(range(0, 61, 30)):
        api.clock.t = t
        beat(api, sid, client_ts=f"2027-0{n + 1}-01T00:00:00Z")  # months ahead
    view = api.client.get(f"/focus/{sid}").json()
    assert view["active_seconds"] == 60 and view["points_time"] == 10


def test_two_tabs_on_one_session_count_the_time_once(api):  # noqa: F811
    sid = start(api)
    for n in range(48):  # tab A and tab B each beat every 25 s, 12.5 s apart, for ten minutes
        api.clock.t = n * 12.5
        beat(api, sid, client_event_id=TAB_A.format(n))
    view = api.client.get(f"/focus/{sid}").json()
    assert view["active_seconds"] <= 600 and view["ignored_events"] >= 23  # every other beat is the other tab's


def test_a_second_tab_cannot_open_a_second_session(api):  # noqa: F811
    first = start(api)
    second = api.client.post("/focus/start", json={"book_id": BOOK, "anchor": pdf(4)})
    assert second.status_code == 409 and second.json()["detail"]["session_id"] == first
    assert len(api.db.tables["focus_sessions"]) == 1


def test_a_31_minute_stall_on_one_page_voids_only_the_minute_past_30(api):  # noqa: F811
    sid = start(api)
    for t in range(0, 31 * 60 + 1, 30):  # 31 minutes on one page, reading (input in every heartbeat)
        api.clock.t = t
        beat(api, sid)
    view = api.client.get(f"/focus/{sid}").json()
    assert view["counted_seconds"] == 30 * 60 and view["voided_seconds"] == 60
    assert view["reasons"] == {"page_cap": 60}
    assert view["points_time"] == 300


# --- the pass mark ----------------------------------------------------------------------------------------------------

def test_under_40_percent_the_session_earns_0_and_at_80_time_and_bonus(api):  # noqa: F811
    low = read_and_end(api, start=3, end=6, minutes=10)
    n = count(api, low)
    body = take_quiz(api, low, right=ceil(0.4 * n) - 1)  # 1 of 3 is 33%: under the 40% mark
    assert body["passed"] is False and body["points_total"] == 0
    high_sid = read_and_end(api, start=6, end=8, minutes=10)
    m = count(api, high_sid)
    right = ceil(0.8 * m)
    high = take_quiz(api, high_sid, right=right)
    assert high["passed"] is True
    assert high["points_time"] > 0 and high["points_bonus"] == 20 * right
    assert high["points_total"] == high["points_time"] + high["points_bonus"]


# --- the database: the anon key cannot write focus rows ---------------------------------------------------------------

def test_no_migration_lets_a_reader_write_focus_sessions_or_events():
    """RLS is on and the only policies are SELECT, in every migration: with the anon or a reader's key an insert,
    update or delete matches no policy and is denied; only the service role (the backend) writes."""
    sql = "\n".join(p.read_text(encoding="utf-8") for p in sorted((ROOT / "supabase" / "migrations").glob("*.sql")))
    flat = re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", sql))
    for table in ("focus_sessions", "focus_events"):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in flat
        policies = re.findall(rf"CREATE POLICY \"[^\"]+\" ON public\.{table}( FOR \w+)?", flat)
        assert policies == [" FOR SELECT"], table
        assert not re.search(rf"GRANT [^;]*ON (TABLE )?public\.{table}", flat), table
        assert f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY" not in flat


def test_the_app_never_writes_focus_rows_through_supabase_from_the_browser():
    """The frontend's Supabase client (the anon key) is used for auth; focus goes only through the backend API."""
    sources = [p for p in (ROOT / "frontend" / "src").rglob("*.js*") if ".test." not in p.name]
    hits = [p.name for p in sources if re.search(r"from\(\s*['\"]focus_(sessions|events)['\"]", p.read_text(encoding="utf-8"))]
    assert hits == []
