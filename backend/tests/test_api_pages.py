"""GET /books/{id}/pages (C12.4): read-only chunks for reading ahead, owner only, a few at a time. No session is touched."""

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.tests.memory_db import MemoryDb

USER, OTHER, BOOK = "user-1", "user-2", "book-1"


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [{"id": BOOK, "user_id": USER, "title": "Walden", "total_chunks": 6}]
    db.tables["chunks"] = [
        {"id": f"c{i}", "book_id": BOOK, "user_id": USER, "chunk_index": i, "content": f"text {i}", "word_count": 2,
         "blocks": [{"id": f"{i}.0", "type": "paragraph", "text": f"text {i}", "marks": []}],
         "embedding_local": [0.1] * 4}
        for i in range(6)
    ]
    db.tables["sessions"] = []
    db.tables["reading_progress"] = []
    monkeypatch.setattr(books, "supabase", db)
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_a_range_of_chunks_comes_back_in_order_with_blocks(client):
    response = client.get(f"/books/{BOOK}/pages", params={"start": 2, "end": 3})
    assert response.status_code == 200
    chunks = response.json()["chunks"]
    assert [c["chunk_index"] for c in chunks] == [2, 3]
    assert set(chunks[0]) == {"chunk_index", "content", "word_count", "blocks"}  # no embeddings or ids


def test_one_chunk_when_end_is_left_out_and_nothing_past_the_end(client):
    assert [c["chunk_index"] for c in client.get(f"/books/{BOOK}/pages", params={"start": 5}).json()["chunks"]] == [5]
    assert client.get(f"/books/{BOOK}/pages", params={"start": 6}).json()["chunks"] == []


@pytest.mark.parametrize("params", [{"start": -1}, {"start": 3, "end": 2}, {"start": 0, "end": 4}, {}])
def test_a_bad_or_too_large_range_is_refused(client, params):
    assert client.get(f"/books/{BOOK}/pages", params=params).status_code == 422


def test_another_readers_book_is_not_found(client, db):
    db.tables["books"][0]["user_id"] = OTHER
    assert client.get(f"/books/{BOOK}/pages", params={"start": 0}).status_code == 404


def test_reading_ahead_touches_no_session_or_progress(client, db):
    client.get(f"/books/{BOOK}/pages", params={"start": 0, "end": 3})
    assert db.tables["sessions"] == [] and db.tables["reading_progress"] == []
    assert {name for name, action in db.calls if action != "select"} == set()
