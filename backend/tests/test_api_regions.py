"""GET /books/{id}/regions (C18.6d): the boxes word lookup skips on PDF pages, owner only, a few pages at a time;
since C20.8 each with its region id, and GET /books/{id}/regions/{region_id} and /books/{id}/region-at for one
region's details (the block actions: copy code, explain, copy as LaTeX)."""

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
        {"id": "r-block", "book_id": BOOK, "page": 2, "kind": "block", "bbox": [50, 100, 500, 140], "text": "Here x is",
         "order_in_page": 0, "meta": {"inline_boxes": [[80, 100, 90, 112]], "inline_drawn": [[95, 120, 99, 130]]}},
        {"id": "r-math", "book_id": BOOK, "page": 2, "kind": "math", "bbox": [100, 150, 300, 170], "text": "E=IR",
         "order_in_page": 1, "meta": {"display": True, "equation_number": "3.2", "drawn": True, "fonts": ["CMMI10"]}},
        {"id": "r-code", "book_id": BOOK, "page": 3, "kind": "code", "bbox": [60, 50, 400, 90],
         "text": "def f(x):\n    return  x", "order_in_page": 0, "meta": {"language_guess": "python"}},
        {"id": "r-fig", "book_id": BOOK, "page": 9, "kind": "figure", "bbox": [0, 0, 10, 10], "text": "", "order_in_page": 0,
         "meta": {"caption": "Figure 1: A tide table", "label": "Figure 1"}},
        {"id": "r-epub", "book_id": BOOK, "page": None, "spine_index": 0, "kind": "code", "bbox": None, "text": "x",
         "order_in_page": 0, "meta": {}, "anchor": {"kind": "epub", "spine_index": 0, "path": "/4/6", "cfi": "epubcfi(/6/2!/4/6)"}},
        {"id": "r-theirs", "book_id": "theirs", "page": 1, "kind": "code", "bbox": [0, 0, 1, 1], "text": "secret",
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
        {"page": 2, "kind": "math", "bbox": [80, 100, 90, 112], "id": "r-block", "inline": True},
        {"page": 2, "kind": "math", "bbox": [95, 120, 99, 130], "id": "r-block", "inline": True},
        {"page": 2, "kind": "math", "bbox": [100, 150, 300, 170], "id": "r-math", "inline": False},
        {"page": 3, "kind": "code", "bbox": [60, 50, 400, 90], "id": "r-code", "inline": False},
    ]}


def test_another_readers_book_is_not_found(client):
    assert client.get("/books/theirs/regions", params={"first": 1, "last": 2}).status_code == 404


@pytest.mark.parametrize("params", [{"first": 3, "last": 2}, {"first": 1, "last": 21}, {"first": 0, "last": 1}])
def test_a_bad_or_too_long_range_is_refused(client, params):
    assert client.get(f"/books/{BOOK}/regions", params=params).status_code == 422


# --- one region's details (C20.8) ---------------------------------------------------------------------------

def test_a_code_region_comes_with_its_exact_text_and_language(client):
    body = client.get(f"/books/{BOOK}/regions/r-code").json()
    assert body == {"id": "r-code", "kind": "code", "page": 3, "spine_index": None, "bbox": [60, 50, 400, 90],
                    "text": "def f(x):\n    return  x", "language": "python", "caption": None, "label": None,
                    "alt": None, "latex": None, "mathml": None, "equation_number": None}


def test_a_figure_and_a_drawn_equation_say_only_what_the_actions_need(client):
    figure = client.get(f"/books/{BOOK}/regions/r-fig").json()
    assert (figure["caption"], figure["label"], figure["text"]) == ("Figure 1: A tide table", "Figure 1", "")
    math = client.get(f"/books/{BOOK}/regions/r-math").json()
    assert math["equation_number"] == "3.2" and "fonts" not in math and math["latex"] is None


def test_an_epub_region_is_found_by_its_section_and_path(client):
    body = client.get(f"/books/{BOOK}/region-at", params={"spine_index": 0, "path": "/4/6"}).json()
    assert body["id"] == "r-epub" and body["kind"] == "code"
    assert client.get(f"/books/{BOOK}/region-at", params={"spine_index": 0, "path": "/4/8"}).status_code == 404


@pytest.mark.parametrize("url", [f"/books/{BOOK}/regions/r-theirs", f"/books/{BOOK}/regions/nope",
                                 "/books/theirs/regions/r-theirs"])
def test_another_readers_region_is_not_found(client, url):
    response = client.get(url)
    assert response.status_code == 404 and "secret" not in response.text


def test_a_bad_path_is_refused(client):
    assert client.get(f"/books/{BOOK}/region-at", params={"spine_index": 0, "path": "/4/x"}).status_code == 422
