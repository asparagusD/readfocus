"""The reader's progress, badges and league (C24.5, docs/GAMIFICATION.md): GET/PUT /me/progress, GET /badges,
GET /leagues/current. Everything comes from the server's own rows (G2); writes are only the reader's settings.

Privacy (G3, G14): no email and no other reader's user id is ever returned. A league row names a reader by a
pseudonym, the first 12 hex digits of sha256("<week id>:<user id>"), stable for the week and new each week (the week
id is never returned, so a user id alone does not give the pseudonym), and by their chosen display name, else
"Reader <first 4 of the pseudonym>"; the sign-in's name is never used. Readers who opted out are left off everyone
else's board; ranks keep their true numbers. GET /leagues/current first runs any rollover that is due, so a missed
schedule catches up on the next read (C24.4)."""

import hashlib
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from zoneinfo import available_timezones

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StrictBool, StrictInt

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase
from backend.xp import league_store, leagues, streaks
from backend.xp.badges import CATALOGUE, by_id
from backend.xp.names import clean_name

router = APIRouter()
DEFAULTS = {"total_xp": 0, "daily_goal": policy.DAILY_GOAL_XP, "timezone": "UTC", "streak_days": 0,
            "streak_freezes": 0, "last_goal_day": None, "display_name": None, "leaderboard_opt_out": False}


def _now() -> datetime:
    return datetime.now(UTC)


@lru_cache(maxsize=1)
def _zones() -> frozenset[str]:
    return frozenset(available_timezones())


def _progress(user_id: str) -> dict:
    rows = supabase.table("user_progress").select("*").eq("user_id", user_id).execute().data
    return {**DEFAULTS, **(rows[0] if rows else {})}


def current_streak(user_id: str) -> int:
    """The streak in days the header shows (G7, freezes, the reader's own day); the Dashboard shows the same (C32.4)."""
    prog = _progress(user_id)
    last = prog["last_goal_day"]
    stored = streaks.Streak(int(prog["streak_days"]), int(prog["streak_freezes"]),
                            datetime.fromisoformat(last).date() if last else None)
    return streaks.view(stored, streaks.local_day(_now(), prog["timezone"])).days


def _week(start: datetime) -> dict | None:
    rows = supabase.table("league_weeks").select("*").eq("starts_at", start.isoformat()).execute().data
    return rows[0] if rows else None


def _membership(week: dict | None, user_id: str) -> dict | None:
    if not week:
        return None
    rows = supabase.table("league_members").select("*").eq("week_id", week["id"]).eq("user_id", user_id).execute().data
    return rows[0] if rows else None


def _tier(user_id: str, start: datetime, mine: dict | None) -> str:
    return mine["tier"] if mine else league_store.tiers([user_id], start)[user_id]


def _view(user_id: str) -> dict:
    prog, now = _progress(user_id), _now()
    day = streaks.local_day(now, prog["timezone"])
    events = supabase.table("xp_events").select("amount").eq("user_id", user_id).eq("local_day", day.isoformat()).eq(
        "source", "focus").execute().data
    today_xp = sum(int(e["amount"]) for e in events)
    last = prog["last_goal_day"]
    current = streaks.view(streaks.Streak(int(prog["streak_days"]), int(prog["streak_freezes"]),
                                          datetime.fromisoformat(last).date() if last else None), day)
    start = leagues.week_start(now)
    held = supabase.table("user_badges").select("badge_id, awarded_at").eq("user_id", user_id).execute().data
    known = {b.id for b in CATALOGUE}
    return {
        "total_xp": int(prog["total_xp"]), "daily_goal": int(prog["daily_goal"]), "timezone": prog["timezone"],
        "display_name": prog["display_name"], "leaderboard_opt_out": bool(prog["leaderboard_opt_out"]),
        "today": {"day": day.isoformat(), "xp": today_xp, "goal": int(prog["daily_goal"]),
                  "met": streaks.goal_met(today_xp, int(prog["daily_goal"]))},
        "streak": {"days": current.days, "freezes": current.freezes,
                   "frozen_days": [d.isoformat() for d in current.frozen_days]},
        "tier": _tier(user_id, start, _membership(_week(start), user_id)),
        "badges": [{"id": b["badge_id"], "name": by_id(b["badge_id"]).name, "awarded_at": b["awarded_at"]}
                   for b in sorted(held, key=lambda b: (b["awarded_at"], b["badge_id"])) if b["badge_id"] in known],
    }


@router.get("/me/progress")
def get_progress(user_id: str = Depends(get_current_user)):
    return _view(user_id)


class ProgressChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daily_goal: StrictInt | None = None
    display_name: str | None = None
    leaderboard_opt_out: StrictBool | None = None
    timezone: str | None = None


