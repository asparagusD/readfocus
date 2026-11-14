"""Annotations (C21.1, docs/ANCHORS.md): GET/POST /books/{id}/annotations, PATCH/DELETE /annotations/{id} on the
in-memory database. Owner only: another reader's book or annotation is 404 and never listed (migration 026's
SELECT policy is the second wall). Anchors are checked against A1/A2 and positions against A4."""

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import annotations
from backend.tests.memory_db import MemoryDb

USER, OTHER, BOOK, EPUB = "user-1", "user-2", "book-1", "book-epub"
PAGE_12 = {"kind": "pdf", "page": 12, "quads": [[72.5, 140.2, 500, 152], [72, 154, 300.4, 166.9]], "text": "The tide  turns"}
PAGE_13 = {"kind": "pdf", "page": 13, "quads": [[72, 60.3, 200, 72.8]], "text": "at noon."}
SECTION = {"kind": "epub", "cfi": "epubcfi(/6/14!/4/2,/1:0,/3:25)", "text": "A range in section six"}


def pdf_body(anchors=(PAGE_12,), start=12_014_014, end=12_016_660):
    """A4: page * 1e6 + floor(y) * 1e2 + an x term; start from the first quad's top, end from the last quad's bottom."""
    return {"anchors": list(anchors), "style": "highlight", "color": "honey", "position_start": start,
            "position_end": end}


def epub_body(cfi=SECTION["cfi"], start=6_000_120, end=6_000_142):
    return {"anchors": [dict(SECTION, cfi=cfi)], "style": "underline", "color": "lilac", "position_start": start,
            "position_end": end}


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [{"id": BOOK, "user_id": USER}, {"id": EPUB, "user_id": USER}, {"id": "theirs", "user_id": OTHER}]
    monkeypatch.setattr(annotations, "supabase", db)
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
    return client.post(f"/books/{book}/annotations", json=body)


def test_a_highlight_across_two_pages_is_stored_with_anchors_positions_and_text(client, db):
    response = post(client, pdf_body(anchors=[PAGE_12, PAGE_13], end=13_007_241))
    assert response.status_code == 201
    saved = response.json()
    assert saved["anchors"][0]["text"] == "The tide turns" and saved["anchors"][1]["page"] == 13  # A2 normalised
    assert saved["text_snapshot"] == "The tide turns at noon."
    assert (saved["position_start"], saved["position_end"]) == (12_014_014, 13_007_241)
    (row,) = db.tables["annotations"]
    assert row["user_id"] == USER and row["book_id"] == BOOK and row["orphaned"] is False


def test_an_epub_range_is_stored(client):
    assert post(client, epub_body(), EPUB).status_code == 201


@pytest.mark.parametrize("change", [
    {"color": "amber"},                                         # not a palette name
    {"style": "strikethrough"},
    {"anchors": []},
    {"anchors": [dict(PAGE_12, text="")]},                      # a point, not a range (A3)
    {"anchors": [dict(PAGE_12, quads=[[500, 140, 72, 152]])]},  # x0 > x1
    {"anchors": [PAGE_13, PAGE_12], "position_start": 13_006_000},  # pages out of reading order
    {"anchors": [PAGE_12, PAGE_12]},                            # one anchor per page (A2)
    {"anchors": [PAGE_12, SECTION]},                            # kinds mixed
    {"anchors": [dict(PAGE_12, extra=1)]},
    {"position_start": 11_014_014},                             # page part is not the first anchor's page
    {"position_start": 12_020_014},                             # y part is not floor(y0) of the first quad
    {"position_start": 12_014_014.5},                           # not an integer
    {"position_end": 12_000_000},                               # end before start
    {"position_end": 14_016_600},                               # end's page is not the last anchor's
    {"position_end": 12_015_200},                               # end's y part is not the last quad's bottom
])
def test_malformed_annotations_are_refused_and_nothing_is_stored(client, db, change):
    assert post(client, {**pdf_body(), **change}).status_code == 422
    assert db.tables.get("annotations", []) == []


