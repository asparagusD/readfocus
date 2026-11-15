"""The focus scoring engine (C23.3, docs/FOCUS_RULES.md F3-F14): pure, table-driven scenarios over server-timed
events. Times below are seconds after the session's start; client_ts is set wrong on purpose where it matters."""

from datetime import UTC, datetime, timedelta

import pytest

from backend.focus import policy
from backend.focus.scoring import Event, Quiz, ScoringInput, active_time, decide

T0 = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)
_ids = iter(range(1, 10**9))


def ev(at, kind, page=None, had_input=None, cid=None, skew=0):
    """One event at `at` seconds; `skew` puts the tab's own clock that far off (it must not matter)."""
    return Event(id=next(_ids), kind=kind, server_ts=T0 + timedelta(seconds=at), page_key=page, had_input=had_input,
                 client_event_id=cid, client_ts=T0 + timedelta(seconds=at + skew))


def beats(start, stop, every=15, had_input=True, skew=0):
    return [ev(t, "heartbeat", had_input=had_input, skew=skew) for t in range(start, stop + 1, every)]


def turns(start, stop, every=120):
    return [ev(t, "page_turn", page=f"p{t // every + 2}", had_input=True) for t in range(start, stop + 1, every)]


def session(stop, *extra, every_turn=120, skew=0):
    """Read steadily from 0 to `stop` with a page turn every two minutes, then place the bookmark."""
    return [ev(0, "start", page="p1"), *beats(0, stop, skew=skew), *turns(every_turn, stop - 1, every_turn), *extra,
            ev(stop, "end")]


def normal():
    return session(600)


def hidden_20_min():
    return [ev(0, "start", page="p1"), *beats(0, 600), ev(600, "hidden"), ev(1800, "visible"), *beats(1800, 2400),
            *turns(1920, 2399), ev(2400, "end")]


def hidden_but_beating():
    """A throttled background tab can keep sending heartbeats; hidden still counts nothing."""
    return [ev(0, "start", page="p1"), *beats(0, 1800), *turns(120, 1799), ev(600, "hidden"), ev(1200, "visible"),
            ev(1800, "end")]


def idle(answer_at=None):
    """Input until 60 s, then heartbeats without input; input again from 1500 s. The prompt shows at 660 s."""
    events = [ev(0, "start", page="p1"), *beats(0, 60), *beats(75, 1485, had_input=False), *beats(1500, 1800),
              ev(1800, "end")]
    if answer_at is not None:  # answered, then reading on: a page turn every two minutes
        events.append(ev(answer_at, "idle_confirm"))
        events += [ev(t, "page_turn", page=f"p{t}", had_input=True) for t in range(answer_at + 10, 1500, 120)]
    return events


def page_stall(minutes):
    """Reading (scrolling, so not idle) one page for `minutes` with no page turn."""
    stop = minutes * 60
    return [ev(0, "start", page="p1"), *beats(0, stop), ev(stop, "end")]


def pause_resume():
    return [ev(0, "start", page="p1"), *beats(0, 600), *turns(120, 599), ev(600, "pause"), *beats(615, 1185),
            ev(1200, "resume"), *beats(1200, 1800), *turns(1320, 1799), ev(1800, "end")]


def reopened_tab():
    """The tab is closed at 10 min and the session reopened two hours later."""
    return [ev(0, "start", page="p1"), *beats(0, 600), *turns(120, 599), ev(7800, "visible"), *beats(7800, 8400),
            *turns(7920, 8399), ev(8400, "end")]


def spam():
    """A heartbeat every second for ten minutes, each with its own id."""
    return [ev(0, "start", page="p1"), *[ev(t, "heartbeat", had_input=True, cid=f"00000000-0000-0000-0000-{t:012d}")
                                         for t in range(601)], *turns(120, 599), ev(600, "end")]


def duplicates():
    """Every heartbeat sent twice with the same id (a retried request)."""
    events = [ev(0, "start", page="p1"), *turns(120, 599)]
    for t in range(0, 601, 15):
        cid = f"00000000-0000-0000-0000-{t:012d}"
        events += [ev(t, "heartbeat", had_input=True, cid=cid), ev(t + 1, "heartbeat", had_input=True, cid=cid)]
    return [*events, ev(600, "end")]  # sent last, so stored last


