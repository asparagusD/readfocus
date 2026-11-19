"""GET /books/{id}/open and PUT /books/{id}/position (C26.4) on the in-memory database. No network."""

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import reading
from backend.tests.memory_db import MemoryDb
from backend.xp import badge_award

USER, OTHER, BOOK = "user-1", "user-2", "book-1"
PDF_PLACE = {"kind": "pdf", "page": 12, "quads": [[0, 0, 10, 10]], "text": "the"}
EPUB_PLACE = {"kind": "epub", "cfi": "epubcfi(/6/4!/4/2/1:0)", "text": ""}


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    fake.tables["books"] = [{"id": BOOK, "user_id": USER, "title": "SICP", "author": "Abelson", "file_type": "pdf",
                             "file_format": "pdf", "storage_mode": "cloud", "status": "ready", "total_chunks": 3,
                             "toc": [{"title": "1 Building", "page": 3}], "scanned_pages": None}]
    fake.tables["chunks"] = [{"id": f"c{i}", "book_id": BOOK, "chunk_index": i} for i in range(3)]
    monkeypatch.setattr(reading, "supabase", fake)
    return fake


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def badges(monkeypatch):
    calls = []
    monkeypatch.setattr(badge_award, "check_quietly", lambda *args, **kwargs: calls.append((args, kwargs)) or [])
    return calls


def test_a_first_open_makes_the_progress_row_and_has_no_place(client, db):
    opened = client.get(f"/books/{BOOK}/open")
    assert opened.status_code == 200
    assert opened.json() == {
        "book_id": BOOK, "status": "ready", "pages_only": False, "scanned_pages": [], "position": None, "text_only": False,
        "file": None,  # no stored file in this fixture (C34.3)
        "book": {"title": "SICP", "author": "Abelson", "toc": [{"title": "1 Building", "page": 3}], "format": "pdf",
                 "storage_mode": "cloud"}}
    [row] = db.tables["reading_progress"]
    assert {k: row[k] for k in ("user_id", "book_id", "last_chunk_index", "chunks_completed", "re_read_queue")} == {
        "user_id": USER, "book_id": BOOK, "last_chunk_index": -1, "chunks_completed": 0, "re_read_queue": []}
    client.get(f"/books/{BOOK}/open")
    assert len(db.tables["reading_progress"]) == 1  # a second open keeps the one row


def test_a_saved_place_comes_back_on_the_next_open(client, db, badges):
    saved = client.put(f"/books/{BOOK}/position", json={"anchor": PDF_PLACE})
    assert saved.status_code == 200 and saved.json() == {"position": {"anchor": PDF_PLACE}}
    later = {"anchor": {**PDF_PLACE, "page": 40}, "chunk_index": 2}
    assert client.put(f"/books/{BOOK}/position", json=later).status_code == 200
    assert client.get(f"/books/{BOOK}/open").json()["position"] == later
    assert len(db.tables["reading_progress"]) == 1  # the save made the row; the open used it


def test_every_save_asks_for_the_finished_book_badge(client, db, badges):
    client.put(f"/books/{BOOK}/position", json={"anchor": PDF_PLACE})
    assert badges == [((USER, "place"), {"book_id": BOOK, "anchor": PDF_PLACE})]


def test_a_book_still_being_read_opens_and_saves_its_place(client, db, badges):
    db.tables["books"][0].update(status="processing", total_chunks=None, toc=None)
    db.tables["chunks"] = []
    opened = client.get(f"/books/{BOOK}/open").json()
    assert opened["status"] == "processing" and opened["pages_only"] is False and opened["book"]["toc"] == []
    assert client.put(f"/books/{BOOK}/position", json={"anchor": PDF_PLACE}).status_code == 200
    assert db.tables["reading_progress"][0]["position"] == {"anchor": PDF_PLACE}


def test_a_book_read_on_the_device_opens_text_only(client, db):
    db.tables["books"][0].update(source_format="browser-text", storage_mode="device")
    assert client.get(f"/books/{BOOK}/open").json()["text_only"] is True


