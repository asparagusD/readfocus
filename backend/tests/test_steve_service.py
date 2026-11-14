"""backend/steve/service.py (C20.2): cache, per-reader daily limit, own-key bypass and the 429 circuit breaker
around the provider. The provider is faked; the quota's database function is faked."""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from backend.steve import breaker, cache, policy, provider, quota, service
from backend.steve.errors import SteveUnavailable

OWN_KEY = "AIzaReaderKey-not-real-11111111111111111"
NOW = datetime(2026, 11, 14, 18, 30, tzinfo=UTC)


class FakeRpc:
    """steve_take_quota / steve_refund_quota on a dict, as migration 024 defines them."""

    def __init__(self):
        self.usage, self.calls = {}, []

    def rpc(self, name, params):
        self.calls.append((name, params))
        key = (params["p_user"], params["p_day"])
        if name == "steve_take_quota":
            count = self.usage.get(key, 0)
            data = -1 if count >= params["p_limit"] else count + 1
            if data > 0:
                self.usage[key] = data
        else:
            self.usage[key] = max(0, self.usage.get(key, 0) - 1)
            data = None
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))


class FakeProvider:
    def __init__(self):
        self.calls, self.error = [], None

    async def generate(self, parts, *, model="chat", api_key=None, stream=False, system=None):
        self.calls.append({"parts": parts, "model": model, "api_key": api_key, "stream": stream})
        if self.error:
            raise self.error
        for i, text in enumerate(["Steve ", "answers."]):
            yield provider.Piece(text=text, done=i == 1, model="gemini-test-chat",
                                 tokens_in=10 if i else None, tokens_out=4 if i else None)


@pytest.fixture
def env(monkeypatch):
    rpc, fake = FakeRpc(), FakeProvider()
    monkeypatch.setattr(quota, "supabase", rpc)
    monkeypatch.setattr(provider, "generate", fake.generate)
    monkeypatch.setattr(provider, "model_name", lambda role: f"gemini-test-{role}")
    monkeypatch.setenv("STEVE_DAILY_LIMIT_PER_USER", "2")
    monkeypatch.setattr(service, "now", lambda: NOW)
    breaker.breaker.reset()
    cache.cache.clear()
    yield SimpleNamespace(rpc=rpc, provider=fake)
    breaker.breaker.reset()
    cache.cache.clear()


def ask(user="user-1", book="book-1", question="Who is the ferryman?", context_hash="ctx-1", api_key=None,
        stream=False, offset=0):
    async def run():
        return [piece async for piece in service.ask(
            user_id=user, book_id=book, question=question, context_hash=context_hash, parts=["passage", question],
            api_key=api_key, stream=stream, utc_offset_minutes=offset)]
    return asyncio.run(run())


def text(pieces):
    return "".join(p.text for p in pieces)


def test_a_question_is_answered_and_counted_once(env):
    assert text(ask()) == "Steve answers."
    assert env.rpc.usage == {("user-1", "2026-11-14"): 1}
    assert len(env.provider.calls) == 1


def test_streaming_passes_each_piece_through(env):
    pieces = ask(stream=True)
    assert [p.text for p in pieces] == ["Steve ", "answers."] and pieces[-1].done
    assert env.provider.calls[0]["stream"] is True


def test_a_repeated_question_is_a_cache_hit_with_no_call_and_no_count(env):
    ask(question="Who is  the Ferryman?")
    (hit,) = ask(question="who is the ferryman?")  # normalised: case and spaces
    assert hit.text == "Steve answers." and hit.cached and hit.done
    assert len(env.provider.calls) == 1 and env.rpc.usage[("user-1", "2026-11-14")] == 1


def test_the_cache_key_covers_book_context_and_model(env, monkeypatch):
    monkeypatch.setenv("STEVE_DAILY_LIMIT_PER_USER", "5")
    ask()
    ask(book="book-2")
    ask(context_hash="ctx-2")
    assert len(env.provider.calls) == 3
    keys = {cache.key("b", "q", "c", "m1"), cache.key("b", "q", "c", "m2"), cache.key("b", "q", "c2", "m1")}
    assert len(keys) == 3 and all(len(k) == 64 for k in keys)


def test_a_cached_answer_expires_after_the_ttl(env):
    store = cache.AnswerCache(ttl_seconds=60, max_entries=10)
    store.put("k", "v", now=NOW)
    assert store.get("k", now=NOW + timedelta(seconds=59)) == "v"
    assert store.get("k", now=NOW + timedelta(seconds=61)) is None
    assert policy.CACHE_TTL_SECONDS == 7 * 24 * 3600


def test_the_cache_drops_the_oldest_entry_when_full(env):
    store = cache.AnswerCache(ttl_seconds=60, max_entries=2)
    for k in ("a", "b", "c"):
        store.put(k, k, now=NOW)
    assert store.get("a", now=NOW) is None and store.get("c", now=NOW) == "c"


