"""The knowledge state's I/O (record_test) and GET /mastery, on the in-memory database. No model, no network."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.agents.knowledge_state import agent as knowledge_agent
from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import mastery as mastery_router
from backend.tests.test_api_sessions import FakeDb

USER, OTHER, BOOK = "user-1", "user-2", "book-1"
NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)


def stored(key, mastery, user=USER, book=BOOK, **fields):
    return {"user_id": user, "book_id": book, "concept_key": key, "mastery": mastery, "attempts": 1, "correct": 0,
            "last_seen": None, "next_review": None, "last_event_id": None, **fields}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb()
    fake.tables["user_concept_mastery"] = []
    for module in (knowledge_agent, mastery_router):
        monkeypatch.setattr(module, "supabase", fake)
    return fake


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def question(*keys):
    return {"id": "q", "concept_keys": list(keys)}


def graded(score, confidence="high"):
    return {"score": score, "max_score": 10, "confidence": confidence}


def test_record_test_writes_one_row_per_concept_with_review_dates(db):
    db.tables["user_concept_mastery"] = [stored("road", 0.9), stored("road", 0.1, user=OTHER)]
    report = knowledge_agent.record_test(
        USER, BOOK, "s1", [question("gravel", "road"), question(), {"id": "old question"}],
        [graded(10), graded(10), graded(10)], now=NOW,
    )
    assert report == {"questions": 1, "concepts": 2}
    rows = {(r["user_id"], r["concept_key"]): r for r in db.tables["user_concept_mastery"]}
    gravel, road = rows[(USER, "gravel")], rows[(USER, "road")]
    assert gravel["mastery"] == pytest.approx(0.51) and gravel["book_id"] == BOOK and gravel["last_event_id"] == "s1"
    assert gravel["last_seen"] == NOW.isoformat() and gravel["next_review"] == (NOW + timedelta(days=3)).isoformat()
    assert road["mastery"] == pytest.approx(0.93) and road["next_review"] == (NOW + timedelta(days=14)).isoformat()
    assert (road["attempts"], road["correct"]) == (2, 1)
    assert rows[(OTHER, "road")]["mastery"] == 0.1  # another reader's row is not read or written
    assert db.calls == [("user_concept_mastery", "select"), ("user_concept_mastery", "upsert")]


def test_record_test_scores_by_points_and_weighs_low_confidence(db):
    knowledge_agent.record_test(USER, BOOK, "s1", [question("a"), question("b")], [graded(0), graded(10, "low")], now=NOW)
    rows = {r["concept_key"]: r["mastery"] for r in db.tables["user_concept_mastery"]}
    assert rows == {"a": pytest.approx(0.225), "b": pytest.approx(0.405)}


def test_record_test_applies_an_event_once_and_skips_tests_without_concepts(db):
    args = (USER, BOOK, "s1", [question("gravel")], [graded(10)])
    knowledge_agent.record_test(*args, now=NOW)
    db.calls.clear()
    assert knowledge_agent.record_test(*args, now=NOW) == {"questions": 1, "concepts": 0}
    assert db.calls == [("user_concept_mastery", "select")] and db.tables["user_concept_mastery"][0]["attempts"] == 1
    db.calls.clear()
    assert knowledge_agent.record_test(USER, BOOK, "s2", [question()], [graded(10)]) == {"questions": 0, "concepts": 0}
    assert db.calls == []  # no concept named: no round trip


def test_get_mastery_needs_a_token(db):
    with TestClient(app) as anonymous:
        assert anonymous.get("/mastery").status_code in (401, 403)


def test_get_mastery_returns_the_callers_rows_weakest_first_with_labels(db, client):
    db.tables["user_concept_mastery"] = [
        stored("road", 0.8), stored("gravel", 0.2), stored("bridge", 0.5), stored("arch", 0.5),
        stored("gravel", 0.05, user=OTHER), stored("canal", 0.1, book="book-2"),
    ]
    db.tables["concepts"] = [
        {"user_id": USER, "book_id": BOOK, "concept_key": "gravel", "label": "gravel beds"},
        {"user_id": USER, "book_id": "book-2", "concept_key": "gravel", "label": "wrong book"},
        {"user_id": OTHER, "book_id": BOOK, "concept_key": "road", "label": "wrong reader"},
    ]
    body = client.get("/mastery", params={"book_id": BOOK}).json()
    assert [item["concept_key"] for item in body["items"]] == ["gravel", "arch", "bridge", "road"]
    assert (body["total"], body["limit"], body["offset"]) == (4, 50, 0)
    assert body["items"][0] == {
        "book_id": BOOK, "concept_key": "gravel", "label": "gravel beds", "mastery": 0.2, "attempts": 1,
        "correct": 0, "last_seen": None, "next_review": None,
    }
    assert body["items"][3]["label"] == "road"  # no concepts row: the key, with spaces
    everything = client.get("/mastery").json()
    assert [item["concept_key"] for item in everything["items"]] == ["canal", "gravel", "arch", "bridge", "road"]
    assert everything["total"] == 5


def test_get_mastery_is_paginated(db, client):
    db.tables["user_concept_mastery"] = [stored(f"k{i}", i / 10) for i in range(7)]
    page = client.get("/mastery", params={"book_id": BOOK, "limit": 3, "offset": 3}).json()
    assert [item["concept_key"] for item in page["items"]] == ["k3", "k4", "k5"]
    assert (page["total"], page["limit"], page["offset"]) == (7, 3, 3)
    assert client.get("/mastery", params={"limit": 3, "offset": 6}).json()["items"][0]["concept_key"] == "k6"
    # A page past the last row is empty and still says how many rows there are (PostgREST raises PGRST103 for it).
    assert client.get("/mastery", params={"offset": 50}).json() == {"items": [], "total": 7, "limit": 50, "offset": 50}
    assert client.get("/mastery", params={"offset": 7}).json()["items"] == []
    for bad in ({"limit": 0}, {"limit": 201}, {"offset": -1}, {"limit": "many"}):
        assert client.get("/mastery", params=bad).status_code == 422


def test_get_mastery_for_a_reader_with_no_rows_is_empty(db, client):
    assert client.get("/mastery", params={"book_id": BOOK}).json() == {"items": [], "total": 0, "limit": 50, "offset": 0}
    assert db.calls == [("user_concept_mastery", "select")]  # no label lookup for an empty page
