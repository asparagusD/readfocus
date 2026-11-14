"""POST /steve/ask (Server-Sent Events) and GET /steve/threads (C20.6), on the in-memory database.

Gemini is faked at provider.generate and the retriever at retriever.search; quota calls go to a fake RPC. Nothing
leaves the machine.
"""

import base64
import json
import logging
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import steve_ask
from backend.steve import (
    breaker,
    cache,
    consent,
    context,
    keys,
    provider,
    quota,
    service,
    threads,
)
from backend.steve.errors import SteveUnavailable
from backend.tests.memory_db import MemoryDb

USER, OTHER, BOOK = "user-1", "user-2", "book-1"
OWN_KEY = "AIzaSyReaderOwnKey-not-real-abcdefghij12"
SECRET = "test-secret-not-real-0123456789-abcdefghijklmnopqrstuvwxyz"
BOOK_TEXT = "The ferryman counts the coins twice before the lantern is lit."
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64


class Db(MemoryDb):
    """MemoryDb plus the two quota functions of migration 024."""

    def rpc(self, name, params):
        rows = self.tables.setdefault("steve_usage", [])
        row = next((r for r in rows if r["user_id"] == params["p_user"] and r["day"] == params["p_day"]), None)
        if name == "steve_take_quota":
            if row is None:
                row = {"user_id": params["p_user"], "day": params["p_day"], "requests": 0}
                rows.append(row)
            data = -1 if row["requests"] >= params["p_limit"] else row["requests"] + 1
            row["requests"] = max(row["requests"], data)
        else:
            if row and row["requests"] > 0:
                row["requests"] -= 1
            data = None
        return type("R", (), {"execute": lambda self: type("D", (), {"data": data})()})()


class FakeGemini:
    def __init__(self):
        self.calls, self.error, self.fail_after = [], None, None
        self.pieces = ["He counts twice ", "[p. 4] because ", "of the toll [p. 999]."]

    async def generate(self, parts, *, model="chat", api_key=None, stream=False, system=None):
        self.calls.append({"parts": parts, "model": model, "api_key": api_key, "stream": stream, "system": system})
        if self.error:
            raise self.error
        for i, text in enumerate(self.pieces):
            if self.fail_after is not None and i == self.fail_after:
                raise SteveUnavailable("unavailable")
            last = i == len(self.pieces) - 1
            yield provider.Piece(text=text, done=last, model=f"gemini-test-{model}",
                                 tokens_in=812 if last else None, tokens_out=24 if last else None)


@pytest.fixture
def env(monkeypatch):
    db = Db()
    db.tables["profiles"] = [
        {"user_id": USER, "steve_enabled": True, "steve_consent_at": "2026-11-14T08:00:00+00:00",
         "steve_consent_version": consent.CONSENT_VERSION, "steve_key_cipher": None, "steve_key_last4": None},
        {"user_id": OTHER, "steve_enabled": True, "steve_consent_at": "2026-11-14T08:00:00+00:00",
         "steve_consent_version": consent.CONSENT_VERSION, "steve_key_cipher": None, "steve_key_last4": None},
    ]
    db.tables["books"] = [{"id": BOOK, "user_id": USER, "title": "Tides", "author": "A. Keeper", "toc": []},
                          {"id": "theirs", "user_id": OTHER, "title": "Theirs", "author": "", "toc": []}]
    db.tables["chunks"] = [{"id": f"c{i}", "book_id": BOOK, "chunk_index": i, "content": f"{BOOK_TEXT} ({i})",
                            "prose": f"{BOOK_TEXT} ({i})", "anchors": {"kind": "pdf", "pages": [i + 4, i + 4],
                                                                         "spans": [], "placeholders": []}}
                           for i in range(3)]
    db.tables["sessions"] = [{"id": "s1", "user_id": USER, "book_id": BOOK, "chunk_start_index": 0,
                              "chunk_end_index": 1, "status": "reading", "started_at": "2026-11-14T09:00:00+00:00"}]
    db.tables["reading_progress"] = [{"user_id": USER, "book_id": BOOK, "position": {"chunk_index": 1}}]
    db.tables["page_regions"] = [{"id": "r-code", "book_id": BOOK, "page": 5, "kind": "code",
                                  "text": "def toll(n):\n    return 2 * n", "meta": {"language_guess": "python"},
                                  "order_in_page": 0}]
    for module in (steve_ask, threads, context, keys, quota):
        monkeypatch.setattr(module, "supabase", db)
    gemini = FakeGemini()
    monkeypatch.setattr(provider, "generate", gemini.generate)
    monkeypatch.setattr(provider, "model_name", lambda role: f"gemini-test-{role}")

    async def search(query_text, book_id, k=3):
        return [{"id": "c2", "chunk_index": 2, "content": BOOK_TEXT, "score": 1.0}]

    monkeypatch.setattr(context.retriever, "search", search)
    monkeypatch.setattr(service, "now", lambda: datetime(2026, 11, 14, 12, tzinfo=UTC))
    monkeypatch.setenv("STEVE_DAILY_LIMIT_PER_USER", "3")
    monkeypatch.setenv("KEY_ENCRYPTION_SECRET", SECRET)
    breaker.breaker.reset()
    cache.cache.clear()
    app.dependency_overrides[get_current_user] = lambda: USER
    client = TestClient(app)
    yield type("Env", (), {"db": db, "gemini": gemini, "client": client})()
    app.dependency_overrides.clear()
    breaker.breaker.reset()
    cache.cache.clear()


