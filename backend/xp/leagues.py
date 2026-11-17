"""Weekly leagues (C24.3, docs/GAMIFICATION.md G10-G14). Pure: no I/O, no clock.

A league week runs Monday 00:00 UTC to the next (G11). At its start the readers with XP in the LEAGUE_ACTIVE_DAYS
before it are grouped, within their tier, into groups of about LEAGUE_GROUP_SIZE in the order they joined (first
XP); sizes are even, so 31 readers make 16 + 15, and a small tier makes one small group: no reader is invented
(G1, G12). At its end each group is ranked by weekly XP, a tie going to who reached it first, then who joined
first. The top LEAGUE_PROMOTE x n / 30 (half up) with at least 1 XP move up a tier; in a group of
LEAGUE_DEMOTE_MIN_GROUP or more, the bottom LEAGUE_DEMOTE x n / 30 move down; nobody rises above Illuminated or
falls below Pamphlet (G13). An opted-out reader is ranked like anyone else and hidden from everyone else's board
(G14 as changed in C24.3), whose ranks keep their true numbers."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil, floor

from backend.agents import policy

TIERS = policy.LEAGUE_TIERS
FAR = datetime.max.replace(tzinfo=UTC)


@dataclass(frozen=True)
class Reader:
    user_id: str
    tier: str
    joined_at: datetime


@dataclass(frozen=True)
class Group:
    tier: str
    readers: list[Reader]


@dataclass(frozen=True)
class Member:
    user_id: str
    tier: str
    joined_at: datetime
    weekly_xp: int = 0
    xp_reached_at: datetime | None = None


@dataclass(frozen=True)
class Result:
    member: Member
    rank: int
    outcome: str


def week_start(moment: datetime) -> datetime:
    """The Monday 00:00 UTC on or before `moment`."""
    day = moment.astimezone(UTC).date()
    monday = day - timedelta(days=day.weekday())
    return datetime(monday.year, monday.month, monday.day, tzinfo=UTC)


def group_sizes(n: int) -> list[int]:
    """n readers in ceil(n / 30) groups whose sizes differ by at most one, the larger first."""
    if n <= 0:
        return []
    count = ceil(n / policy.LEAGUE_GROUP_SIZE)
    base, extra = divmod(n, count)
    return [base + 1 if i < extra else base for i in range(count)]


def assign_groups(readers: list[Reader]) -> list[Group]:
    """Each tier's readers in join order, cut into groups of group_sizes(); tiers lowest first."""
    unknown = {r.tier for r in readers} - set(TIERS)
    if unknown:
        raise ValueError(f"unknown tiers {sorted(unknown)}")
    groups = []
    for tier in TIERS:
        queue = sorted((r for r in readers if r.tier == tier), key=lambda r: (r.joined_at, r.user_id))
        for size in group_sizes(len(queue)):
            groups.append(Group(tier, queue[:size]))
            queue = queue[size:]
    return groups


def _half_up(x: float) -> int:
    return floor(x + 0.5)


def zones(n: int) -> tuple[int, int]:
    """How many of a group of n move up and down."""
    promote = min(policy.LEAGUE_PROMOTE, _half_up(n * policy.LEAGUE_PROMOTE / policy.LEAGUE_GROUP_SIZE))
    demote = 0
    if n >= policy.LEAGUE_DEMOTE_MIN_GROUP:
        demote = min(policy.LEAGUE_DEMOTE, _half_up(n * policy.LEAGUE_DEMOTE / policy.LEAGUE_GROUP_SIZE))
    return promote, demote


def standings(members: list[Member]) -> list[Member]:
    return sorted(members, key=lambda m: (-m.weekly_xp, m.xp_reached_at or FAR, m.joined_at, m.user_id))


def outcomes(members: list[Member]) -> list[Result]:
    """The group ranked, each with promoted, stayed or demoted."""
    ranked = standings(members)
    promote, demote = zones(len(ranked))
    out = []
    for i, m in enumerate(ranked):
        outcome = "stayed"
        if i < promote and m.weekly_xp >= 1 and m.tier != TIERS[-1]:
            outcome = "promoted"
        elif i >= len(ranked) - demote and m.tier != TIERS[0]:
            outcome = "demoted"
        out.append(Result(m, i + 1, outcome))
    return out


def next_tier(tier: str | None, outcome: str | None) -> str:
    """The tier after a week: a new reader starts in Pamphlet; a week not yet closed keeps the tier."""
    if tier is None:
        return TIERS[0]
    i = TIERS.index(tier)
    if outcome == "promoted":
        i = min(i + 1, len(TIERS) - 1)
    elif outcome == "demoted":
        i = max(i - 1, 0)
    return TIERS[i]


def board(results: list[Result], viewer_id: str, hidden: set[str]) -> list[Result]:
    """What the viewer sees of a group: everyone but the hidden (opted-out) readers, the viewer always."""
    return [r for r in results if r.member.user_id == viewer_id or r.member.user_id not in hidden]
