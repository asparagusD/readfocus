"""Ingestion makes way for requests (C35.6, issue 17).

A book's ingestion (parsing, chunking, embedding, its region map) runs in this process, on Render Free's 0.1 CPU,
beside the API. It never blocks the event loop (C29.1), but it competes with every request for that CPU: `/open`
took about 2 s during processing against 0.48 s after, and Render's log showed a 33 s stretch with no request
answered while a 29.4 MB book was processed.

A middleware counts the API requests being served (not /health, and not Steve's answer stream, which mostly waits
on Gemini). Ingestion then gives way:

- `between_batches` (async, from a job's batch loop): a short pause, then a wait while any request is in flight;
- `in_thread` (sync, from a per-page loop inside a parse thread): a wait while any request is in flight;
  `time.sleep` lets go of the GIL, so the request's thread runs.

Each wait has a cap, so a stream of requests slows ingestion but never stops it.
"""

import asyncio
import threading
import time

BATCH_PAUSE = 0.2   # seconds between batches, requests or not
STEP = 0.05         # seconds between looks at the count
BATCH_MAX_WAIT = 2.0  # the most one batch waits for requests to finish
PAGE_MAX_WAIT = 0.25  # the most one page waits (a parse has hundreds of pages)
NOT_COUNTED = ("/health", "/steve/ask")

_lock = threading.Lock()
_in_flight = 0


def started() -> None:
    global _in_flight
    with _lock:
        _in_flight += 1


def finished() -> None:
    global _in_flight
    with _lock:
        _in_flight = max(0, _in_flight - 1)


def busy() -> int:
    """How many API requests are being served now."""
    return _in_flight


async def between_batches(pause: float | None = None, max_wait: float = BATCH_MAX_WAIT) -> float:
    """Pause, then wait (up to `max_wait`) while requests are served; the seconds spent."""
    pause = BATCH_PAUSE if pause is None else pause  # read now, so a test can set it to 0
    await asyncio.sleep(pause)
    waited = 0.0
    while busy() and waited < max_wait:
        await asyncio.sleep(STEP)
        waited += STEP
    return pause + waited


def in_thread(max_wait: float = PAGE_MAX_WAIT) -> float:
    """Inside a parse thread: wait (up to `max_wait`) while requests are served; the seconds spent."""
    waited = 0.0
    while busy() and waited < max_wait:
        time.sleep(STEP)
        waited += STEP
    return waited


class RequestCounter:
    """ASGI middleware: counts the HTTP requests being served, but for NOT_COUNTED paths."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") in NOT_COUNTED or scope.get("method") == "OPTIONS":
            return await self.app(scope, receive, send)
        started()
        done = False

        def finish_once() -> None:
            nonlocal done
            if not done:
                done = True
                finished()

        async def counted_send(message):
            await send(message)
            # The answer is complete: a request's background tasks (a book's ingestion after its upload) run after
            # this inside the same call, and must not count as the request still being served.
            if message.get("type") == "http.response.body" and not message.get("more_body", False):
                finish_once()

        try:
            return await self.app(scope, receive, counted_send)
        finally:
            finish_once()