def ask(env, **body):
    body.setdefault("book_id", BOOK)
    body.setdefault("question", "Why does the ferryman count twice?")
    body.setdefault("mode", "ask")
    return env.client.post("/steve/ask", json=body)


def events(response):
    """The SSE stream as [(event, data)], data parsed as JSON."""
    out = []
    for block in response.text.split("\n\n"):
        if not block.strip():
            continue
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_an_answer_streams_tokens_then_a_final_event_with_citations_and_usage(env):
    response = ask(env)
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/event-stream")
    got = events(response)
    names = [name for name, _ in got]
    assert names == ["start", "token", "token", "token", "done"]
    start, done = got[0][1], got[-1][1]
    assert start["thread_id"] and start["pages"] == ["p. 4", "p. 5", "p. 6"]
    assert "".join(data["text"] for name, data in got if name == "token") == "".join(env.gemini.pieces)
    assert done["text"] == "He counts twice [p. 4] because of the toll."  # [p. 999] was never sent
    assert done["citations"] == [{"label": "p. 4", "anchor": {"kind": "pdf", "page": 4}}]
    assert done["usage"] == {"model": "gemini-test-chat", "tokens_in": 812, "tokens_out": 24, "cached": False}
    assert done["thread_id"] == start["thread_id"] and done["message_id"]
    call = env.gemini.calls[0]
    assert call["stream"] is True and "Allowed citation labels" in call["system"] and BOOK_TEXT not in call["system"]


def test_both_messages_are_kept_in_the_thread(env):
    done = events(ask(env))[-1][1]
    reader, steve = sorted((m for m in env.db.tables["steve_messages"]), key=lambda m: m["role"])
    assert reader["role"] == "reader" and reader["content"] == "Why does the ferryman count twice?"
    assert steve["role"] == "steve" and steve["content"] == done["text"] and steve["id"] == done["message_id"]
    assert steve["citations"] == done["citations"] and (steve["tokens_in"], steve["tokens_out"]) == (812, 24)
    assert steve["model"] == "gemini-test-chat" and reader["user_id"] == steve["user_id"] == USER
    (thread,) = env.db.tables["steve_threads"]
    assert thread["user_id"] == USER and thread["book_id"] == BOOK and reader["thread_id"] == thread["id"]


def test_a_follow_up_joins_its_thread(env):
    thread_id = events(ask(env))[0][1]["thread_id"]
    again = events(ask(env, thread_id=thread_id, question="And the lantern?"))
    assert again[0][1]["thread_id"] == thread_id and len(env.db.tables["steve_threads"]) == 1


