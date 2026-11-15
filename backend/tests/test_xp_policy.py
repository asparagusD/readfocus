"""The daily-goal and streak defaults in backend/agents/policy.py match docs/GAMIFICATION.md, their single source of
truth (C24.1)."""

import re
from pathlib import Path

from backend.agents import policy

RULES = Path(__file__).resolve().parents[2] / "docs" / "GAMIFICATION.md"
NAMES = ("DAILY_GOAL_XP", "DAILY_GOAL_MIN_XP", "DAILY_GOAL_MAX_XP", "STREAK_FREEZE_MAX", "STREAK_FREEZE_EVERY_DAYS")


def documented(name: str) -> int:
    """`NAME` = 50, or `NAME` 10 (as G5 writes the bounds)."""
    found = re.search(rf"`{name}`\s*=?\s*(\d+)", RULES.read_text(encoding="utf-8"))
    assert found, name
    return int(found.group(1))


def test_each_default_equals_the_documented_value():
    for name in NAMES:
        assert getattr(policy, name) == documented(name), name


def test_the_goal_default_lies_within_its_bounds_and_the_sources_are_the_ledgers():
    assert policy.DAILY_GOAL_MIN_XP <= policy.DAILY_GOAL_XP <= policy.DAILY_GOAL_MAX_XP
    assert policy.XP_SOURCES == ("focus", "badge", "adjustment")
    assert policy.STREAK_FREEZE_MAX == 2 and policy.STREAK_FREEZE_EVERY_DAYS == 7


def test_the_technical_book_share_is_the_documented_percentage():
    assert round(policy.TECH_BOOK_SHARE * 100) == documented("TECH_BOOK_SHARE")
