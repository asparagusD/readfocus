"""C35.6 (issue 17): ingestion makes way for API requests. A middleware counts the requests being served (not
/health, Steve's stream or a preflight); a job pauses between batches and waits while any is in flight, a parse
thread waits page by page, each wait capped; and a request served during ingestion answers promptly.
"""

import asyncio
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.services import make_way


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.setattr(make_way, "_in_flight", 0)
    monkeypatch.setattr(make_way, "BATCH_PAUSE", 0.2)


def counted_app(seen):
    app = FastAPI()
    app.add_middleware(make_way.RequestCounter)

    @app.get("/books")
    def books():
        seen.append(make_way.busy())
        return []

    @app.get("/health")
    def health():
        seen.append(make_way.busy())
        return {}

    @app.get("/steve/ask")
    def ask():
        seen.append(make_way.busy())
        return {}

    return app


def test_a_request_is_counted_while_served_and_not_after():
    seen = []
    client = TestClient(counted_app(seen))
    client.get("/books")
    client.get("/health")
    client.get("/steve/ask")
    client.options("/books")
    assert seen == [1, 0, 0]
    assert make_way.busy() == 0


def test_a_failing_request_is_still_counted_out():
    app = FastAPI()
    app.add_middleware(make_way.RequestCounter)

    @app.get("/boom")
    def boom():
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        TestClient(app).get("/boom")
    assert make_way.busy() == 0


def test_between_batches_pauses_then_waits_for_requests_to_finish():
    async def run():
        make_way.started()
        loop = asyncio.get_running_loop()
        loop.call_later(0.4, make_way.finished)
        began = time.perf_counter()
        spent = await make_way.between_batches()
        return time.perf_counter() - began, spent
    took, spent = asyncio.run(run())
    assert 0.35 <= took < 0.9  # the request finished at 0.4 s; timers are coarse on Windows and CI
    assert spent == pytest.approx(took, abs=0.15)


def test_waits_are_capped_so_ingestion_never_stops():
    make_way.started()
    began = time.perf_counter()
    asyncio.run(make_way.between_batches(pause=0.0, max_wait=0.2))
    assert time.perf_counter() - began < 0.5
    began = time.perf_counter()
    assert make_way.in_thread(max_wait=0.1) == pytest.approx(0.1, abs=0.06)
    assert time.perf_counter() - began < 0.3
    make_way.finished()
    assert make_way.in_thread() == 0.0  # nothing in flight: no wait at all


def test_a_parse_thread_waits_while_a_request_is_served():
    order = []

    def parse():
        for page in range(3):
            make_way.in_thread(max_wait=1.0)
            order.append(f"page {page}")

    make_way.started()
    worker = threading.Thread(target=parse)
    worker.start()
    time.sleep(0.2)
    order.append("request answered")
    make_way.finished()
    worker.join(2)
    assert order[0] == "request answered"
    assert order[1:] == ["page 0", "page 1", "page 2"]


def test_a_requests_background_task_is_not_counted_as_the_request():
    """An upload's ingestion runs as a background task after the answer, inside the same ASGI call: it must not
    wait on its own request."""
    from fastapi import BackgroundTasks

    seen = []
    app = FastAPI()
    app.add_middleware(make_way.RequestCounter)

    @app.post("/upload")
    def upload(tasks: BackgroundTasks):
        seen.append(("answering", make_way.busy()))
        tasks.add_task(lambda: seen.append(("ingesting", make_way.busy())))
        return {}

    TestClient(app).post("/upload")
    assert seen == [("answering", 1), ("ingesting", 0)]
    assert make_way.busy() == 0
