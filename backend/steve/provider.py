"""The one door to Gemini (CLAUDE.md constraint 1, steve-guardrails 1): the only module that imports Google's Gen
AI SDK or reads Steve's Gemini variables (tools/no_paid_ai.py enforces it).

generate() makes one call, streamed or not, with a timeout and no automatic retries (a 429 is final: the caller's
breaker decides what happens next). Errors come back as SteveUnavailable; logs hold counts, sizes and latency only,
never a prompt, an answer, book text or a key. The SDK is imported on first use, so a server where nobody asks
Steve anything never loads it (about 18 MB, docs/BENCHMARKS.md).
"""

import asyncio
import hashlib
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from backend.steve import policy
from backend.steve.errors import SteveUnavailable

logger = logging.getLogger("steve.provider")

MODEL_ENV = {"chat": "GEMINI_MODEL_CHAT", "vision": "GEMINI_MODEL_VISION"}
KEY_ENV = "GEMINI_API_KEY"
RETRY_DELAY = re.compile(r"'retryDelay': '(\d+)(?:\.\d+)?s'")


@dataclass(frozen=True)
class Piece:
    """Part of an answer; the last one has done=True and Google's token counts."""

    text: str
    done: bool
    model: str
    tokens_in: int | None = None
    tokens_out: int | None = None
    cached: bool = False


def model_name(role: str) -> str:
    name = os.environ.get(MODEL_ENV[role], "").strip()
    if not name:
        raise SteveUnavailable("not_configured")
    return name


def key_id(api_key: str | None) -> str:
    """'ours' for our key, else a fingerprint that tells readers' keys apart without holding them."""
    return "ours" if api_key is None else "own:" + hashlib.sha256(api_key.encode()).hexdigest()[:16]


def http_options() -> dict:
    """The SDK's HTTP options: our timeout (milliseconds) and one attempt, so nothing is retried."""
    return {"timeout": int(policy.TIMEOUT_SECONDS * 1000), "retry_options": {"attempts": 1}}


def _make_client(api_key: str):
    from google import genai  # first use only (see the module docstring)

    logging.getLogger("google_genai").setLevel(logging.WARNING)  # its debug lines can hold response text
    return genai.Client(api_key=api_key, http_options=http_options())


def _retry_after(exc: BaseException) -> int:
    """Google's RetryInfo delay in seconds (capped), else the policy cool-down; the breaker applies its floor."""
    found = RETRY_DELAY.search(str(getattr(exc, "details", "")))
    seconds = int(found.group(1)) if found else policy.BREAKER_COOLDOWN_MINUTES * 60
    return min(seconds, policy.BREAKER_MAX_MINUTES * 60)


def _unavailable(exc: BaseException) -> SteveUnavailable:
    if isinstance(exc, (TimeoutError, httpx.TimeoutException)):
        return SteveUnavailable("timeout")
    code = getattr(exc, "code", None)
    if code == 429:
        return SteveUnavailable("paused_quota", retry_after=_retry_after(exc))
    if code in (401, 403) or (code == 400 and "API_KEY_INVALID" in str(getattr(exc, "details", ""))):
        return SteveUnavailable("key_rejected")
    return SteveUnavailable("unavailable")


def _counts(response) -> tuple[int | None, int | None]:
    usage = getattr(response, "usage_metadata", None)
    return getattr(usage, "prompt_token_count", None), getattr(usage, "candidates_token_count", None)


async def check_key(api_key: str) -> None:
    """Check a reader's key with Google by reading the chat model's details: no generation, no quota spent.
    Returns if Google accepts the key; raises SteveUnavailable (key_rejected, paused_quota, timeout, ...)."""
    name = model_name("chat")
    started, status = time.monotonic(), "ok"
    try:
        async with asyncio.timeout(policy.TIMEOUT_SECONDS):
            await _make_client(api_key).aio.models.get(model=name)
    except Exception as exc:  # noqa: BLE001 - every failure is re-raised typed; the original (may echo input) dropped
        unavailable = _unavailable(exc)
        status = unavailable.reason
        raise unavailable from None
    finally:
        logger.info("steve.provider key check model=%s status=%s ms=%d", name, status,
                    (time.monotonic() - started) * 1000)


async def generate(parts: list, *, model: str = "chat", api_key: str | None = None, stream: bool = False,
                   system: str | None = None) -> AsyncIterator[Piece]:
    """Ask Gemini once.

    parts: the request's contents, already built and capped by the context builder. model: 'chat' or 'vision'.
    api_key: a reader's own key, else ours. Yields one Piece, or one per streamed chunk (the last with done=True
    and the token counts); raises SteveUnavailable.
    """
    name = model_name(model)
    key = api_key or os.environ.get(KEY_ENV, "").strip()
    if not key:
        raise SteveUnavailable("not_configured")
    config = {"system_instruction": system} if system else None
    started, status, counts, size = time.monotonic(), "ok", (None, None), 0
    try:
        models = _make_client(key).aio.models
        if not stream:
            async with asyncio.timeout(policy.TIMEOUT_SECONDS):
                response = await models.generate_content(model=name, contents=parts, config=config)
            counts, text = _counts(response), response.text or ""
            size = len(text)
            yield Piece(text=text, done=True, model=name, tokens_in=counts[0], tokens_out=counts[1])
            return
        pending = None
        async with asyncio.timeout(policy.STREAM_TIMEOUT_SECONDS):
            chunks = await models.generate_content_stream(model=name, contents=parts, config=config)
            async for chunk in chunks:
                if pending is not None:
                    yield pending
                if _counts(chunk) != (None, None):
                    counts = _counts(chunk)
                pending = Piece(text=chunk.text or "", done=False, model=name)
                size += len(pending.text)
        yield Piece(text=pending.text if pending else "", done=True, model=name,
                    tokens_in=counts[0], tokens_out=counts[1])
    except SteveUnavailable as unavailable:
        status = unavailable.reason
        raise
    except Exception as exc:  # noqa: BLE001 - every failure is re-raised typed; the original (may echo input) dropped
        unavailable = _unavailable(exc)
        status = unavailable.reason
        raise unavailable from None
    finally:
        logger.info("steve.provider call model=%s key=%s stream=%s status=%s ms=%d chars_out=%d tokens_in=%s "
                    "tokens_out=%s", name, "ours" if api_key is None else "own", stream, status,
                    (time.monotonic() - started) * 1000, size, counts[0], counts[1])
