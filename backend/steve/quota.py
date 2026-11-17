"""The per-reader daily limit on our key (docs/STEVE.md S6): STEVE_DAILY_LIMIT_PER_USER questions per local day.

Counted in steve_usage by one atomic database call (migration 024), so two tabs cannot both take the last
question; refunded when Google fails. The day is the reader's own: the browser sends its UTC offset in minutes,
so "back at midnight, your time" is true (an impossible offset counts as UTC). Readers' own keys never come here.
"""

import logging
import os
from datetime import UTC, date, datetime, timedelta

from backend.services.supabase_client import supabase
from backend.steve import policy
from backend.steve.errors import SteveUnavailable

logger = logging.getLogger("steve.quota")
LIMIT_ENV = "STEVE_DAILY_LIMIT_PER_USER"


def daily_limit() -> int:
    raw = os.environ.get(LIMIT_ENV, "").strip()
    if not raw:
        return policy.DAILY_LIMIT_DEFAULT
    try:
        return max(0, int(raw))
    except ValueError:
        logger.warning("%s is not a whole number; using %d", LIMIT_ENV, policy.DAILY_LIMIT_DEFAULT)
        return policy.DAILY_LIMIT_DEFAULT


def _offset(utc_offset_minutes: int) -> timedelta:
    ok = abs(utc_offset_minutes) <= policy.UTC_OFFSET_LIMIT_MINUTES
    return timedelta(minutes=utc_offset_minutes if ok else 0)


def local_day(now: datetime, utc_offset_minutes: int) -> date:
    return (now + _offset(utc_offset_minutes)).date()


def next_midnight(now: datetime, utc_offset_minutes: int) -> datetime:
    """The reader's next local midnight, in UTC."""
    tomorrow = local_day(now, utc_offset_minutes) + timedelta(days=1)
    return datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=UTC) - _offset(utc_offset_minutes)


def take(user_id: str, now: datetime, utc_offset_minutes: int = 0) -> date:
    """Count one question for the reader's day and return that day, or raise daily_limit (until their midnight)."""
    day = local_day(now, utc_offset_minutes)
    params = {"p_user": user_id, "p_day": day.isoformat(), "p_limit": daily_limit()}
    count = supabase.rpc("steve_take_quota", params).execute().data
    if not isinstance(count, int) or count < 1:
        raise SteveUnavailable("daily_limit", until=next_midnight(now, utc_offset_minutes))
    return day


def refund(user_id: str, day: date) -> None:
    supabase.rpc("steve_refund_quota", {"p_user": user_id, "p_day": day.isoformat()}).execute()
