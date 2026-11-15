"""The focus defaults in backend/agents/policy.py match docs/FOCUS_RULES.md, its single source of truth (C23.2)."""

import re
from pathlib import Path

from backend.agents import policy

RULES = Path(__file__).resolve().parents[2] / "docs" / "FOCUS_RULES.md"


def documented_defaults() -> dict[str, str]:
    """{name: default} from the Defaults table; a row naming two constants gives two."""
    table = RULES.read_text(encoding="utf-8").split("## Defaults", 1)[1].split("## Rules", 1)[0]
    found = {}
    for names, default in re.findall(r"^\| (`[^|]+`) \| ([^|]+) \|", table, re.MULTILINE):
        keys = re.findall(r"`(\w+)`", names)
        values = [v.strip() for v in default.split(",")]
        found.update(zip(keys, values if len(values) == len(keys) else values * len(keys)))
    return found


def test_every_documented_default_is_in_policy_with_the_same_value():
    defaults = documented_defaults()
    assert len(defaults) == 11
    for name, value in defaults.items():
        assert float(getattr(policy, name)) == float(value), name


def test_statuses_and_event_kinds():
    assert policy.FOCUS_STATUSES == ("active", "paused", "awaiting_quiz", "scored", "abandoned")
    assert policy.FOCUS_OPEN_STATUSES == ("active", "paused")
    assert policy.FOCUS_EVENT_KINDS == ("start", "heartbeat", "page_turn", "hidden", "visible", "idle_prompt",
                                        "idle_confirm", "pause", "resume", "end")
    assert set(policy.FOCUS_OPEN_STATUSES) <= set(policy.FOCUS_STATUSES)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", policy.FOCUS_RULES_VERSION)
