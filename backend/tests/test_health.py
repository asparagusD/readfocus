"""Tests for the /health endpoint: fast, and it says whether the model is loaded."""

import threading
import time

from fastapi.testclient import TestClient

from backend.main import app
from backend.nlp import embedder

client = TestClient(app)


def test_health_returns_200():
    response = client.get("/health")
    assert response.status_code == 200


def test_health_response_body():
    data = client.get("/health").json()
    assert set(data) == {"status", "model_ready", "timestamp"}
    assert data["status"] == "ok" and data["model_ready"] is True  # conftest marks the model ready


def test_health_does_not_wait_for_a_model_that_is_still_loading(monkeypatch):
    monkeypatch.setattr(embedder, "_ready", threading.Event())
    began = time.perf_counter()
    data = client.get("/health").json()
    assert data["model_ready"] is False
    assert time.perf_counter() - began < 0.5
