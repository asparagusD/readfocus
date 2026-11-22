"""C35.2b (issue 18): a book being deleted is in no response. Until the background purge removes its row, every
owner's lookup passes through book_purge.live, so the book is off the shelf, out of the shelf space and 404 at every
endpoint that takes its id; and ingestion never marks it ready or failed, which would stop the purge.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import (
    annotations,
    books,
    device_books,
    focus,
    notes,
    ocr,
    page_marks,
    reading,
    steve_ask,
)
from backend.services import book_ingestor, book_purge
from backend.steve import context
from backend.tests.memory_db import MemoryDb

USER, BOOK, KEPT = "user-1", "book-1", "book-2"


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [
        {"id": BOOK, "user_id": USER, "storage_path": f"{USER}/{BOOK}.pdf", "status": "deleting",
         "storage_mode": "cloud", "file_bytes": 4},
        {"id": KEPT, "user_id": USER, "storage_path": None, "status": "ready"},
    ]
    for module in (books, book_purge, book_ingestor, annotations, notes, ocr, reading, focus, device_books, steve_ask,
                   context, page_marks):
        monkeypatch.setattr(module, "supabase", db)
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.mark.parametrize("method, path", [
    ("get", f"/books/{BOOK}"), ("get", f"/books/{BOOK}/file"), ("get", f"/books/{BOOK}/pages?start=0"),
    ("get", f"/books/{BOOK}/regions?first=1&last=1"), ("get", f"/books/{BOOK}/status"),
    ("post", f"/books/{BOOK}/resume"), ("get", f"/books/{BOOK}/body-start"), ("get", f"/books/{BOOK}/open"),
    ("get", f"/books/{BOOK}/ocr"), ("get", f"/books/{BOOK}/annotations"), ("get", f"/books/{BOOK}/notes"),
    ("get", f"/books/{BOOK}/marks"),
])
def test_a_book_being_deleted_is_not_found_anywhere(client, db, method, path):
    assert getattr(client, method)(path).status_code == 404


def test_a_book_being_deleted_is_off_the_shelf_and_out_of_the_shelf_space(client, db):
    assert [b["id"] for b in client.get("/books").json()] == [KEPT]
    assert books.shelf_bytes(USER) == 0


def test_a_book_being_deleted_is_closed_to_focus_steve_and_device_pages(db):
    for call in (lambda: focus._book(BOOK, USER), lambda: steve_ask._pdf_equation(USER, BOOK, "r1"),
                 lambda: device_books.store(USER, BOOK, None)):
        with pytest.raises(HTTPException) as caught:
            call()
        assert caught.value.status_code == 404
    with pytest.raises(context.ContextError):
        context._load(USER, BOOK, None)


def test_ingestion_never_marks_a_book_being_deleted_ready_or_failed(db, monkeypatch):
    monkeypatch.setattr(book_ingestor.processing_jobs, "fail", lambda job_id, error: None)
    book_ingestor.mark_ready(BOOK, 3, 900)
    book_ingestor._record_failure("job-1", BOOK, "boom", ready=False)
    assert db.tables["books"][0]["status"] == "deleting"
    db.tables["books"][1]["status"] = "processing"  # a live book is still marked as before
    book_ingestor.mark_ready(KEPT, 3, 900)
    assert db.tables["books"][1]["status"] == "ready"
    book_ingestor._record_failure("job-2", KEPT, "boom", ready=False)
    assert db.tables["books"][1]["status"] == "error"