def gaps():
    """Heartbeats 45 s apart count; 46 s apart do not (a dropped connection)."""
    return [ev(0, "start", page="p1"), ev(0, "heartbeat", had_input=True), ev(45, "heartbeat", had_input=True),
            ev(91, "heartbeat", had_input=True), ev(100, "end")]


def after_end():
    return [*session(300), *beats(315, 900)]


SCENARIOS = [
    # name, events, quiz, expected (a subset of the output)
    ("normal ten minutes", normal(), None,
     {"active_seconds": 600, "voided_seconds": 0, "counted_seconds": 600, "points_time": 100, "points_total": 100,
      "final": False}),
    ("normal, quiz passed 3 of 5", normal(), Quiz(correct=3, total=5),
     {"points_time": 100, "points_bonus": 60, "points_total": 160, "passed": True, "final": True}),
    ("tab hidden 20 minutes", hidden_20_min(), None,
     {"active_seconds": 1200, "reasons": {"hidden": 1200}, "points_time": 200}),
    ("hidden tab still sending heartbeats", hidden_but_beating(), None,
     {"active_seconds": 1200, "reasons": {"hidden": 600}}),
    ("idle prompt unanswered", idle(), None,
     {"active_seconds": 960, "reasons": {"idle": 840}, "points_time": 160}),
    ("idle prompt answered in 40 s", idle(answer_at=700), None, {"active_seconds": 1800, "reasons": {}}),
    ("idle prompt answered after 90 s", idle(answer_at=750), None,
     {"active_seconds": 1710, "reasons": {"idle": 90}}),
    ("45-minute page stall: only the 15 minutes beyond 30 voided", page_stall(45), None,
     {"active_seconds": 2700, "voided_seconds": 900, "counted_seconds": 1800, "points_time": 300,
      "reasons": {"page_cap": 900}}),
    ("29-minute page: nothing voided", page_stall(29), None, {"voided_seconds": 0, "points_time": 290}),
    ("exactly three hours", session(10800, every_turn=300), None,
     {"active_seconds": 10800, "capped": True, "points_time": 1800, "reasons": {}}),
    ("three hours twenty: the cap stops it", session(12000, every_turn=300), None,
     {"active_seconds": 10800, "capped": True, "points_time": 1800, "reasons": {"session_cap": 1200}}),
    ("quiz 39 of 100 earns nothing", normal(), Quiz(correct=39, total=100),
     {"passed": False, "points_time": 0, "points_bonus": 0, "points_total": 0, "counted_seconds": 600}),
    ("quiz 40 of 100 passes; the bonus is capped at the time points (C23.8)", normal(), Quiz(correct=40, total=100),
     {"passed": True, "points_time": 100, "points_bonus": 100, "points_total": 200}),
    ("one focused minute, a bookmark far ahead, 15 of 15 right: bonus capped at 10", session(60),
     Quiz(correct=15, total=15), {"passed": True, "points_time": 10, "points_bonus": 10, "points_total": 20}),
    ("quiz 2 of 5 is exactly the pass mark", normal(), Quiz(correct=2, total=5), {"passed": True, "points_total": 140}),
    ("quiz 5 of 13 fails", normal(), Quiz(correct=5, total=13), {"passed": False, "points_total": 0}),
    ("zero heartbeats, forged end an hour later", [ev(0, "start", page="p1"), ev(3600, "end")], None,
     {"active_seconds": 0, "points_total": 0, "reasons": {"no_heartbeat": 3600}}),
    ("zero heartbeats, then every quiz answer right (C23.8)", [ev(0, "start", page="p1"), ev(3600, "end")],
     Quiz(correct=3, total=3), {"passed": True, "points_time": 0, "points_bonus": 0, "points_total": 0}),
    ("heartbeats every second: no more than the clock", spam(), None,
     {"active_seconds": 600, "points_time": 100}),
    ("every heartbeat resent with its id", duplicates(), None, {"active_seconds": 600}),
    ("client clock five hours fast", session(600, skew=5 * 3600), None,
     {"active_seconds": 600, "points_time": 100}),
    ("client clock an hour slow", session(600, skew=-3600), None, {"active_seconds": 600}),
    ("pause and resume", pause_resume(), None,
     {"active_seconds": 1200, "reasons": {"paused": 600}, "points_time": 200}),
    ("reopened tab two hours later", reopened_tab(), None,
     {"active_seconds": 1200, "reasons": {"no_heartbeat": 7200}}),
    ("45 s between heartbeats counts, 46 s does not", gaps(), None,
     {"active_seconds": 45, "reasons": {"no_heartbeat": 55}}),
    ("events after the end are ignored", after_end(), None, {"active_seconds": 300}),
    ("voids and a failed quiz", page_stall(45), Quiz(correct=0, total=3),
     {"voided_seconds": 900, "points_total": 0, "passed": False}),
]


