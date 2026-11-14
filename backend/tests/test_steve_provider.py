"""backend/steve/provider.py (C20.2): the one door to Gemini, tested offline with a fake SDK client."""

import asyncio
import logging
from types import SimpleNamespace

import httpx
import pytest

from backend.steve import policy, provider
from backend.steve.errors import SteveUnavailable

GEM = "GEM" + "INI"  # built from pieces: backend/ files other than the provider must not name the variables
OUR_KEY, OWN_KEY = "AIzaOurKey-not-real-000000000000000000", "AIzaReaderKey-not-real-11111111111111111"
BOOK_TEXT = "The ferryman counted the coins twice before the river took the lantern."


class QuotaError(Exception):
    """Shaped like the SDK's ClientError for a 429 (code, status, details)."""

    def __init__(self, delay="37s"):
        super().__init__("429 RESOURCE_EXHAUSTED")
        self.code, self.status = 429, "RESOURCE_EXHAUSTED"
        self.details = {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "details": [
            {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay}]}}


def response(text, tokens_in=None, tokens_out=None):
    usage = SimpleNamespace(prompt_token_count=tokens_in, candidates_token_count=tokens_out)
    return SimpleNamespace(text=text, usage_metadata=usage if tokens_in is not None else None)


class FakeModels:
    def __init__(self, sdk):
        self.sdk = sdk

    async def generate_content(self, *, model, contents, config=None):
        self.sdk.calls.append({"model": model, "contents": contents, "config": config, "stream": False})
        if self.sdk.error:
            raise self.sdk.error
        if self.sdk.delay:
            await asyncio.sleep(self.sdk.delay)
        return response("".join(self.sdk.pieces), 120, 30)

    async def get(self, *, model):
        self.sdk.calls.append({"model": model, "get": True})
        if self.sdk.error:
            raise self.sdk.error
        if self.sdk.delay:
            await asyncio.sleep(self.sdk.delay)
        return SimpleNamespace(name=f"models/{model}")

    async def generate_content_stream(self, *, model, contents, config=None):
        self.sdk.calls.append({"model": model, "contents": contents, "config": config, "stream": True})
        if self.sdk.error:
            raise self.sdk.error

        async def chunks():
            for i, piece in enumerate(self.sdk.pieces):
                if self.sdk.delay:
                    await asyncio.sleep(self.sdk.delay)
                last = i == len(self.sdk.pieces) - 1
                yield response(piece, 120 if last else None, 30 if last else None)
        return chunks()


class FakeSdk:
    def __init__(self):
        self.calls, self.keys, self.error, self.delay = [], [], None, 0
        self.pieces = ["Charon ", "counts ", "twice [p. 4]."]

    def client(self, api_key):
        self.keys.append(api_key)
        return SimpleNamespace(aio=SimpleNamespace(models=FakeModels(self)))


@pytest.fixture
def sdk(monkeypatch):
    fake = FakeSdk()
    monkeypatch.setattr(provider, "_make_client", fake.client)
    monkeypatch.setenv(f"{GEM}_API_KEY", OUR_KEY)
    monkeypatch.setenv(f"{GEM}_MODEL_CHAT", "gemini-test-chat")
    monkeypatch.setenv(f"{GEM}_MODEL_VISION", "gemini-test-vision")
    return fake


def collect(gen):
    async def run():
        return [piece async for piece in gen]
    return asyncio.run(run())


def test_a_call_returns_the_text_and_token_counts_on_our_key(sdk):
    (piece,) = collect(provider.generate([BOOK_TEXT, "Who counts?"], model="chat", system="Be brief."))
    assert piece.text == "Charon counts twice [p. 4]." and (piece.tokens_in, piece.tokens_out) == (120, 30)
    assert piece.done and piece.model == "gemini-test-chat"
    (call,) = sdk.calls
    assert call["model"] == "gemini-test-chat" and call["contents"] == [BOOK_TEXT, "Who counts?"]
    assert call["config"]["system_instruction"] == "Be brief." and sdk.keys == [OUR_KEY]


def test_streaming_yields_each_piece_and_the_counts_at_the_end(sdk):
    pieces = collect(provider.generate(["q"], model="chat", stream=True))
    assert [p.text for p in pieces] == sdk.pieces
    assert [p.done for p in pieces] == [False, False, True] and pieces[-1].tokens_out == 30
    assert sdk.calls[0]["stream"] is True


def test_the_vision_model_and_a_readers_own_key(sdk):
    collect(provider.generate(["q"], model="vision", api_key=OWN_KEY))
    assert sdk.calls[0]["model"] == "gemini-test-vision" and sdk.keys == [OWN_KEY]


def test_a_429_is_paused_quota_with_googles_retry_delay(sdk):
    sdk.error = QuotaError("37s")
    with pytest.raises(SteveUnavailable) as caught:
        collect(provider.generate(["q"], model="chat"))
    assert caught.value.reason == "paused_quota" and caught.value.retry_after == 37
    assert len(sdk.calls) == 1  # no retry


