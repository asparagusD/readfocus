"""Focus sessions in the database (C23.4): places, events, the live view of a session from the scoring engine,
and the abandoned sweep. The server's clock is `now()`; the router owns the HTTP rules."""

import os
import re
from datetime import UTC, datetime, timedelta
from math import floor

from backend.focus import policy
from backend.focus.scoring import Event, ScoringInput, ScoringOutput, decide
from backend.services.supabase_client import supabase

PART = 1_000_000  # A4: the page or spine index sits above this
EVENT_FIELDS = "id, kind, server_ts, client_ts, client_event_id, page_key, position, had_input"


def now() -> datetime:
    return datetime.now(UTC)


# --- places (docs/ANCHORS.md A1, A3, A4) --------------------------------------------------------------------------

def cfi_steps(cfi: str) -> list[int] | None:
    """A point CFI's steps and character offset as numbers, in document order: "/6/8!/4/2/1:5" -> [6, 8, 4, 2, 1, 5]."""
    inner = re.fullmatch(r"epubcfi\((.*)\)", cfi)
    if not inner or "," in inner.group(1):
        return None
    path = re.sub(r"\[[^\]]*\]", "", inner.group(1)).replace("!", "")
    numbers = re.findall(r"\d+", path)
    return [int(n) for n in numbers] if numbers and path.startswith("/") else None


def unit_of(anchor: dict) -> int | None:
    """A PDF anchor's page, or an EPUB point's spine index."""
    if anchor["kind"] == "pdf":
        return anchor["page"]
    steps = cfi_steps(anchor["cfi"])
    return steps[1] // 2 - 1 if steps and len(steps) > 1 and steps[1] >= 2 and steps[1] % 2 == 0 else None


def order_key(anchor: dict) -> tuple:
    """Sorts two places of one kind in reading order: PDF (page, top, left); EPUB the CFI's steps."""
    if anchor["kind"] == "pdf":
        x0, y0 = anchor["quads"][0][:2]
        return (anchor["page"], y0, x0)
    return tuple(cfi_steps(anchor["cfi"]) or ())


def position(anchor: dict) -> float:
    """The A4 position: PDF page and line (the x term is the reader's); EPUB the spine index (the character
    count is the reader's)."""
    if anchor["kind"] == "pdf":
        return anchor["page"] * PART + floor(anchor["quads"][0][1]) * 100
    return (unit_of(anchor) or 0) * PART


# --- rows ---------------------------------------------------------------------------------------------------------

def stamp(at: datetime) -> str:
    return at.astimezone(UTC).isoformat()


def load_session(session_id: str, user_id: str) -> dict | None:
    rows = supabase.table("focus_sessions").select("*").eq("id", session_id).eq("user_id", user_id).execute().data
    return rows[0] if rows else None


def open_session(user_id: str) -> dict | None:
    rows = supabase.table("focus_sessions").select("id, book_id, status").eq("user_id", user_id).in_(
        "status", list(policy.OPEN_STATUSES)).execute().data
    return rows[0] if rows else None


def load_events(session_id: str) -> list[dict]:
    """Every event of a session in server order (Supabase returns at most 1000 rows a call)."""
    rows, start, size = [], 0, 1000
    while True:
        page = supabase.table("focus_events").select(EVENT_FIELDS).eq("session_id", session_id).order(
            "server_ts").order("id").range(start, start + size - 1).execute().data or []
        rows.extend(page)
        if len(page) < size:
            return sorted(rows, key=lambda r: r["server_ts"])  # stable: ties keep the database's order
        start += size


def insert_event(session: dict, kind: str, at: datetime, **fields) -> dict:
    row = {"session_id": session["id"], "user_id": session["user_id"], "kind": kind, "server_ts": stamp(at), **fields}
    return supabase.table("focus_events").insert(row).execute().data[0]


def update_session(session: dict, values: dict) -> dict:
    session.update(values)
    supabase.table("focus_sessions").update(values).eq("id", session["id"]).execute()
    return session


# --- the live view ------------------------------------------------------------------------------------------------

def tally(events: list[dict]) -> ScoringOutput:
    scored = [Event(id=n, kind=e["kind"], server_ts=datetime.fromisoformat(e["server_ts"]),
                    client_event_id=e.get("client_event_id"), page_key=e.get("page_key"), had_input=e.get("had_input"))
              for n, e in enumerate(events)]
    return decide(ScoringInput(events=scored))


def live_state(session: dict, events: list[dict]) -> str:
    """running, paused (focus off), hidden (the tab in the background), or the session's status once it ended."""
    if session["status"] not in policy.OPEN_STATUSES:
        return session["status"]
    if session["status"] == "paused":
        return "paused"
    seen = [e["kind"] for e in events if e["kind"] in ("hidden", "visible")]
    return "hidden" if seen and seen[-1] == "hidden" else "running"


def view(session: dict, events: list[dict], out: ScoringOutput) -> dict:
    """What GET /focus/{id} and every action return: the server's time and provisional points."""
    lost = session["status"] == "abandoned"
    return {
        "id": session["id"], "book_id": session["book_id"], "status": session["status"],
        "state": live_state(session, events), "started_at": session.get("started_at"),
        "ended_at": session.get("ended_at"), "active_seconds": out.active_seconds,
        "voided_seconds": out.voided_seconds, "counted_seconds": out.counted_seconds, "capped": out.capped,
        "cap_remaining_s": max(0, policy.SESSION_CAP_S - out.active_seconds), "reasons": out.reasons,
        "points_time": 0 if lost else out.points_time, "points_total": 0 if lost else out.points_total,
        "ignored_events": session.get("ignored_events") or 0, "bookmark_set": bool(session.get("end_anchor")),
    }


def settle(session: dict, events: list[dict], at: datetime) -> ScoringOutput:
    """Recompute the tally, keep it on the row, and move a session that reached the 3-hour cap to its quiz (F8)."""
    out = tally(events)
    values = {"active_seconds": out.active_seconds, "voided_seconds": out.voided_seconds}
    if out.capped and session["status"] in policy.OPEN_STATUSES:
        last = next((e for e in reversed(events) if e.get("position") is not None), None)
        values.update(status="awaiting_quiz", ended_at=stamp(at), end_position=last["position"] if last else None)
    if any(session.get(k) != v for k, v in values.items()):
        update_session(session, values)
    return out


# --- abandoned sessions (F1) --------------------------------------------------------------------------------------

def stale(session: dict, at: datetime) -> bool:
    updated = session.get("updated_at") or session.get("started_at")
    return (session["status"] in policy.OPEN_STATUSES and updated is not None
            and at - datetime.fromisoformat(updated) > timedelta(seconds=policy.ABANDON_AFTER_S))


def abandon(session: dict, at: datetime) -> dict:
    return update_session(session, {"status": "abandoned", "ended_at": stamp(at), "points_time": 0,
                                    "points_bonus": 0, "points_total": 0})


def sweep_abandoned() -> int:
    """Abandon every reader's open sessions with no event for ABANDON_AFTER_S. Returns how many."""
    at = now()
    cutoff = stamp(at - timedelta(seconds=policy.ABANDON_AFTER_S))
    rows = supabase.table("focus_sessions").select("id, status, updated_at").in_(
        "status", list(policy.OPEN_STATUSES)).lt("updated_at", cutoff).execute().data or []
    for row in rows:
        abandon(row, at)
    return len(rows)


def sweep_enabled() -> bool:
    return os.getenv("FOCUS_SWEEP", "1") != "0"