def test_the_daily_limit_is_per_local_day(env):
    ask(question="one")
    ask(question="two")
    with pytest.raises(SteveUnavailable) as caught:
        ask(question="three")
    assert caught.value.reason == "daily_limit"
    assert caught.value.until == datetime(2026, 11, 15, 0, 0, tzinfo=UTC)
    assert len(env.provider.calls) == 2
    assert text(ask(question="three", offset=360)) == "Steve answers."  # UTC+6: already the 15th
    assert env.rpc.usage[("user-1", "2026-11-15")] == 1


def test_readers_have_their_own_limits(env):
    ask(question="one")
    ask(question="two")
    assert text(ask(user="user-2", question="three")) == "Steve answers."


def test_a_readers_own_key_skips_our_limit_and_is_never_counted(env):
    ask(question="one")
    ask(question="two")
    assert text(ask(question="three", api_key=OWN_KEY)) == "Steve answers."
    assert env.provider.calls[-1]["api_key"] == OWN_KEY
    assert env.rpc.usage[("user-1", "2026-11-14")] == 2


def test_a_429_on_our_key_opens_the_breaker_for_every_reader(env):
    env.provider.error = SteveUnavailable("paused_quota", retry_after=37)
    with pytest.raises(SteveUnavailable) as first:
        ask()
    assert first.value.reason == "paused_quota"
    env.provider.error = None
    with pytest.raises(SteveUnavailable) as second:
        ask(user="user-2", question="another")
    assert second.value.reason == "paused_quota"
    assert second.value.until == NOW + timedelta(minutes=policy.BREAKER_COOLDOWN_MINUTES)  # at least N minutes
    assert len(env.provider.calls) == 1  # the second reader made no call
    assert env.rpc.usage[("user-1", "2026-11-14")] == 0  # the failed question was refunded
    assert ("user-2", "2026-11-14") not in env.rpc.usage  # and the paused one never counted


def test_the_breaker_honours_a_longer_retry_delay_and_closes_after_it(env, monkeypatch):
    env.provider.error = SteveUnavailable("paused_quota", retry_after=3600)
    with pytest.raises(SteveUnavailable):
        ask()
    assert breaker.breaker.open_until("ours") == NOW + timedelta(seconds=3600)
    env.provider.error = None
    monkeypatch.setattr(service, "now", lambda: NOW + timedelta(seconds=3601))
    assert text(ask()) == "Steve answers."


def test_an_own_key_429_pauses_only_that_key(env):
    env.provider.error = SteveUnavailable("paused_quota", retry_after=60)
    with pytest.raises(SteveUnavailable):
        ask(api_key=OWN_KEY)
    env.provider.error = None
    assert text(ask(question="ours still works")) == "Steve answers."
    with pytest.raises(SteveUnavailable) as caught:
        ask(api_key=OWN_KEY, question="again")
    assert caught.value.reason == "paused_quota"


def test_an_own_key_is_not_paused_by_our_breaker(env):
    env.provider.error = SteveUnavailable("paused_quota", retry_after=60)
    with pytest.raises(SteveUnavailable):
        ask()
    env.provider.error = None
    assert text(ask(api_key=OWN_KEY)) == "Steve answers."


def test_a_timeout_is_refunded_and_does_not_open_the_breaker(env):
    env.provider.error = SteveUnavailable("timeout")
    with pytest.raises(SteveUnavailable) as caught:
        ask()
    assert caught.value.reason == "timeout"
    assert env.rpc.usage[("user-1", "2026-11-14")] == 0
    assert breaker.breaker.open_until("ours") is None


def test_a_failed_answer_is_not_cached(env):
    env.provider.error = SteveUnavailable("unavailable")
    with pytest.raises(SteveUnavailable):
        ask()
    env.provider.error = None
    ask()
    assert len(env.provider.calls) == 2


@pytest.mark.parametrize("raw, limit", [(None, policy.DAILY_LIMIT_DEFAULT), ("7", 7), ("-3", 0), ("lots", policy.DAILY_LIMIT_DEFAULT)])
def test_the_daily_limit_comes_from_the_environment(monkeypatch, raw, limit):
    if raw is None:
        monkeypatch.delenv("STEVE_DAILY_LIMIT_PER_USER", raising=False)
    else:
        monkeypatch.setenv("STEVE_DAILY_LIMIT_PER_USER", raw)
    assert quota.daily_limit() == limit


@pytest.mark.parametrize("offset", [-841, 841, 10**6])
def test_an_impossible_utc_offset_counts_as_utc(offset):
    assert quota.local_day(NOW, offset) == quota.local_day(NOW, 0)
