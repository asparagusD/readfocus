"""GET /books/{id}/regions (C18.6d): the boxes word lookup skips on PDF pages, owner only, a few pages at a time."""

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
    db.tables["books"] = [{"id": BOOK, "user_id": USER}, {"id": "theirs", "user_id": OTHER}]
    db.tables["page_regions"] = [
        {"book_id": BOOK, "page": 2, "kind": "block", "bbox": [50, 100, 500, 140], "text": "Here x is",
         "order_in_page": 0, "meta": {"inline_boxes": [[80, 100, 90, 112]], "inline_drawn": [[95, 120, 99, 130]]}},
        {"book_id": BOOK, "page": 2, "kind": "math", "bbox": [100, 150, 300, 170], "text": "E=IR", "order_in_page": 1,
         "meta": {}},
        {"book_id": BOOK, "page": 3, "kind": "code", "bbox": [60, 50, 400, 90], "text": "(f)", "order_in_page": 0,
         "meta": {}},
        {"book_id": BOOK, "page": 9, "kind": "figure", "bbox": [0, 0, 10, 10], "text": "", "order_in_page": 0,
         "meta": {}},
        {"book_id": BOOK, "page": None, "spine_index": 0, "kind": "code", "bbox": None, "text": "x",
         "order_in_page": 0, "meta": {}},
    ]
    monkeypatch.setattr(books, "supabase", db)
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_non_prose_boxes_and_inline_math_come_back_for_the_pages_asked(client):
    response = client.get(f"/books/{BOOK}/regions", params={"first": 1, "last": 3})
    assert response.status_code == 200
    assert response.json() == {"regions": [
        {"page": 2, "kind": "math", "bbox": [80, 100, 90, 112]},
        {"page": 2, "kind": "math", "bbox": [95, 120, 99, 130]},
        {"page": 2, "kind": "math", "bbox": [100, 150, 300, 170]},
        {"page": 3, "kind": "code", "bbox": [60, 50, 400, 90]},
    ]}


def test_another_readers_book_is_not_found(client):
    assert client.get("/books/theirs/regions", params={"first": 1, "last": 2}).status_code == 404


@pytest.mark.parametrize("params", [{"first": 3, "last": 2}, {"first": 1, "last": 21}, {"first": 0, "last": 1}])
def test_a_bad_or_too_long_range_is_refused(client, params):
    assert client.get(f"/books/{BOOK}/regions", params=params).status_code == 422
