"""DELETE /books/{id}: the book's original and its note pictures go with it (C25.1 fix, DEBUG_LOG 2026-11-16), and
since C35.2 (issue 18) the request only marks the book `deleting` and answers 202; the purge runs in the background,
and the ingestion sweep finishes any purge a restart cut short. Until the row is gone, no listing or lookup shows it.

Note files live at notes/<user>/<book>/<uuid>.<ext> (POST /books/{id}/note-files); the database cascade removes the
note rows, so the purge removes the folder, page by page, before the row. Another book's and another reader's files
stay; a storage failure is logged and the book is still deleted.
"""

import asyncio
import logging

import pytest
from fastapi import BackgroundTasks, HTTPException
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.services import book_purge, file_url, ingestion_worker
from backend.tests.memory_db import MemoryDb

USER, OTHER, BOOK, KEPT = "user-1", "user-2", "book-1", "book-2"


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [
        {"id": BOOK, "user_id": USER, "storage_path": f"{USER}/{BOOK}.pdf", "status": "ready", "storage_mode": "cloud",
         "file_bytes": 4},
        {"id": KEPT, "user_id": USER, "storage_path": None, "status": "ready"},
        {"id": "theirs", "user_id": OTHER, "storage_path": f"{OTHER}/theirs.pdf", "status": "ready"},
    ]
    db.files.update({
        f"{USER}/{BOOK}.pdf": b"%PDF",
        f"{USER}/{BOOK}/eq.webp": b"RIFF", f"{USER}/{BOOK}/drawing.png": b"PNG", f"{USER}/{BOOK}/thumb.webp": b"RIFF",
        f"{USER}/{KEPT}/other.png": b"PNG",
        f"{OTHER}/theirs.pdf": b"%PDF", f"{OTHER}/theirs/x.png": b"PNG",
    })
    for module in (books, book_purge):
        monkeypatch.setattr(module, "supabase", db)
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def ids(db):
    return [b["id"] for b in db.tables["books"]]


def test_delete_answers_at_once_without_touching_storage_or_the_cascade(db):
    tasks = BackgroundTasks()
    assert books.delete_book(BOOK, tasks, USER) == {"status": "deleting", "book_id": BOOK}
    assert ids(db) == [BOOK, KEPT, "theirs"] and db.tables["books"][0]["status"] == "deleting"
    assert not [c for c in db.calls if c[0] == "storage" or c == ("books", "delete")]
    assert [t.func for t in tasks.tasks] == [book_purge.purge]


def test_deleting_a_book_removes_its_note_pictures_and_keeps_everyone_elses(client, db):
    assert client.delete(f"/books/{BOOK}").status_code == 202  # the TestClient runs the purge before it returns
    assert sorted(db.files) == sorted([f"{OTHER}/theirs.pdf", f"{OTHER}/theirs/x.png", f"{USER}/{KEPT}/other.png"])
    assert ids(db) == [KEPT, "theirs"]
    removed = [c for c in db.calls if c[:3] == ("storage", "remove", "notes")]
    assert removed and all(p.startswith(f"{USER}/{BOOK}/") for c in removed for p in c[3])


def test_a_deleted_books_kept_signed_url_is_not_handed_out_again(client, db):
    """C35.8a: the purge forgets the book's reused signed URL."""
    file_url.signed_url(db.storage.from_("books"), f"{USER}/{BOOK}.pdf")
    assert client.delete(f"/books/{BOOK}").status_code == 202
    assert f"{USER}/{BOOK}.pdf" not in file_url._kept


def test_a_folder_longer_than_one_page_is_removed_whole(client, db, monkeypatch):
    monkeypatch.setattr(book_purge, "NOTE_FILES_PAGE", 2)
    db.files.update({f"{USER}/{BOOK}/n{i}.png": b"PNG" for i in range(5)})
    assert client.delete(f"/books/{BOOK}").status_code == 202
    assert not [p for p in db.files if p.startswith(f"{USER}/{BOOK}/")]


def test_another_readers_book_is_404_and_nothing_is_changed(client, db):
    before = (dict(db.files), [dict(b) for b in db.tables["books"]])
    assert client.delete("/books/theirs").status_code == 404
    assert (db.files, db.tables["books"]) == before


def test_a_book_already_being_deleted_is_404(db):
    db.tables["books"][0]["status"] = "deleting"
    with pytest.raises(HTTPException) as caught:
        books.delete_book(BOOK, BackgroundTasks(), USER)
    assert caught.value.status_code == 404


def test_a_storage_failure_is_logged_and_the_book_is_still_deleted(client, db, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise RuntimeError("storage down")
    monkeypatch.setattr(book_purge, "remove_note_files", broken)
    with caplog.at_level(logging.WARNING):
        assert client.delete(f"/books/{BOOK}").status_code == 202
    assert ids(db) == [KEPT, "theirs"]
    assert "note files were not all removed" in caplog.text


def test_a_remove_that_removes_nothing_stops_logs_and_still_deletes_the_book(client, db, monkeypatch, caplog):
    from backend.tests import memory_db
    monkeypatch.setattr(memory_db.Bucket, "remove", lambda self, paths: [])
    with caplog.at_level(logging.WARNING):
        assert client.delete(f"/books/{BOOK}").status_code == 202
    assert ids(db) == [KEPT, "theirs"]
    assert "note files were not all removed" in caplog.text
    assert sum(1 for c in db.calls if c[:3] == ("storage", "list", "notes")) == 1


def test_a_row_that_will_not_delete_stays_hidden_and_the_sweep_finishes_it(db, monkeypatch, caplog):
    books.delete_book(BOOK, BackgroundTasks(), USER)  # marked; the purge never ran (a restart)
    db.broken.add("books")
    with caplog.at_level(logging.WARNING):
        assert asyncio.run(ingestion_worker.purge_deleted()) == []  # never raises
    db.broken.discard("books")
    assert ids(db)[0] == BOOK and db.tables["books"][0]["status"] == "deleting"
    assert asyncio.run(ingestion_worker.purge_deleted()) == [BOOK]
    assert ids(db) == [KEPT, "theirs"]
    assert f"{USER}/{BOOK}.pdf" not in db.files and f"{OTHER}/theirs.pdf" in db.files


def test_purge_never_removes_a_book_that_is_not_being_deleted(db):
    assert book_purge.purge(BOOK, USER) is False
    assert ids(db) == [BOOK, KEPT, "theirs"] and f"{USER}/{BOOK}.pdf" in db.files
