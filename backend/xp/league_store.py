"""The weekly league rollover against the database (C24.3b, docs/GAMIFICATION.md G11-G14); the rules are in
leagues.py. roll_over(now) does, in order, whatever is still undone:

1. close every open week that has ended, oldest first: each member's weekly XP and the moment they reached it
   come from the XP ledger (earned_at inside the week, every source), each group is ranked and every member's
   rank and outcome written, then the week is marked closed. The values depend only on the ledger, so a second
   run writes the same ones and finds the week closed.
2. make sure the current week exists (starts_at is unique: a racing run's insert is refused and re-read).
3. form its groups once: the run that sets grouped_at (only while it is null) groups the readers with XP in the
   LEAGUE_ACTIVE_DAYS before the week, each at their last membership's tier moved by its outcome (Pamphlet when
   new), in the order of their first XP. Weeks missed while nothing ran are not created; tiers carry across them.

Opted-out readers are grouped like anyone (G14 as changed in C24.3); boards hide them."""

from datetime import UTC, datetime, timedelta

from backend.agents import policy
from backend.services.supabase_client import supabase
from backend.xp import leagues
from backend.xp.award import is_duplicate

PAGE = 1000  # PostgREST returns at most this many rows per request


def _all(build) -> list[dict]:
    """Every row of a query, page by page; `build` makes a fresh query each time."""
    rows, start = [], 0
    while True:
        page = build().range(start, start + PAGE - 1).execute().data
        rows += page
        if len(page) < PAGE:
            return rows
        start += PAGE


def _when(value: str | datetime) -> datetime:
    return datetime.fromisoformat(value) if isinstance(value, str) else value


def _ledger(since: datetime, until: datetime, user_ids: list[str] | None = None) -> list[dict]:
    def build():
        query = supabase.table("xp_events").select("user_id, amount, earned_at").gte(
            "earned_at", since.isoformat()).lt("earned_at", until.isoformat())
        return (query.in_("user_id", user_ids) if user_ids is not None else query).order("earned_at")
    return _all(build)


def _close(week: dict, now: datetime) -> None:
    rows = _all(lambda: supabase.table("league_members").select("*").eq("week_id", week["id"]).order("user_id"))
    totals: dict[str, int] = {}
    reached: dict[str, datetime] = {}
    if rows:
        for event in _ledger(_when(week["starts_at"]), _when(week["ends_at"]), [r["user_id"] for r in rows]):
            totals[event["user_id"]] = totals.get(event["user_id"], 0) + int(event["amount"])
            reached[event["user_id"]] = _when(event["earned_at"])  # ordered: the last is when the total was reached
    groups: dict[str, list[leagues.Member]] = {}
    for r in rows:
        member = leagues.Member(r["user_id"], r["tier"], _when(r["joined_at"]), max(0, totals.get(r["user_id"], 0)),
                                reached.get(r["user_id"]))
        groups.setdefault(r["group_id"], []).append(member)
    for members in groups.values():
        for result in leagues.outcomes(members):
            m = result.member
            supabase.table("league_members").update({
                "weekly_xp": m.weekly_xp, "xp_reached_at": m.xp_reached_at.isoformat() if m.xp_reached_at else None,
                "final_rank": result.rank, "outcome": result.outcome,
            }).eq("week_id", week["id"]).eq("user_id", m.user_id).execute()
    supabase.table("league_weeks").update({"status": "closed", "closed_at": now.isoformat()}).eq(
        "id", week["id"]).eq("status", "open").execute()


def _ensure_week(start: datetime) -> dict:
    found = supabase.table("league_weeks").select("*").eq("starts_at", start.isoformat()).execute().data
    if found:
        return found[0]
    row = {"starts_at": start.isoformat(), "ends_at": (start + timedelta(days=7)).isoformat(), "status": "open",
           "grouped_at": None, "closed_at": None}
    try:
        return supabase.table("league_weeks").insert(row).execute().data[0]
    except Exception as error:
        if not is_duplicate(error):
            raise
        return supabase.table("league_weeks").select("*").eq("starts_at", start.isoformat()).execute().data[0]


def _tiers(user_ids: list[str], before: datetime) -> dict[str, str]:
    """Each reader's tier for a week starting at `before`: their latest earlier membership moved by its outcome."""
    starts = {w["id"]: _when(w["starts_at"]) for w in _all(lambda: supabase.table("league_weeks").select(
        "id, starts_at").order("starts_at"))}
    latest: dict[str, dict] = {}
    for row in _all(lambda: supabase.table("league_members").select("user_id, week_id, tier, outcome").in_(
            "user_id", user_ids).order("week_id")):
        when = starts.get(row["week_id"])
        if when is None or when >= before:
            continue
        if row["user_id"] not in latest or when > starts[latest[row["user_id"]]["week_id"]]:
            latest[row["user_id"]] = row
    return {u: leagues.next_tier(latest[u]["tier"], latest[u]["outcome"]) if u in latest else leagues.TIERS[0]
            for u in user_ids}


def _form_groups(week: dict, now: datetime) -> int:
    if week.get("grouped_at"):
        return 0
    claimed = supabase.table("league_weeks").update({"grouped_at": now.isoformat()}).eq("id", week["id"]).is_(
        "grouped_at", "null").execute().data
    if not claimed:
        return 0  # another run is forming them
    start = _when(week["starts_at"])
    active = sorted({e["user_id"] for e in _ledger(start - timedelta(days=policy.LEAGUE_ACTIVE_DAYS), start)})
    if not active:
        return 0
    joined: dict[str, datetime] = {}
    for event in _ledger(datetime.min.replace(tzinfo=UTC), start, active):
        joined.setdefault(event["user_id"], _when(event["earned_at"]))  # ordered: the first is when they joined
    tiers = _tiers(active, start)
    readers = [leagues.Reader(u, tiers[u], joined[u]) for u in active]
    placed = 0
    for group in leagues.assign_groups(readers):
        made = supabase.table("league_groups").insert({"week_id": week["id"], "tier": group.tier}).execute().data
        gid = made[0]["id"]
        supabase.table("league_members").insert([
            {"week_id": week["id"], "group_id": gid, "user_id": r.user_id, "tier": r.tier,
             "joined_at": r.joined_at.isoformat(), "weekly_xp": 0, "xp_reached_at": None, "final_rank": None,
             "outcome": None} for r in group.readers]).execute()
        placed += len(group.readers)
    return placed


def _now() -> datetime:
    return datetime.now(UTC)


def roll_over(now: datetime | None = None) -> dict:
    """Close ended weeks, then form the current week's groups; safe to run any number of times, at any time."""
    now = now or _now()
    ended = _all(lambda: supabase.table("league_weeks").select("*").eq("status", "open").lte(
        "ends_at", now.isoformat()).order("starts_at"))
    for week in ended:
        _close(week, now)
    current = _ensure_week(leagues.week_start(now))
    return {"closed": [w["starts_at"] for w in ended], "week": current["starts_at"],
            "grouped": _form_groups(current, now)}
