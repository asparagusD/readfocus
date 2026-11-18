"""C34.5 (issue 13): no endpoint holds the event loop while it waits on Supabase.

The Supabase client is synchronous. An `async def` endpoint that calls it runs that call on the event loop, and
every other request (/health, the reader's parallel requests on open) waits until it returns. Endpoints are plain
`def` (FastAPI runs them on its threadpool) unless they await something, and then their database calls go
through run_in_threadpool.
"""

import ast
import asyncio
import pathlib
import time

import httpx
import pytest

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.tests import memory_db
from backend.tests.memory_db import MemoryDb

ROUTERS = pathlib.Path(__file__).resolve().parents[1] / "routers"
VERBS = {"get", "post", "put", "patch", "delete"}
OFF_LOOP = {"run_in_threadpool", "to_thread"}


def endpoints():
    for path in sorted(ROUTERS.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.AsyncFunctionDef) and any(
                    isinstance(d, ast.Call) and getattr(d.func, "attr", "") in VERBS for d in node.decorator_list):
                yield path.name, node


def _root(node):
    while isinstance(node, (ast.Attribute, ast.Call, ast.Subscript)):
        node = node.func if isinstance(node, ast.Call) else node.value
    return getattr(node, "id", None)


def on_loop_executes(fn):
    """Lines of `supabase....execute()` calls made on the loop: not inside a nested function or lambda, and not
    handed to run_in_threadpool / asyncio.to_thread."""
    hits = []

    def visit(node, shielded):
        if isinstance(node, (ast.Lambda, ast.FunctionDef, ast.AsyncFunctionDef)) and node is not fn:
            shielded = True
        if isinstance(node, ast.Call):
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
            if name in OFF_LOOP:
                return
            if (not shielded and isinstance(node.func, ast.Attribute) and node.func.attr == "execute"
                    and _root(node.func) == "supabase"):
                hits.append(node.lineno)
        for child in ast.iter_child_nodes(node):
            visit(child, shielded)

    visit(fn, False)
    return hits


def test_an_async_endpoint_awaits_something():
    idle = [f"{name}:{fn.lineno} {fn.name}" for name, fn in endpoints()
            if not any(isinstance(n, ast.Await) for n in ast.walk(fn))]
    assert idle == [], "async endpoints that await nothing run their work on the event loop: make them def"


def test_no_async_endpoint_calls_supabase_on_the_loop():
    found = [f"{name}:{line} {fn.name}" for name, fn in endpoints() for line in on_loop_executes(fn)]
    assert found == [], "call these through run_in_threadpool"


SLOW = 0.3  # seconds each database call takes here
LATE = 0.15  # the most the loop may be held up


@pytest.fixture
def slow_db(monkeypatch):
    fake = MemoryDb()
    fake.tables["books"] = [{"id": "book-1", "user_id": "user-1", "storage_mode": "cloud",
                             "storage_path": "user-1/book-1.pdf", "file_sha256": None}]
    monkeypatch.setattr(books, "supabase", fake)
    execute = memory_db.Query.execute
    monkeypatch.setattr(memory_db.Query, "execute", lambda self: (time.sleep(SLOW), execute(self))[1])
    app.dependency_overrides[get_current_user] = lambda: "user-1"
    yield fake
    app.dependency_overrides.clear()


def test_a_slow_database_call_does_not_hold_up_the_loop(slow_db):
    """A 10 ms heartbeat beside GET /books/{id}/file (its book lookup made slow) is never held up."""
    async def main():
        worst, done = 0.0, False

        async def beat():
            nonlocal worst
            while not done:
                started = time.perf_counter()
                await asyncio.sleep(0.01)
                worst = max(worst, time.perf_counter() - started - 0.01)

        heart = asyncio.create_task(beat())
        await asyncio.sleep(0.05)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/books/book-1/file")
        done = True
        await heart
        return response.status_code, worst

    status, worst = asyncio.run(main())
    assert status == 200
    assert worst < LATE, f"the loop was held up {worst:.2f} s by GET /books/{{id}}/file"
