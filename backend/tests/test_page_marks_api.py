"""Page marks (C39.1, issue 23; docs/ANCHORS.md A12): GET/POST /books/{id}/marks, PATCH/DELETE /marks/{id} on the
in-memory database. Ink strokes and text boxes on a PDF page, PDF books only (D2); owner only, 404 otherwise; data
in PDF points inside the page's limits; the position (A4) set by the server from the page and the mark's top."""

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import page_marks
from backend.tests.memory_db import MemoryDb

USER, OTHER, BOOK, EPUB = "user-1", "user-2", "book-1", "book-epub"
STROKE = {"points": [[72.5, 140.2, 0.5], [80, 138.9, 0.6], [96.25, 150, 0.4]], "width": 2}
BOX = {"x": 300, "y": 412.7, "width": 180, "text": "See figure 3", "size": 12}


def ink(page=12, data=STROKE, color="ink"):
    return {"kind": "ink", "page": page, "color": color, "data": data}


def text(page=12, data=BOX, color="ocean"):
    return {"kind": "text", "page": page, "color": color, "data": data}


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [{"id": BOOK, "user_id": USER, "file_type": "pdf", "page_count": 40},
                          {"id": EPUB, "user_id": USER, "file_type": "epub"},
                          {"id": "theirs", "user_id": OTHER, "file_type": "pdf"},
                          {"id": "going", "user_id": USER, "file_type": "pdf", "status": "deleting"}]
    monkeypatch.setattr(page_marks, "supabase", db)
    return db


@pytest.fixture
def as_user():
    def switch(user):
        app.dependency_overrides[get_current_user] = lambda: user
    switch(USER)
    yield switch
    app.dependency_overrides.clear()


@pytest.fixture
def client(db, as_user):
    return TestClient(app)


def post(client, body, book=BOOK):
    return client.post(f"/books/{book}/marks", json=body)


def test_a_stroke_is_stored_with_its_page_points_width_and_position(client, db):
    response = post(client, ink())
    assert response.status_code == 201
    saved = response.json()
    assert saved["data"] == STROKE and saved["kind"] == "ink" and saved["color"] == "ink"
    assert saved["position"] == 12_013_800  # page 12, the line of its top (138.9), no x term
    (row,) = db.tables["page_marks"]
    assert row["user_id"] == USER and row["book_id"] == BOOK and row["page"] == 12


def test_a_text_box_is_stored_and_a_tap_is_a_dot(client):
    saved = post(client, text()).json()
    assert saved["data"] == BOX and saved["position"] == 12_041_200
    dot = post(client, ink(data={"points": [[10, 10, 1]], "width": 4})).json()
    assert dot["position"] == 12_001_000


def test_an_epub_takes_no_marks_and_a_missing_or_deleting_book_is_404(client, db):
    assert post(client, ink(), EPUB).status_code == 409  # D2: Draw and Add text are for PDFs
    assert client.get(f"/books/{EPUB}/marks").status_code == 409
    assert post(client, ink(), "nope").status_code == 404
    assert post(client, ink(), "going").status_code == 404
    assert client.get("/books/going/marks").status_code == 404
    assert db.tables.get("page_marks", []) == []


@pytest.mark.parametrize("body", [
    ink(color="honey"),                                                    # a highlight colour, not an ink
    ink(color="#000000"),                                                  # never hex (A8)
    {**ink(), "kind": "shape"},
    ink(page=0),
    ink(page=41),                                                          # past the book's last page
    ink(data={"points": [], "width": 2}),
    ink(data={"points": [[1, 2]], "width": 2}),                            # no pressure
    ink(data={"points": [[1, 2, 1.5]], "width": 2}),                       # pressure over 1
    ink(data={"points": [[-1, 2, 0.5]], "width": 2}),                      # off the page's top-left
    ink(data={"points": [[1, 10_000, 0.5]], "width": 2}),                  # beyond A4's line limit
    ink(data={"points": [[1, 2, 0.5]], "width": 0.1}),
    ink(data={"points": [[1, 2, 0.5]], "width": 25}),
    ink(data={"points": [[1, 2, 0.5]] * 2_001, "width": 2}),
    ink(data={**STROKE, "smooth": True}),                                  # unknown field
    ink(data=BOX),                                                         # a box's data for a stroke
    text(data=STROKE),
    text(data={**BOX, "text": "   "}),                                     # an empty box is deleted, not kept
    text(data={**BOX, "text": "x" * 2_001}),
    text(data={**BOX, "size": 5}),
    text(data={**BOX, "size": 73}),
    text(data={**BOX, "width": 10}),
    {**ink(), "user_id": OTHER},
])
def test_malformed_marks_are_refused_and_nothing_is_stored(client, db, body):
    assert post(client, body).status_code == 422
    assert db.tables.get("page_marks", []) == []


