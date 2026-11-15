"""GET and PUT /books/{id}/body-start (C23.1): detected once and kept, the reader's choice wins, owner only."""

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
PROSE = " ".join(["word"] * 320)


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [
        {"id": "pdf-book", "user_id": USER, "file_type": "pdf", "page_count": 40, "body_start": None, "body_start_source": None,
         "toc": [{"title": "Preface", "page": 3, "chunk_index": 0, "block_id": "0.0"},
                 {"title": "Chapter 1", "page": 9, "chunk_index": 2, "block_id": "2.0"}]},
        {"id": "plain-pdf", "user_id": USER, "file_type": "pdf", "page_count": 10, "body_start": None, "body_start_source": None,
         "toc": []},
        {"id": "epub-book", "user_id": USER, "file_type": "epub", "page_count": None, "body_start": None,
         "body_start_source": None, "toc": [{"title": "Cover", "spine_index": 0}, {"title": "One", "spine_index": 2}]},
        {"id": "empty-pdf", "user_id": USER, "file_type": "pdf", "page_count": 2, "body_start": None, "body_start_source": None,
         "toc": None},
        {"id": "theirs", "user_id": OTHER, "file_type": "pdf", "page_count": 5, "body_start": None, "body_start_source": None,
         "toc": [{"title": "Chapter 1", "page": 2}]},
    ]
    db.tables["page_regions"] = [
        {"id": "r1", "book_id": "plain-pdf", "page": 2, "spine_index": None, "kind": "block", "text": "Contents", "order_in_page": 0},
        {"id": "r2", "book_id": "plain-pdf", "page": 4, "spine_index": None, "kind": "block", "text": "Chapter 1", "order_in_page": 0},
        {"id": "r3", "book_id": "plain-pdf", "page": 4, "spine_index": None, "kind": "block", "text": PROSE, "order_in_page": 1},
    ]
    monkeypatch.setattr(books, "supabase", db)
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def row(db, book_id):
    return next(b for b in db.tables["books"] if b["id"] == book_id)


def test_detected_from_the_outline_once_and_saved(client, db):
    body = client.get("/books/pdf-book/body-start").json()
    assert body == {"source": "outline", "body_start": {
        "kind": "pdf", "page": 9, "title": "Chapter 1", "anchor": {"kind": "pdf", "page": 9, "quads": [[0, 0, 0, 0]], "text": ""}}}
    assert row(db, "pdf-book")["body_start_source"] == "outline"
    row(db, "pdf-book")["toc"] = []  # a second visit reads what was saved, not the outline again
    assert client.get("/books/pdf-book/body-start").json() == body


def test_a_pdf_with_no_outline_uses_its_region_headings(client):
    body = client.get("/books/plain-pdf/body-start").json()
    assert body["source"] == "heading" and body["body_start"]["page"] == 4


def test_nothing_found_is_said_and_not_saved(client, db):
    assert client.get("/books/empty-pdf/body-start").json() == {"source": None, "body_start": None}
    assert row(db, "empty-pdf")["body_start"] is None


def test_the_readers_choice_wins_over_detection(client, db):
    client.get("/books/pdf-book/body-start")
    put = client.put("/books/pdf-book/body-start", json={"page": 5, "title": "Prologue"})
    assert put.status_code == 200
    assert put.json() == {"source": "user", "body_start": {
        "kind": "pdf", "page": 5, "title": "Prologue", "anchor": {"kind": "pdf", "page": 5, "quads": [[0, 0, 0, 0]], "text": ""}}}
    assert client.get("/books/pdf-book/body-start").json()["source"] == "user"
    assert row(db, "pdf-book")["body_start"]["page"] == 5


def test_an_epub_takes_a_spine_index(client, db):
    put = client.put("/books/epub-book/body-start", json={"spine_index": 1})
    assert put.json()["body_start"] == {"kind": "epub", "spine_index": 1, "title": None,
                                        "anchor": {"kind": "epub", "cfi": "epubcfi(/6/4!/4)", "text": ""}}


@pytest.mark.parametrize("book_id, body", [
    ("pdf-book", {"page": 41}), ("pdf-book", {"page": 0}), ("pdf-book", {"spine_index": 2}),
    ("epub-book", {"page": 3}), ("pdf-book", {}), ("pdf-book", {"page": 2, "spine_index": 1}),
    ("pdf-book", {"page": 2, "source": "outline"}), ("pdf-book", {"page": 2, "title": "x" * 201}),
])
def test_a_place_outside_the_book_or_of_the_wrong_kind_is_refused(client, db, book_id, body):
    assert client.put(f"/books/{book_id}/body-start", json=body).status_code == 422
    assert row(db, book_id)["body_start"] is None


def test_another_readers_book_is_not_found_and_not_changed(client, db):
    assert client.get("/books/theirs/body-start").status_code == 404
    assert client.put("/books/theirs/body-start", json={"page": 1}).status_code == 404
    assert row(db, "theirs")["body_start"] is None
