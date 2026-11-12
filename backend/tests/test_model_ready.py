"""Endpoints that grade with the model wait for it, then answer 503 with a clear message."""

import asyncio
import threading

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import dependencies
from backend.dependencies import get_current_user
from backend.main import app
from backend.nlp import embedder


@pytest.fixture
def loading(monkeypatch, fake_supabase):
    """The model is still loading and stays so; no real load is started."""
    monkeypatch.setattr(embedder, "_ready", threading.Event())
    monkeypatch.setattr(embedder, "ensure_loading", lambda: None)
    monkeypatch.setenv("EMBED_WAIT_SECONDS", "0.05")
    app.dependency_overrides[get_current_user] = lambda: "user-1"
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.mark.parametrize("path, body", [
    ("/sessions/s1/submit-answers", {"answers": ["a"], "time_taken_seconds": 30}),
    ("/sessions/s1/evaluate-single", {"index": 0, "answer": "a"}),
])
def test_grading_answers_503_with_retry_after_while_the_model_loads(loading, fake_supabase, path, body):
    resp = loading.post(path, json=body)
    assert resp.status_code == 503
    assert "still loading" in resp.json()["detail"]
    assert resp.headers["retry-after"] == str(dependencies.RETRY_AFTER_SECONDS)
    assert fake_supabase.table.call_count == 0  # the session was not claimed, so a retry is safe


def test_require_model_returns_at_once_when_the_model_is_ready():
    asyncio.run(dependencies.require_model())  # conftest marks the model ready


def test_require_model_starts_a_load_when_none_is_running(monkeypatch):
    monkeypatch.setattr(embedder, "_ready", threading.Event())
    started = []
    monkeypatch.setattr(embedder, "ensure_loading", lambda: started.append(True))
    monkeypatch.setenv("EMBED_WAIT_SECONDS", "0")
    with pytest.raises(HTTPException) as raised:
        asyncio.run(dependencies.require_model())
    assert raised.value.status_code == 503 and started == [True]
