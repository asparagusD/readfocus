"""Focus mode's numbers, by the names the scoring engine uses (C23.3).

The values live in backend/agents/policy.py, the one policy file every agent and score reads, and equal
docs/FOCUS_RULES.md's Defaults table (backend/tests/test_focus_policy.py checks it). Nothing is set here.
"""

from backend.agents import policy as _p

POINTS_PER_MINUTE = _p.FOCUS_POINTS_PER_MINUTE  # F4
BONUS_PER_CORRECT = _p.QUIZ_POINTS_PER_CORRECT  # F11
PASS_SCORE = _p.QUIZ_PASS_SCORE  # F12
HEARTBEAT_S = _p.FOCUS_HEARTBEAT_S  # F3
MAX_GAP_S = _p.FOCUS_MAX_GAP_S  # F3
MIN_HEARTBEAT_GAP_S = _p.FOCUS_MIN_HEARTBEAT_GAP_S  # F3
IDLE_PROMPT_S = _p.FOCUS_IDLE_PROMPT_MIN * 60  # F6
IDLE_ANSWER_S = _p.FOCUS_IDLE_ANSWER_S  # F6
PAGE_CAP_S = _p.FOCUS_PAGE_CAP_MIN * 60  # F7
SESSION_CAP_S = _p.FOCUS_SESSION_CAP_MIN * 60  # F8
HEARTBEAT_RATE_S = _p.FOCUS_HEARTBEAT_RATE_S  # F3
EVENT_RATE_S = _p.FOCUS_EVENT_RATE_S  # F3
ABANDON_AFTER_S = _p.FOCUS_ABANDON_AFTER_MIN * 60  # F1
OPEN_STATUSES = _p.FOCUS_OPEN_STATUSES
QUIZ_MAX_QUESTIONS = _p.QUIZ_MAX_QUESTIONS  # F10
EVENT_KINDS = _p.FOCUS_EVENT_KINDS
RULES_VERSION = _p.FOCUS_RULES_VERSION
