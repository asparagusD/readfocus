"""The circuit breaker (docs/STEVE.md S6): after a 429, no call on that key until the cool-down ends.

Our key ('ours') is shared, so its breaker pauses every reader; a reader's own key has its own breaker
(provider.key_id). State is in process memory: Render Free runs one instance, a restart closes it, and
Google's next 429 opens it again.
"""

from datetime import datetime, timedelta

from backend.steve import policy
from backend.steve.errors import SteveUnavailable


class Breaker:
    def __init__(self):
        self._until: dict[str, datetime] = {}

    def open_until(self, key_id: str) -> datetime | None:
        return self._until.get(key_id)

    def check(self, key_id: str, now: datetime) -> None:
        until = self._until.get(key_id)
        if until is None:
            return
        if now >= until:
            del self._until[key_id]
            return
        raise SteveUnavailable("paused_quota", until=until)

    def open(self, key_id: str, retry_after: int | None, now: datetime) -> datetime:
        seconds = max(retry_after or 0, policy.BREAKER_COOLDOWN_MINUTES * 60)
        until = now + timedelta(seconds=min(seconds, policy.BREAKER_MAX_MINUTES * 60))
        self._until[key_id] = max(until, self._until.get(key_id, until))
        return self._until[key_id]

    def reset(self) -> None:
        self._until.clear()


breaker = Breaker()