@router.put("/me/progress")
def put_progress(req: ProgressChange, user_id: str = Depends(get_current_user)):
    change = {name: getattr(req, name) for name in req.model_fields_set}
    if not change:
        raise HTTPException(status_code=422, detail="Give daily_goal, display_name, leaderboard_opt_out or timezone.")
    if any(change[k] is None for k in change if k != "display_name"):
        raise HTTPException(status_code=422, detail="Only display_name can be cleared.")
    goal = change.get("daily_goal")
    if goal is not None and not policy.DAILY_GOAL_SET_MIN_XP <= goal <= policy.DAILY_GOAL_SET_MAX_XP:
        raise HTTPException(status_code=422, detail=f"The daily goal is {policy.DAILY_GOAL_SET_MIN_XP} to "
                                                    f"{policy.DAILY_GOAL_SET_MAX_XP} XP.")
    zone = change.get("timezone")
    if zone is not None and (len(zone) > policy.XP_TIMEZONE_MAX or zone not in _zones()):
        raise HTTPException(status_code=422, detail="That is not a known time zone.")
    if change.get("display_name") is not None:
        try:
            change["display_name"] = clean_name(change["display_name"])
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
    change["updated_at"] = _now().isoformat()
    if supabase.table("user_progress").select("user_id").eq("user_id", user_id).execute().data:
        supabase.table("user_progress").update(change).eq("user_id", user_id).execute()
    else:
        supabase.table("user_progress").insert({**DEFAULTS, **change, "user_id": user_id}).execute()
    return _view(user_id)


@router.get("/badges")
def get_badges(user_id: str = Depends(get_current_user)):
    held = {b["badge_id"]: b["awarded_at"] for b in
            supabase.table("user_badges").select("badge_id, awarded_at").eq("user_id", user_id).execute().data}
    badges = [{"id": b.id, "name": b.name, "description": b.description, "xp_reward": b.xp_reward, "kind": b.kind,
               "earned": b.id in held, "awarded_at": held.get(b.id)} for b in CATALOGUE]
    return {"total": len(badges), "earned": sum(b["earned"] for b in badges), "badges": badges}


def _pseudonym(week_id: str, user_id: str) -> str:
    return hashlib.sha256(f"{week_id}:{user_id}".encode()).hexdigest()[:12]


def _last_week(user_id: str) -> dict | None:
    """The reader's latest closed week (C24.6c): tier, rank among how many, XP, outcome and the tier it led to."""
    closed = [r for r in supabase.table("league_members").select("*").eq("user_id", user_id).execute().data
              if r.get("outcome")]
    if not closed:
        return None
    weeks = {w["id"]: w["starts_at"] for w in supabase.table("league_weeks").select("id, starts_at").in_(
        "id", [r["week_id"] for r in closed]).execute().data}
    row = max(closed, key=lambda r: datetime.fromisoformat(weeks[r["week_id"]]))
    size = len(supabase.table("league_members").select("user_id").eq("group_id", row["group_id"]).execute().data)
    return {"starts_at": weeks[row["week_id"]], "tier": row["tier"], "rank": row["final_rank"], "size": size,
            "weekly_xp": row["weekly_xp"], "outcome": row["outcome"], "now_in": leagues.next_tier(row["tier"], row["outcome"])}


@router.get("/leagues/current")
def current_league(user_id: str = Depends(get_current_user)):
    now = _now()
    if league_store.due(now):
        league_store.roll_over(now)
    start = leagues.week_start(now)
    week, prog = _week(start), _progress(user_id)
    mine = _membership(week, user_id)
    out = {"week": {"starts_at": start.isoformat(), "ends_at": (start + timedelta(days=7)).isoformat()},
           "tier": _tier(user_id, start, mine), "in_group": mine is not None,
           "opted_out": bool(prog["leaderboard_opt_out"]), "zones": None, "rows": [],
           "last_week": _last_week(user_id)}
    if not mine:
        return out
    rows = supabase.table("league_members").select("*").eq("group_id", mine["group_id"]).execute().data
    results = league_store.standings(rows, start, start + timedelta(days=7)).get(mine["group_id"], [])
    others = supabase.table("user_progress").select("user_id, display_name, leaderboard_opt_out").in_(
        "user_id", [r["user_id"] for r in rows]).execute().data
    names = {p["user_id"]: p.get("display_name") for p in others}
    hidden = {p["user_id"] for p in others if p.get("leaderboard_opt_out")}
    promote, demote = leagues.zones(len(results))
    out["zones"] = {"size": len(results), "promote": promote, "demote": demote}
    for result in leagues.board(results, user_id, hidden):
        alias = _pseudonym(week["id"], result.member.user_id)
        out["rows"].append({"id": alias, "rank": result.rank,
                            "display_name": names.get(result.member.user_id) or f"Reader {alias[:4]}",
                            "weekly_xp": result.member.weekly_xp,
                            "zone": {"promoted": "promotion", "demoted": "demotion"}.get(result.outcome),
                            "you": result.member.user_id == user_id})
    return out