def test_a_scanned_book_with_no_text_opens_pages_only(client, db):
    db.tables["books"][0].update(scanned_pages=[1, 2], total_chunks=0)
    opened = client.get(f"/books/{BOOK}/open").json()
    assert opened["pages_only"] is True and opened["scanned_pages"] == [1, 2]


def test_an_epub_names_its_format_and_takes_an_epub_place(client, db, badges):
    db.tables["books"][0].update(file_type="epub", file_format="epub", storage_mode="device")
    assert client.get(f"/books/{BOOK}/open").json()["book"]["format"] == "epub"
    assert client.put(f"/books/{BOOK}/position", json={"anchor": EPUB_PLACE}).status_code == 200


@pytest.mark.parametrize("body", [
    {},  # no anchor
    {"chunk_index": 0},  # a chunk alone is no longer a place
    {"anchor": EPUB_PLACE},  # an EPUB place in a PDF
    {"anchor": PDF_PLACE, "chunk_index": 9},  # no such chunk
    {"anchor": PDF_PLACE, "block_id": "0.1"},  # C12's keys are not taken here
    {"anchor": {**PDF_PLACE, "page": 0}},
    {"anchor": {**PDF_PLACE, "quads": []}},
])
def test_a_malformed_place_is_refused_and_nothing_is_stored(client, db, badges, body):
    assert client.put(f"/books/{BOOK}/position", json=body).status_code == 422
    assert not any(row.get("position") for row in db.tables.get("reading_progress", []))
    assert badges == []


def test_another_readers_book_is_not_found_and_nothing_is_made(client, db, badges):
    db.tables["books"][0]["user_id"] = OTHER
    assert client.get(f"/books/{BOOK}/open").status_code == 404
    assert client.put(f"/books/{BOOK}/position", json={"anchor": PDF_PLACE}).status_code == 404
    assert db.tables.get("reading_progress", []) == [] and badges == []


def test_both_routes_need_a_signed_in_reader(db):
    plain = TestClient(app)
    assert plain.get(f"/books/{BOOK}/open").status_code in (401, 403)
    assert plain.put(f"/books/{BOOK}/position", json={"anchor": PDF_PLACE}).status_code in (401, 403)


def test_open_gives_the_files_signed_url_so_the_reader_need_not_ask_for_it(client, db):
    """C34.3 (issue 13): one round trip less before the reader starts on the file."""
    db.tables["books"][0].update(storage_path="user-1/book-1.pdf", file_sha256="ab12")
    opened = client.get(f"/books/{BOOK}/open").json()
    assert opened["file"] == {"url": "https://storage.test/sign/books/user-1/book-1.pdf?expires=3600",
                              "expires_in": 3600, "sha256": "ab12"}
    assert ("storage", "sign", "user-1/book-1.pdf", 3600) in db.calls


def test_a_second_open_gets_the_same_url_so_the_cdn_copy_is_reused(client, db):
    """C35.8a (issue 19): a new token is a CDN miss that fetches the whole file before its last bytes."""
    db.tables["books"][0].update(storage_path="user-1/book-1.pdf")
    first = client.get(f"/books/{BOOK}/open").json()["file"]
    second = client.get(f"/books/{BOOK}/open").json()["file"]
    assert second["url"] == first["url"]
    assert [call for call in db.calls if call[:2] == ("storage", "sign")] == [("storage", "sign", "user-1/book-1.pdf", 3600)]


def test_a_device_only_book_opens_with_no_file_url(client, db):
    db.tables["books"][0].update(storage_mode="device", storage_path=None)
    opened = client.get(f"/books/{BOOK}/open")
    assert opened.status_code == 200 and opened.json()["file"] is None
    assert not [call for call in db.calls if call[:2] == ("storage", "sign")]


def test_a_failed_signing_still_opens_the_book_without_a_url(client, db, monkeypatch):
    db.tables["books"][0].update(storage_path="user-1/book-1.pdf")

    def refuse(*args, **kwargs):
        raise RuntimeError("storage is down")

    monkeypatch.setattr(type(db.storage.from_("books")), "create_signed_url", refuse)
    opened = client.get(f"/books/{BOOK}/open")
    assert opened.status_code == 200
    assert opened.json()["file"] is None and opened.json()["book"]["title"] == "SICP"