def test_a_highlight_is_kept_with_the_question(env):
    anchor = {"kind": "pdf", "page": 4, "quads": [[1, 1, 2, 2]], "text": "counts the coins twice"}
    events(ask(env, mode="explain_highlight", anchor=anchor))
    reader = next(m for m in env.db.tables["steve_messages"] if m["role"] == "reader")
    assert reader["anchor"] == anchor


def test_a_code_region_is_explained(env):
    events(ask(env, mode="explain_code", code_region_id="r-code", question="What does this do?"))
    assert "def toll(n):\n    return 2 * n" in env.gemini.calls[0]["parts"][0]


def test_an_equation_image_goes_to_the_vision_model(env):
    image = base64.b64encode(PNG).decode()
    events(ask(env, mode="explain_equation", image_png_b64=image, question="Explain this equation."))
    call = env.gemini.calls[0]
    assert call["model"] == "vision" and call["parts"][1] == {"inline_data": {"mime_type": "image/png", "data": PNG}}
    reader = next(m for m in env.db.tables["steve_messages"] if m["role"] == "reader")
    assert set(reader) == {"id", "thread_id", "user_id", "role", "content", "anchor", "citations", "model",
                           "tokens_in", "tokens_out", "created_at"}  # content only: no image column
    assert base64.b64encode(PNG).decode()[:12] not in json.dumps(env.db.tables["steve_messages"])  # image not kept


def test_latex_mode_answers_bare_latex(env):
    env.gemini.pieces = ["$$a_n = ", "\\frac{1}{\\pi}$$"]
    image = base64.b64encode(PNG).decode()
    done = events(ask(env, mode="latex_equation", image_png_b64=image, question="Copy as LaTeX."))[-1][1]
    assert done["text"] == "a_n = \\frac{1}{\\pi}" and done["citations"] == []


@pytest.mark.parametrize("change, code", [
    ({"steve_consent_at": None, "steve_consent_version": None}, "no_consent"),
    ({"steve_consent_version": "2000-01-01"}, "no_consent"),
    ({"steve_enabled": False}, "disabled"),
])
def test_consent_and_the_off_switch_are_enforced_before_anything_is_sent(env, change, code):
    env.db.tables["profiles"][0].update(change)
    response = ask(env)
    assert response.status_code == 403 and response.json()["detail"]["code"] == code
    assert env.gemini.calls == [] and "steve_messages" not in env.db.tables


def test_steve_waits_while_a_test_is_open_on_the_book(env):
    env.db.tables["sessions"][0]["status"] = "testing"
    response = ask(env)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "in_test" and env.gemini.calls == []


@pytest.mark.parametrize("reason, status", [("paused_quota", 429), ("timeout", 503), ("unavailable", 503),
                                            ("key_rejected", 400)])
def test_a_failure_before_the_first_token_is_a_typed_error(env, reason, status):
    env.gemini.error = SteveUnavailable(reason, retry_after=60)
    response = ask(env)
    assert response.status_code == status and response.json()["detail"]["code"] == reason
    assert not [m for m in env.db.tables.get("steve_messages", []) if m["role"] == "steve"]


def test_the_breaker_pauses_the_next_reader_with_when_steve_is_back(env):
    env.gemini.error = SteveUnavailable("paused_quota", retry_after=60)
    ask(env)
    env.gemini.error = None
    response = ask(env, question="Another question")
    detail = response.json()["detail"]
    assert response.status_code == 429 and detail["code"] == "paused_quota" and detail["until"].startswith("2026-11-14")
    assert len(env.gemini.calls) == 1


def test_the_daily_limit_is_a_typed_pause(env):
    for n in range(3):
        events(ask(env, question=f"Question {n}"))
    response = ask(env, question="One too many")
    assert response.status_code == 429 and response.json()["detail"]["code"] == "daily_limit"


