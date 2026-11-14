"""The answer cache (docs/STEVE.md S6): a repeated question on the same book, context and model costs no call.

Keyed by sha256 of (book id, normalised question, context hash, model); kept 7 days in process memory, at most
CACHE_MAX_ENTRIES answers, the oldest dropped first. A book belongs to one reader, so answers never cross readers.
A restart empties it.
"""

import hashlib
import json
from collections import OrderedDict
from datetime import datetime, timedelta

from backend.steve import policy


def normalise(question: str) -> str:
    return " ".join(question.casefold().split())


def key(book_id: str, question: str, context_hash: str, model: str) -> str:
    raw = json.dumps([book_id, normalise(question), context_hash, model], ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class AnswerCache:
    def __init__(self, ttl_seconds: int = policy.CACHE_TTL_SECONDS, max_entries: int = policy.CACHE_MAX_ENTRIES):
        self.ttl, self.max_entries = timedelta(seconds=ttl_seconds), max_entries
        self._entries: OrderedDict[str, tuple[datetime, str]] = OrderedDict()

    def get(self, cache_key: str, now: datetime) -> str | None:
        entry = self._entries.get(cache_key)
        if entry is None:
            return None
        stored, answer = entry
        if now - stored > self.ttl:
            del self._entries[cache_key]
            return None
        return answer

    def put(self, cache_key: str, answer: str, now: datetime) -> None:
        self._entries[cache_key] = (now, answer)
        self._entries.move_to_end(cache_key)
        while len(self._entries) > self.max_entries:
            self._entries.popitem(last=False)

    def clear(self) -> None:
        self._entries.clear()


cache = AnswerCache()