def test_every_ink_colour_is_accepted(client):
    for colour in ("ink", "poppy", "amber", "fern", "ocean", "berry", "plum"):
        assert post(client, ink(color=colour)).status_code == 201


def test_the_list_is_in_reading_order_and_filters_by_pages(client):
    for body in (text(page=14), ink(page=12), ink(page=13, data={"points": [[5, 700, 0.5]], "width": 1}),
                 ink(page=12, data={"points": [[5, 20, 0.5]], "width": 1})):
        assert post(client, body).status_code == 201
    every = client.get(f"/books/{BOOK}/marks").json()["marks"]
    assert [(m["page"], m["position"]) for m in every] == [(12, 12_002_000), (12, 12_013_800), (13, 13_070_000),
                                                         (14, 14_041_200)]
    pages = client.get(f"/books/{BOOK}/marks", params={"first": 13, "last": 14}).json()["marks"]
    assert [m["page"] for m in pages] == [13, 14]
    assert [m["page"] for m in client.get(f"/books/{BOOK}/marks", params={"last": 12}).json()["marks"]] == [12, 12]
    assert client.get(f"/books/{BOOK}/marks", params={"first": 5, "last": 4}).status_code == 422


def test_another_reader_never_sees_or_changes_them(client, db, as_user):
    made = post(client, ink()).json()
    as_user(OTHER)
    assert client.get(f"/books/{BOOK}/marks").status_code == 404
    assert client.patch(f"/marks/{made['id']}", json={"color": "poppy"}).status_code == 404
    assert client.delete(f"/marks/{made['id']}").status_code == 404
    assert post(client, ink()).status_code == 404
    as_user(USER)
    assert client.get("/books/theirs/marks").status_code == 404
    assert db.tables["page_marks"][0]["color"] == "ink" and len(db.tables["page_marks"]) == 1


def test_a_box_is_moved_retyped_and_restyled_and_its_position_follows(client, db):
    made = post(client, text()).json()
    moved = client.patch(f"/marks/{made['id']}", json={"data": {**BOX, "y": 90, "text": "See fig. 3", "size": 14}})
    assert moved.status_code == 200
    assert moved.json()["data"]["text"] == "See fig. 3" and moved.json()["position"] == 12_009_000
    recoloured = client.patch(f"/marks/{made['id']}", json={"color": "poppy"}).json()
    assert recoloured["color"] == "poppy" and recoloured["data"]["size"] == 14 and recoloured["updated_at"]
    assert recoloured["kind"] == "text" and recoloured["page"] == 12


@pytest.mark.parametrize("change", [
    {}, {"color": "honey"}, {"data": STROKE}, {"data": {**BOX, "text": ""}}, {"kind": "ink"}, {"page": 3},
])
def test_a_change_keeps_the_kind_and_page_and_checks_the_data(client, db, change):
    made = post(client, text()).json()
    assert client.patch(f"/marks/{made['id']}", json=change).status_code == 422
    assert db.tables["page_marks"][0]["data"] == BOX and db.tables["page_marks"][0]["color"] == "ocean"


def test_delete_removes_only_that_mark(client, db):
    first = post(client, ink()).json()
    post(client, text())
    assert client.delete(f"/marks/{first['id']}").status_code == 204
    assert [m["kind"] for m in db.tables["page_marks"]] == ["text"]
    assert client.delete(f"/marks/{first['id']}").status_code == 404