def test_a_failure_mid_stream_ends_with_an_error_event_and_saves_no_answer(env):
    env.gemini.fail_after = 1
    got = events(ask(env))
    assert [name for name, _ in got] == ["start", "token", "error"] and got[-1][1]["code"] == "unavailable"
    assert not [m for m in env.db.tables["steve_messages"] if m["role"] == "steve"]


@pytest.mark.parametrize("image, status, code", [
    ("A" * (700 * 1024), 413, "too_large"),
    (base64.b64encode(b"\0" * (501 * 1024)).decode(), 413, "too_large"),
    (base64.b64encode(b"GIF89a" + b"\0" * 10).decode(), 422, "bad_image"),
    ("not base64 at all!", 422, "bad_image"),
])
def test_a_bad_or_too_large_image_is_refused(env, image, status, code):
    response = ask(env, mode="explain_figure", image_png_b64=image)
    assert response.status_code == status and response.json()["detail"]["code"] == code and env.gemini.calls == []


@pytest.mark.parametrize("body, status, code", [
    ({"book_id": "theirs"}, 404, "book_not_found"),
    ({"thread_id": "steve_threads-999"}, 404, "thread_not_found"),
    ({"mode": "explain_code"}, 422, "needs_code"),
    ({"code_region_id": "nope", "mode": "explain_code"}, 404, "region_not_found"),
])
def test_what_is_not_the_readers_or_not_complete_is_refused(env, body, status, code):
    response = ask(env, **body)
    assert response.status_code == status and response.json()["detail"]["code"] == code and env.gemini.calls == []


def test_a_question_too_long_or_a_bad_mode_is_a_422(env):
    assert ask(env, question="x" * 1201).status_code == 422
    assert ask(env, mode="write_poem").status_code == 422


def test_an_own_key_answers_and_is_never_stored_or_streamed(env, caplog):
    caplog.set_level(logging.DEBUG)
    env.db.tables["profiles"][0].update(steve_key_cipher=keys.encrypt(OWN_KEY), steve_key_last4="ij12")
    response = ask(env)
    assert env.gemini.calls[0]["api_key"] == OWN_KEY
    stored = json.dumps(env.db.tables["steve_messages"]) + json.dumps(env.db.tables["steve_threads"])
    for text in (response.text, stored, caplog.text):
        assert OWN_KEY not in text
    assert BOOK_TEXT not in caplog.text


def test_threads_list_only_the_readers_own_for_the_book(env):
    mine = events(ask(env))[0][1]["thread_id"]
    env.db.tables["steve_threads"].append({"id": "t-other", "user_id": OTHER, "book_id": BOOK,
                                           "created_at": "2026-11-14T10:00:00+00:00"})
    body = env.client.get("/steve/threads", params={"book_id": BOOK}).json()
    assert [t["id"] for t in body["threads"]] == [mine]
    assert body["threads"][0]["title"] == "Why does the ferryman count twice?"


def test_a_thread_opens_with_its_messages_in_order(env):
    thread_id = events(ask(env))[0][1]["thread_id"]
    body = env.client.get(f"/steve/threads/{thread_id}").json()
    assert body["id"] == thread_id and body["book_id"] == BOOK
    assert [m["role"] for m in body["messages"]] == ["reader", "steve"]
    assert body["messages"][1]["citations"] == [{"label": "p. 4", "anchor": {"kind": "pdf", "page": 4}}]


def test_another_readers_thread_is_not_found(env):
    env.db.tables["steve_threads"] = [{"id": "t-other", "user_id": OTHER, "book_id": "theirs",
                                       "created_at": "2026-11-14T10:00:00+00:00"}]
    env.db.tables["steve_messages"] = [{"id": "m1", "thread_id": "t-other", "user_id": OTHER, "role": "reader",
                                        "content": "private", "created_at": "2026-11-14T10:00:00+00:00"}]
    response = env.client.get("/steve/threads/t-other")
    assert response.status_code == 404 and "private" not in response.text
    assert ask(env, thread_id="t-other").status_code == 404
    assert env.client.get("/steve/threads", params={"book_id": "theirs"}).json() == {"threads": []}
