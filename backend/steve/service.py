"""ask(): one question to Steve, through the cache, the breaker and the daily limit, to the provider (C20.2).

Order: cache (a hit costs nothing), breaker (paused keys make no call), daily limit (our key only), then the
provider. A failed call is refunded and not cached; a 429 opens the breaker for that key. Consent, the off switch
and the context are the caller's (C20.4-C20.6).
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime

from backend.steve import provider, quota
from backend.steve.breaker import breaker
from backend.steve.cache import cache, key
from backend.steve.errors import SteveUnavailable


def now() -> datetime:
    return datetime.now(UTC)


async def ask(*, user_id: str, book_id: str, question: str, context_hash: str, parts: list,
              system: str | None = None, model: str = "chat", api_key: str | None = None, stream: bool = False,
              utc_offset_minutes: int = 0) -> AsyncIterator[provider.Piece]:
    """Yield Steve's answer as Pieces (one when cached or not streamed); raise SteveUnavailable."""
    model_name = provider.model_name(model)
    cache_key = key(book_id, question, context_hash, model_name)
    cached = cache.get(cache_key, now())
    if cached is not None:
        yield provider.Piece(text=cached, done=True, model=model_name, cached=True)
        return
    key_id = provider.key_id(api_key)
    breaker.check(key_id, now())
    day = quota.take(user_id, now(), utc_offset_minutes) if api_key is None else None
    answer = []
    try:
        async for piece in provider.generate(parts, model=model, api_key=api_key, stream=stream, system=system):
            answer.append(piece.text)
            yield piece
    except SteveUnavailable as unavailable:
        if unavailable.reason == "paused_quota":
            unavailable.until = breaker.open(key_id, unavailable.retry_after, now())
        if day is not None:
            quota.refund(user_id, day)
        raise
    cache.put(cache_key, "".join(answer), now())
