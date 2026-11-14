"""SteveUnavailable: why Steve cannot answer right now, typed so the panel can show the right paused state."""

from datetime import datetime

REASONS = frozenset({
    "paused_quota",    # Google said 429 (ours: every reader waits for the breaker; own key: that key only)
    "daily_limit",     # this reader's questions for today are used (our key only)
    "timeout",         # no answer in time
    "unavailable",     # Google failed otherwise (5xx, network)
    "key_rejected",    # Google refused the key (a reader's own key, or ours misconfigured)
    "not_configured",  # no key or model name set on the server
})


class SteveUnavailable(Exception):
    """Carries a reason from REASONS, when Steve is back (`until`, UTC) if known, and Google's retry delay."""

    def __init__(self, reason: str, until: datetime | None = None, retry_after: int | None = None):
        if reason not in REASONS:
            raise ValueError(f"unknown reason {reason!r}")
        super().__init__(reason)
        self.reason, self.until, self.retry_after = reason, until, retry_after

    def __repr__(self) -> str:
        return f"SteveUnavailable({self.reason!r}, until={self.until!r}, retry_after={self.retry_after!r})"
