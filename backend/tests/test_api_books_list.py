"""GET /books (C13.3a): the caller's books with the fields the shelf had, plus cover_url and reading progress."""

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
OLD_FIELDS = {"id", "status", "title", "author", "total_chunks", "total_words", "created_at"}


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [
        {"id": "b1", "user_id": USER, "status": "ready", "title": "Walden", "author": "Thoreau", "total_chunks": 10,
         "total_words": 6000, "created_at": "2026-11-01T10:00:00Z", "cover_url": "https://x/covers/ol/1-M.jpg",
         "storage_path": "user-1/b1.pdf", "toc": [{"title": "Economy"}]},
        {"id": "b2", "user_id": USER, "status": "processing", "title": "Middlemarch", "author": "Eliot",
         "total_chunks": None, "total_words": None, "created_at": "2026-11-02T10:00:00Z", "cover_url": None},
        {"id": "b3", "user_id": OTHER, "status": "ready", "title": "Not mine", "author": "Someone", "total_chunks": 3,
         "total_words": 900, "created_at": "2026-11-03T10:00:00Z", "cover_url": None},
    ]
    db.tables["reading_progress"] = [
        {"id": "p1", "user_id": USER, "book_id": "b1", "chunks_completed": 4, "last_chunk_index": 3,
         "average_score": 72, "updated_at": "2026-11-10T20:00:00Z", "pace_recommendation": {"x": 1}},
        {"id": "p2", "user_id": OTHER, "book_id": "b1", "chunks_completed": 9, "last_chunk_index": 8,
         "average_score": 10, "updated_at": "2026-11-09T20:00:00Z"},
    ]
    monkeypatch.setattr(books, "supabase", db)
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_only_the_callers_books_with_the_old_fields_cover_and_progress(client):
    response = client.get("/books")
    assert response.status_code == 200
    by_id = {b["id"]: b for b in response.json()}
    assert set(by_id) == {"b1", "b2"}
    assert OLD_FIELDS | {"cover_url", "progress"} <= set(by_id["b1"])
    assert by_id["b1"]["cover_url"] == "https://x/covers/ol/1-M.jpg"


def test_the_select_keeps_the_old_columns_and_adds_only_the_cover():
    # MemoryDb returns whole rows, so the column list is checked here: no storage path or toc leaves the server.
    assert {c.strip() for c in books.BOOK_LIST_FIELDS.split(",")} == OLD_FIELDS | {"cover_url"}


def test_progress_is_the_callers_own_and_null_before_a_first_session(client):
    by_id = {b["id"]: b for b in client.get("/books").json()}
    assert by_id["b1"]["progress"] == {"chunks_completed": 4, "last_chunk_index": 3, "updated_at": "2026-11-10T20:00:00Z"}
    assert by_id["b2"]["progress"] is None
    assert by_id["b2"]["cover_url"] is None


def test_an_empty_shelf_is_an_empty_list(client, db):
    db.tables["books"] = [b for b in db.tables["books"] if b["user_id"] != USER]
    assert client.get("/books").json() == []