@pytest.mark.parametrize("events, quiz, expected", [s[1:] for s in SCENARIOS], ids=[s[0] for s in SCENARIOS])
def test_scenario(events, quiz, expected):
    out = decide(ScoringInput(events=events, quiz=quiz)).model_dump()
    for key, value in expected.items():
        assert out[key] == value, f"{key}: {out[key]!r} != {value!r}"


def test_at_least_fifteen_scenarios():
    assert len(SCENARIOS) >= 15


def test_the_tabs_clock_never_changes_the_result():
    honest = decide(ScoringInput(events=session(600))).model_dump()
    for skew in (-86400, -60, 7, 3600 * 30):
        assert decide(ScoringInput(events=session(600, skew=skew))).model_dump() == honest


def test_event_order_in_the_list_does_not_matter():
    events = hidden_20_min()
    assert decide(ScoringInput(events=list(reversed(events)))) == decide(ScoringInput(events=events))


def test_active_time_alone_and_the_cap():
    assert active_time(normal()) == 600
    assert active_time(session(12000, every_turn=300)) == policy.SESSION_CAP_S


def test_breakdown_lines_explain_every_number():
    out = decide(ScoringInput(events=page_stall(45), quiz=Quiz(correct=2, total=3)))
    lines = {line.code: line for line in out.lines}
    assert lines["counted"].seconds == 1800 and lines["counted"].points == 300
    assert lines["page_cap"].seconds == 900 and lines["page_cap"].points == 0
    assert "beyond 30 minutes" in lines["page_cap"].label
    assert lines["quiz_bonus"].points == 40
    failed = decide(ScoringInput(events=normal(), quiz=Quiz(correct=0, total=3)))
    assert [line.code for line in failed.lines][-1] == "quiz_failed"
    assert failed.lines[-1].points == 0 and "below 40%" in failed.lines[-1].label


def test_points_never_come_from_the_client():
    """The input has no field for a duration or a score: the engine reads only kinds, server times, pages and input."""
    assert set(Event.model_fields) == {"id", "kind", "server_ts", "client_ts", "client_event_id", "page_key", "had_input"}
    with pytest.raises(ValueError):
        Event(id=1, kind="heartbeat", server_ts=T0, active_seconds=999)
    with pytest.raises(ValueError):
        Quiz(correct=4, total=3)


def test_the_rules_version_is_stamped():
    assert decide(ScoringInput(events=normal())).rules_version == policy.RULES_VERSION


def test_the_page_cap_counts_active_time_on_the_page_not_the_clock():
    """Twenty minutes on a page, the tab closed for an hour, twenty more minutes: 40 active, 10 beyond 30."""
    events = [ev(0, "start", page="p1"), *beats(0, 1200), ev(4800, "visible"), *beats(4800, 6000), ev(6000, "end")]
    out = decide(ScoringInput(events=events))
    assert (out.active_seconds, out.voided_seconds, out.counted_seconds) == (2400, 600, 1800)


def test_a_capped_bonus_says_so_on_its_line():
    """C23.8: the quiz line is marked when the bonus was held to the time points, and only then."""
    capped = {line.code: line for line in decide(ScoringInput(events=session(60), quiz=Quiz(correct=15, total=15))).lines}
    assert (capped["quiz_bonus"].points, capped["quiz_bonus"].capped) == (10, True)
    full = {line.code: line for line in decide(ScoringInput(events=normal(), quiz=Quiz(correct=3, total=5))).lines}
    assert (full["quiz_bonus"].points, full["quiz_bonus"].capped) == (60, False)


def test_half_credit_for_low_confidence_counts_toward_the_pass_mark_and_the_bonus():
    out = decide(ScoringInput(events=normal(), quiz=Quiz(correct=1.5, total=4)))  # 37.5 %: below 40
    assert (out.passed, out.points_total) == (False, 0)
    out = decide(ScoringInput(events=normal(), quiz=Quiz(correct=2.5, total=5)))
    assert (out.passed, out.points_bonus, out.lines[-1].label) == (True, 50, "Quiz: 2.5 of 5 correct")