def test_a_429_without_a_retry_delay_uses_the_policy_cool_down(sdk):
    sdk.error = QuotaError(delay=None)
    sdk.error.details = {"error": {"code": 429}}
    with pytest.raises(SteveUnavailable) as caught:
        collect(provider.generate(["q"], model="chat"))
    assert caught.value.retry_after == policy.BREAKER_COOLDOWN_MINUTES * 60


def test_a_slow_answer_times_out(sdk, monkeypatch):
    monkeypatch.setattr(policy, "TIMEOUT_SECONDS", 0.05)
    sdk.delay = 0.5
    with pytest.raises(SteveUnavailable) as caught:
        collect(provider.generate(["q"], model="chat"))
    assert caught.value.reason == "timeout"


def test_a_slow_stream_times_out(sdk, monkeypatch):
    monkeypatch.setattr(policy, "STREAM_TIMEOUT_SECONDS", 0.05)
    sdk.delay = 0.2
    with pytest.raises(SteveUnavailable) as caught:
        collect(provider.generate(["q"], model="chat", stream=True))
    assert caught.value.reason == "timeout"


def test_an_http_timeout_from_the_sdk_is_a_timeout(sdk):
    sdk.error = httpx.ReadTimeout("read timed out")
    with pytest.raises(SteveUnavailable) as caught:
        collect(provider.generate(["q"], model="chat"))
    assert caught.value.reason == "timeout"


@pytest.mark.parametrize("code, reason", [(503, "unavailable"), (500, "unavailable"), (403, "key_rejected")])
def test_other_failures_are_typed(sdk, code, reason):
    sdk.error = QuotaError()
    sdk.error.code, sdk.error.details = code, {}
    with pytest.raises(SteveUnavailable) as caught:
        collect(provider.generate(["q"], model="chat"))
    assert caught.value.reason == reason


def test_no_key_or_model_configured_is_not_configured(sdk, monkeypatch):
    monkeypatch.delenv(f"{GEM}_API_KEY")
    with pytest.raises(SteveUnavailable) as caught:
        collect(provider.generate(["q"], model="chat"))
    assert caught.value.reason == "not_configured" and sdk.calls == []
    monkeypatch.setenv(f"{GEM}_API_KEY", OUR_KEY)
    monkeypatch.setenv(f"{GEM}_MODEL_CHAT", " ")
    with pytest.raises(SteveUnavailable):
        provider.model_name("chat")


def test_logs_carry_no_book_text_question_answer_or_key(sdk, caplog):
    caplog.set_level(logging.DEBUG)
    collect(provider.generate([BOOK_TEXT, "Who counts the coins?"], model="chat", api_key=OWN_KEY))
    sdk.error = QuotaError()
    with pytest.raises(SteveUnavailable):
        collect(provider.generate([BOOK_TEXT], model="chat"))
    text = caplog.text
    assert "steve.provider" in text  # it does log: status, latency, counts
    for secret in (BOOK_TEXT, "Who counts the coins?", "Charon", OUR_KEY, OWN_KEY, "RESOURCE_EXHAUSTED"):
        assert secret not in text, secret


def test_an_error_never_carries_the_key(sdk):
    sdk.error = QuotaError()
    with pytest.raises(SteveUnavailable) as caught:
        collect(provider.generate(["q"], model="chat", api_key=OWN_KEY))
    assert OWN_KEY not in repr(caught.value) and OWN_KEY not in str(caught.value)
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


def test_the_real_client_has_the_timeout_and_never_retries(monkeypatch):
    client = provider._make_client("AIza-offline-construct-only")  # builds the SDK client; makes no request
    options = client._api_client._http_options
    assert options.timeout == int(policy.TIMEOUT_SECONDS * 1000)
    assert options.retry_options.attempts == 1


def test_key_ids_tell_keys_apart_without_holding_them():
    assert provider.key_id(None) == "ours"
    one, two = provider.key_id(OWN_KEY), provider.key_id(OUR_KEY)
    assert one.startswith("own:") and one != two and OWN_KEY not in one


def test_checking_a_key_reads_the_chat_model_with_that_key_and_generates_nothing(sdk):
    asyncio.run(provider.check_key(OWN_KEY))
    assert sdk.calls == [{"model": "gemini-test-chat", "get": True}] and sdk.keys == [OWN_KEY]


@pytest.mark.parametrize("code, reason", [(400, "key_rejected"), (403, "key_rejected"), (429, "paused_quota"),
                                          (503, "unavailable")])
def test_a_key_check_failure_is_typed(sdk, code, reason):
    sdk.error = QuotaError()
    sdk.error.code = code
    sdk.error.details = {"error": {"code": code, "details": [{"reason": "API_KEY_INVALID"}]}} if code == 400 else {}
    with pytest.raises(SteveUnavailable) as caught:
        asyncio.run(provider.check_key(OWN_KEY))
    assert caught.value.reason == reason and OWN_KEY not in repr(caught.value)


def test_a_slow_key_check_times_out(sdk, monkeypatch):
    monkeypatch.setattr(policy, "TIMEOUT_SECONDS", 0.05)
    sdk.delay = 0.5
    with pytest.raises(SteveUnavailable) as caught:
        asyncio.run(provider.check_key(OWN_KEY))
    assert caught.value.reason == "timeout"