@pytest.mark.parametrize("cfi", ["epubcfi(/6/14!/4/2/1:0)", "epubcfi(/6!/4,/1:0,/3:2)", "not a cfi"])
def test_an_epub_anchor_must_be_a_range_in_one_spine_item(client, db, cfi):
    assert post(client, epub_body(cfi=cfi), EPUB).status_code == 422


def test_the_spine_part_of_an_epub_position_must_match_the_cfi(client):
    assert post(client, epub_body(start=5_000_120), EPUB).status_code == 422
    assert post(client, epub_body(end=7_000_000), EPUB).status_code == 422


def test_the_list_is_in_reading_order_and_filters_by_overlapping_position_range(client):
    page_13 = dict(PAGE_13)                                                      # 13_006_000 .. 13_007_200
    page_12 = dict(PAGE_12)                                                      # 12_014_000 .. 12_016_600
    across = [dict(PAGE_12, quads=[[72, 500, 300, 512]]), dict(PAGE_13, quads=[[72, 0, 90, 10]])]  # 12_050_000 .. 13_001_000
    for anchors, start, end in (([page_13], 13_006_000, 13_007_200), ([page_12], 12_014_000, 12_016_600),
                                (across, 12_050_000, 13_001_000)):
        assert post(client, pdf_body(anchors=anchors, start=start, end=end)).status_code == 201
    every = client.get(f"/books/{BOOK}/annotations").json()["annotations"]
    assert [a["position_start"] for a in every] == [12_014_000, 12_050_000, 13_006_000]
    on_13 = client.get(f"/books/{BOOK}/annotations", params={"from": 13_000_000, "to": 13_999_999}).json()
    assert [a["position_start"] for a in on_13["annotations"]] == [12_050_000, 13_006_000]  # the overlap counts
    assert client.get(f"/books/{BOOK}/annotations", params={"from": 14_000_000}).json() == {"annotations": []}
    assert client.get(f"/books/{BOOK}/annotations", params={"from": 5, "to": 4}).status_code == 422


def test_another_reader_never_sees_or_changes_them(client, db, as_user):
    made = post(client, pdf_body()).json()
    as_user(OTHER)
    assert client.get(f"/books/{BOOK}/annotations").status_code == 404
    assert client.patch(f"/annotations/{made['id']}", json={"color": "rose"}).status_code == 404
    assert client.delete(f"/annotations/{made['id']}").status_code == 404
    assert post(client, pdf_body()).status_code == 404
    db.tables["annotations"].append(dict(made, id="theirs-1", book_id="theirs", user_id=OTHER))
    as_user(USER)
    assert client.get("/books/theirs/annotations").status_code == 404
    assert [a["id"] for a in client.get(f"/books/{BOOK}/annotations").json()["annotations"]] == [made["id"]]
    assert db.tables["annotations"][0]["color"] == "honey" and len(db.tables["annotations"]) == 2


def test_style_and_colour_change_and_nothing_else(client, db):
    made = post(client, pdf_body()).json()
    changed = client.patch(f"/annotations/{made['id']}", json={"color": "sage", "style": "underline"})
    assert changed.status_code == 200
    assert (changed.json()["color"], changed.json()["style"]) == ("sage", "underline")
    assert changed.json()["anchors"] == made["anchors"] and changed.json()["updated_at"]
    for bad in ({}, {"color": "amber"}, {"anchors": []}, {"position_start": 1}):
        assert client.patch(f"/annotations/{made['id']}", json=bad).status_code == 422
    assert db.tables["annotations"][0]["color"] == "sage"


def test_delete_removes_only_that_annotation(client, db):
    first = post(client, pdf_body()).json()
    post(client, pdf_body(start=12_014_015))
    assert client.delete(f"/annotations/{first['id']}").status_code == 204
    assert [a["position_start"] for a in db.tables["annotations"]] == [12_014_015]
    assert client.delete(f"/annotations/{first['id']}").status_code == 404
