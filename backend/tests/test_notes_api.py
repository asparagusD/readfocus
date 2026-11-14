"""Note blocks (C22.1): GET/POST /books/{id}/notes, PATCH/DELETE /notes/{id}, POST /books/{id}/note-files on the
in-memory database. Owner only: another reader's book, note or file is 404 and never listed (migration 027's SELECT
policies are the second wall; RLS itself is checked statically in test_migrations.py, as pytest has no database).
Updates carry If-Match with the version they were made on; a stale one is 409 and changes nothing. Deleting sets
deleted_at; deleted notes are not listed and cannot be changed."""

import base64

import pytest
from fastapi.testclient import TestClient

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import notes
from backend.tests.memory_db import MemoryDb

USER, OTHER, BOOK, EPUB = "user-1", "user-2", "book-1", "book-epub"
PAGE_44 = {"kind": "pdf", "page": 44, "quads": [[72.5, 140.2, 500, 152]], "text": "the coefficients  measure"}
PAGE_45 = {"kind": "pdf", "page": 45, "quads": [[72, 60.3, 200, 72.8]], "text": "how much"}
SECTION = {"kind": "epub", "cfi": "epubcfi(/6/14!/4/2,/1:0,/3:25)", "text": "A range in section six"}
DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Fourier"}]}]}
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
WEBP = b"RIFF\x24\0\0\0WEBPVP8 " + b"\0" * 32


def note(anchors=(PAGE_44,), start=44_014_014, end=44_015_299, **change):
    body = {"kind": "text", "scope": "selection", "anchors": list(anchors), "position_start": start,
            "position_end": end, "content": DOC}
    return {**body, **change}


def view(pages=(44, 45)):
    """No selection: one point-free anchor per page shown, its quad the whole page, no text (ANCHORS D4)."""
    anchors = [{"kind": "pdf", "page": p, "quads": [[0, 0, 612, 792]], "text": ""} for p in pages]
    return note(anchors=anchors, start=pages[0] * 1_000_000, end=pages[-1] * 1_000_000 + 79_299, scope="view")


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [{"id": BOOK, "user_id": USER}, {"id": EPUB, "user_id": USER}, {"id": "theirs", "user_id": OTHER}]
    db.tables["annotations"] = [{"id": "hl-1", "user_id": USER, "book_id": BOOK}, {"id": "hl-2", "user_id": OTHER, "book_id": "theirs"}]
    db.tables["page_regions"] = [{"id": "rg-1", "user_id": USER, "book_id": BOOK}, {"id": "rg-2", "user_id": USER, "book_id": EPUB}]
    monkeypatch.setattr(notes, "supabase", db)
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
    return client.post(f"/books/{book}/notes", json=body)


def patch(client, note_id, body, version):
    headers = {} if version is None else {"If-Match": f'"{version}"'}
    return client.patch(f"/notes/{note_id}", json=body, headers=headers)


def listed(client, book=BOOK, **params):
    response = client.get(f"/books/{book}/notes", params=params)
    assert response.status_code == 200
    return response.json()["notes"]


def test_a_text_note_on_a_two_page_selection_is_stored_at_version_1(client, db):
    response = post(client, note(anchors=[PAGE_44, PAGE_45], end=45_007_299))
    assert response.status_code == 201
    saved = response.json()
    assert saved["version"] == 1 and response.headers["ETag"] == '"1"'
    assert saved["anchors"][0]["text"] == "the coefficients measure" and saved["anchors"][1]["page"] == 45
    assert saved["content"] == DOC and saved["scope"] == "selection" and saved["deleted_at"] is None
    (row,) = db.tables["note_blocks"]
    assert row["user_id"] == USER and row["book_id"] == BOOK and row["orphaned"] is False


def test_a_view_note_and_an_epub_note_are_stored(client):
    assert post(client, view()).status_code == 201
    assert post(client, view(pages=(44,))).status_code == 201
    epub = note(anchors=[SECTION], start=6_000_120, end=6_000_142, kind="code",
                content={"code": "x = 1", "language": "python"})
    assert post(client, epub, EPUB).status_code == 201


@pytest.mark.parametrize("change", [
    {"kind": "poem"},
    {"scope": "page"},
    {"anchors": []},
    {"anchors": [dict(PAGE_44, text="")]},                       # a selection covers text
    {"anchors": [PAGE_45, PAGE_44], "position_start": 45_006_000},  # pages out of reading order
    {"anchors": [PAGE_44, SECTION]},                             # kinds mixed
    {"position_start": 43_014_014},                              # page part is not the anchor's
    {"position_start": 44_015_014},                              # PDF line is not floor of the first quad's top
    {"content": {"type": "doc", "content": [{"type": "image"}]}},  # content outside the allow-list
    {"content": {"code": "x", "language": "python"}},            # content of another kind
    {"annotation_id": "hl-2"},                                   # another reader's highlight
    {"annotation_id": "nope"},
    {"region_id": "rg-2"},                                       # a region of another book
    {"thumbnail_path": "user-2/book-1/t.webp"},
    {"version": 7},                                              # the server owns the version
    {"user_id": OTHER},
])
def test_bad_notes_are_refused_and_nothing_is_stored(client, db, change):
    response = post(client, note(**change))
    assert response.status_code == 422, response.text
    assert db.tables.get("note_blocks", []) == []


