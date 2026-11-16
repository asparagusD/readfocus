"""DELETE /books/{id} (C25.1 fix, DEBUG_LOG 2026-11-16): the book's original and its note pictures go with it.

Note files live at notes/<user>/<book>/<uuid>.<ext> (POST /books/{id}/note-files); the database cascade removes the
note rows, so the handler removes the folder, page by page, before the row. Another book's and another reader's files
stay; a storage failure is logged and the book is still deleted.
"""

import logging

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.tests.memory_db import MemoryDb

USER, OTHER, BOOK, KEPT = "user-1", "user-2", "book-1", "book-2"


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [
        {"id": BOOK, "user_id": USER, "storage_path": f"{USER}/{BOOK}.pdf"},
        {"id": KEPT, "user_id": USER, "storage_path": None},
        {"id": "theirs", "user_id": OTHER, "storage_path": f"{OTHER}/theirs.pdf"},
    ]
    db.files.update({
        f"{USER}/{BOOK}.pdf": b"%PDF",
        f"{USER}/{BOOK}/eq.webp": b"RIFF", f"{USER}/{BOOK}/drawing.png": b"PNG", f"{USER}/{BOOK}/thumb.webp": b"RIFF",
        f"{USER}/{KEPT}/other.png": b"PNG",
        f"{OTHER}/theirs.pdf": b"%PDF", f"{OTHER}/theirs/x.png": b"PNG",
    })
    monkeypatch.setattr(books, "supabase", db)
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_deleting_a_book_removes_its_note_pictures_and_keeps_everyone_elses(client, db):
    assert client.delete(f"/books/{BOOK}").status_code == 200
    assert sorted(db.files) == sorted([f"{OTHER}/theirs.pdf", f"{OTHER}/theirs/x.png", f"{USER}/{KEPT}/other.png"])
    assert [b["id"] for b in db.tables["books"]] == [KEPT, "theirs"]
    removed = [c for c in db.calls if c[:3] == ("storage", "remove", "notes")]
    assert removed and all(p.startswith(f"{USER}/{BOOK}/") for c in removed for p in c[3])


def test_a_folder_longer_than_one_page_is_removed_whole(client, db, monkeypatch):
    monkeypatch.setattr(books, "NOTE_FILES_PAGE", 2)
    db.files.update({f"{USER}/{BOOK}/n{i}.png": b"PNG" for i in range(5)})
    assert client.delete(f"/books/{BOOK}").status_code == 200
    assert not [p for p in db.files if p.startswith(f"{USER}/{BOOK}/")]


def test_another_readers_book_is_404_and_nothing_is_removed(client, db):
    before = dict(db.files)
    assert client.delete("/books/theirs").status_code == 404
    assert db.files == before


def test_a_storage_failure_is_logged_and_the_book_is_still_deleted(client, db, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise RuntimeError("storage down")
    monkeypatch.setattr(books, "_remove_note_files", broken)
    with caplog.at_level(logging.WARNING):
        assert client.delete(f"/books/{BOOK}").status_code == 200
    assert [b["id"] for b in db.tables["books"]] == [KEPT, "theirs"]
    assert "note files were not all removed" in caplog.text


def test_a_remove_that_removes_nothing_stops_logs_and_still_deletes_the_book(client, db, monkeypatch, caplog):
    from backend.tests import memory_db
    monkeypatch.setattr(memory_db.Bucket, "remove", lambda self, paths: [])
    with caplog.at_level(logging.WARNING):
        assert client.delete(f"/books/{BOOK}").status_code == 200
    assert [b["id"] for b in db.tables["books"]] == [KEPT, "theirs"]
    assert "note files were not all removed" in caplog.text
    assert sum(1 for c in db.calls if c[:3] == ("storage", "list", "notes")) == 1
