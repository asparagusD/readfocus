"""XP awards (C24.1, docs/GAMIFICATION.md G2, G4-G8): a scored focus session's final points become XP, once.

award_focus_xp(session) runs after focus/quiz.py scores a session. It writes one xp_events row keyed (focus,
session id): a second attempt finds the row, or the database's unique key refuses it, and nothing else changes.
The row's day is the reader's local day of the session's end (G4, G6). Then user_progress gets the ledger's total
and, when the day's XP first reaches the reader's goal, the streak moves (streaks.on_goal_day). That write is
conditional on the last goal day it read, so two awards racing for the same day move the streak once."""

import logging
from datetime import UTC, date, datetime

from backend.agents import policy
from backend.services.supabase_client import supabase
from backend.xp import streaks

log = logging.getLogger(__name__)

UNIQUE_VIOLATION = "23505"
RETRIES = 3


def _already_awarded(source: str, source_id: str) -> bool:
    return bool(supabase.table("xp_events").select("id").eq("source", source).eq("source_id", source_id)
                .execute().data)


def _insert_event(row: dict) -> None:
    supabase.table("xp_events").insert(row).execute()


def _is_duplicate(error: Exception) -> bool:
    return str(getattr(error, "code", "")) == UNIQUE_VIOLATION


def load_progress(user_id: str) -> dict:
    """The reader's progress row, created with the defaults when there is none."""
    rows = supabase.table("user_progress").select("*").eq("user_id", user_id).execute().data
    if rows:
        return rows[0]
    row = {"user_id": user_id, "total_xp": 0, "daily_goal": policy.DAILY_GOAL_XP, "timezone": "UTC",
           "streak_days": 0, "streak_freezes": 0, "last_goal_day": None}
    try:
        supabase.table("user_progress").insert(row).execute()
    except Exception as error:  # only a row made meanwhile by another award is expected here
        if not _is_duplicate(error):
            raise
        return supabase.table("user_progress").select("*").eq("user_id", user_id).execute().data[0]
    return row


def _amounts(user_id: str, day: str | None = None) -> int:
    query = supabase.table("xp_events").select("amount").eq("user_id", user_id)
    if day is not None:
        query = query.eq("local_day", day)
    return sum(int(r["amount"]) for r in query.execute().data)


def _stored(progress: dict) -> streaks.Streak:
    last = progress.get("last_goal_day")
    return streaks.Streak(int(progress.get("streak_days") or 0), int(progress.get("streak_freezes") or 0),
                          date.fromisoformat(last) if last else None)


def _write(progress: dict, values: dict) -> bool:
    """Update the row only if its last goal day is still the one read; False when another award moved it."""
    query = supabase.table("user_progress").update(values).eq("user_id", progress["user_id"])
    last = progress.get("last_goal_day")
    query = query.eq("last_goal_day", last) if last else query.is_("last_goal_day", "null")
    return bool(query.execute().data)


def award_focus_xp(session: dict) -> dict | None:
    """Credit a scored focus session's points as XP. None when it earned nothing (not scored, or 0 points: a
    failed quiz, F12); otherwise what happened, with awarded False when it had already been credited."""
    amount = int(session.get("points_total") or 0)
    if session.get("status") != "scored" or amount <= 0:
        return None
    user_id, source_id = session["user_id"], str(session["id"])
    progress = load_progress(user_id)
    earned_at = session.get("ended_at") or session.get("updated_at")
    day = streaks.local_day(earned_at, progress.get("timezone")).isoformat()
    result = {"awarded": False, "amount": amount, "day": day}
    if _already_awarded("focus", source_id):
        return {**result, "total_xp": int(progress.get("total_xp") or 0)}
    try:
        _insert_event({"user_id": user_id, "source": "focus", "source_id": source_id, "amount": amount,
                       "earned_at": earned_at, "local_day": day})
    except Exception as error:
        if not _is_duplicate(error):
            raise
        return {**result, "total_xp": int(progress.get("total_xp") or 0)}

    day_xp = _amounts(user_id, day)
    for _ in range(RETRIES):
        goal = int(progress.get("daily_goal") or policy.DAILY_GOAL_XP)
        met = streaks.goal_met(day_xp, goal)
        before = _stored(progress)
        after = streaks.on_goal_day(before, date.fromisoformat(day)) if met else before
        total = max(0, _amounts(user_id))
        values = {"total_xp": total, "streak_days": after.days, "streak_freezes": after.freezes,
                  "last_goal_day": after.last_goal_day.isoformat() if after.last_goal_day else None,
                  "updated_at": datetime.now(UTC).isoformat()}
        if _write(progress, values):
            return {**result, "awarded": True, "day_xp": day_xp, "goal": goal, "goal_met": met, "total_xp": total,
                    "streak_days": after.days, "streak_freezes": after.freezes}
        progress = load_progress(user_id)
    log.warning("XP for focus session %s is in the ledger; its progress write lost %d races", source_id, RETRIES)
    return {**result, "awarded": True, "day_xp": day_xp, "total_xp": int(progress.get("total_xp") or 0)}