def test_a_note_may_point_at_the_readers_highlight_and_region(client):
    saved = post(client, note(annotation_id="hl-1", region_id="rg-1", thumbnail_path=f"{USER}/{BOOK}/t.webp")).json()
    assert (saved["annotation_id"], saved["region_id"]) == ("hl-1", "rg-1")


def test_notes_are_listed_in_reading_order_then_creation_and_by_range(client, db):
    later = post(client, note(anchors=[PAGE_45], start=45_006_007, end=45_007_299)).json()
    page = post(client, view(pages=(44,))).json()
    first = post(client, note()).json()
    same_spot = post(client, note()).json()
    assert [n["id"] for n in listed(client)] == [page["id"], first["id"], same_spot["id"], later["id"]]
    # a range shows the notes overlapping it: page 45 alone, then page 44 alone
    assert [n["id"] for n in listed(client, **{"from": 45_000_000, "to": 45_999_999})] == [later["id"]]
    assert {n["id"] for n in listed(client, **{"from": 44_000_000, "to": 44_999_999})} == {page["id"], first["id"], same_spot["id"]}
    assert client.get(f"/books/{BOOK}/notes", params={"from": 5, "to": 4}).status_code == 422


def test_an_update_needs_the_current_version_and_bumps_it(client, db):
    saved = post(client, note()).json()
    edited = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Edited"}]}]}
    assert patch(client, saved["id"], {"content": edited}, None).status_code == 428
    first = patch(client, saved["id"], {"content": edited}, 1)
    assert first.status_code == 200 and first.json()["version"] == 2 and first.headers["ETag"] == '"2"'
    stale = patch(client, saved["id"], {"content": DOC}, 1)  # another tab, still on version 1
    assert stale.status_code == 409
    assert stale.json()["detail"] == {"message": "This note changed since you opened it", "version": 2}
    (row,) = db.tables["note_blocks"]
    assert row["content"] == edited and row["version"] == 2
    assert patch(client, saved["id"], {"content": DOC}, "W/2").status_code == 412  # not a version
    assert patch(client, saved["id"], {}, 2).status_code == 422


def test_an_update_may_re_anchor_flag_an_orphan_or_set_a_thumbnail(client, db):
    saved = post(client, note()).json()
    moved = patch(client, saved["id"], {"anchors": [PAGE_45], "position_start": 45_006_007,
                                        "position_end": 45_007_299}, 1)
    assert moved.status_code == 200 and moved.json()["anchors"][0]["page"] == 45
    assert patch(client, saved["id"], {"anchors": [PAGE_45]}, 2).status_code == 422  # anchors come with positions
    flagged = patch(client, saved["id"], {"orphaned": True, "thumbnail_path": f"{USER}/{BOOK}/t.webp"}, 2).json()
    assert flagged["orphaned"] is True and flagged["version"] == 3
    assert patch(client, saved["id"], {"kind": "code"}, 3).status_code == 422  # a block keeps its kind


def test_delete_is_soft_hides_the_note_and_freezes_it(client, db):
    saved = post(client, note()).json()
    assert client.delete(f"/notes/{saved['id']}").status_code == 204
    (row,) = db.tables["note_blocks"]
    assert row["deleted_at"] is not None and row["version"] == 2  # kept, so it can be restored
    assert listed(client) == []
    assert patch(client, saved["id"], {"content": DOC}, 2).status_code == 404
    assert client.delete(f"/notes/{saved['id']}").status_code == 404


def test_another_reader_sees_and_changes_nothing(client, db, as_user):
    saved = post(client, note()).json()
    as_user(OTHER)
    assert client.get(f"/books/{BOOK}/notes").status_code == 404
    assert post(client, note()).status_code == 404
    assert patch(client, saved["id"], {"content": DOC}, 1).status_code == 404
    assert client.delete(f"/notes/{saved['id']}").status_code == 404
    assert client.post(f"/books/{BOOK}/note-files", json={"content_type": "image/png", "data": base64.b64encode(PNG).decode()}).status_code == 404
    assert listed(client, "theirs") == []
    (row,) = db.tables["note_blocks"]
    assert row["version"] == 1 and row["deleted_at"] is None


def test_files_go_to_the_readers_folder_and_lists_sign_them(client, db):
    response = client.post(f"/books/{BOOK}/note-files",
                           json={"content_type": "image/webp", "data": base64.b64encode(WEBP).decode()})
    assert response.status_code == 201
    path = response.json()["path"]
    assert path.startswith(f"{USER}/{BOOK}/") and path.endswith(".webp") and db.files[path] == WEBP
    post(client, note(kind="equation", content={"latex": "a_n", "image_path": path}, thumbnail_path=path))
    (shown,) = listed(client)
    signed = f"https://storage.test/sign/notes/{path}?expires={policy.NOTE_FILE_URL_SECONDS}"
    assert shown["urls"] == {path: signed}


@pytest.mark.parametrize(("content_type", "data"), [
    ("image/gif", PNG),                       # not an allowed type
    ("image/png", WEBP),                      # bytes are not what the type says
    ("image/png", b"\x89PNG\r\n\x1a\n" + b"\0" * policy.NOTE_FILE_BYTES_MAX),
])
def test_bad_files_are_refused(client, db, content_type, data):
    body = {"content_type": content_type, "data": base64.b64encode(data).decode()}
    assert client.post(f"/books/{BOOK}/note-files", json=body).status_code == 422
    assert db.files == {}
