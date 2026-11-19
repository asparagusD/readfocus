"""C35.3a (issue 16): a PDF or EPUB goes straight to Storage. POST /books/upload-url checks the type, the size and
the shelf, then signs an upload to the reader's own path. Registering what arrived is C35.3b. Markdown, notebooks
and device-only books keep /upload.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.services import book_ingestor, book_purge, direct_upload
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
BOOK = str(uuid.UUID(int=7))


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = []
    for module in (books, book_purge, direct_upload, jobs, book_ingestor):
        monkeypatch.setattr(module, "supabase", db)
    monkeypatch.setattr(direct_upload, "first_bytes", lambda path, count=direct_upload.HEAD_BYTES: db.files[path][:count])
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_upload_url_signs_the_readers_own_path(client, db):
    resp = client.post("/books/upload-url", json={"filename": "Frankenstein.PDF", "size": 1000})
    assert resp.status_code == 200
    body = resp.json()
    uuid.UUID(body["book_id"])
    assert body["file_type"] == "pdf" and body["max_bytes"] == policy.MAX_BOOK_FILE_BYTES
    assert ("storage", "sign-upload", f"{USER}/{body['book_id']}.pdf") in db.calls
    assert body["upload_url"].endswith(f"token={body['token']}")
    assert db.tables["books"] == []  # nothing is written until the file has arrived


@pytest.mark.parametrize("payload, status", [
    ({"filename": "notes.md", "size": 10}, 400),  # converted on the server: /upload
    ({"filename": "book.docx", "size": 10}, 400),
    ({"filename": "big.pdf", "size": policy.MAX_BOOK_FILE_BYTES + 1}, 413),
    ({"filename": "empty.pdf", "size": 0}, 422),
])
def test_upload_url_refuses_what_cannot_be_a_book(client, db, payload, status):
    assert client.post("/books/upload-url", json=payload).status_code == status
    assert not [c for c in db.calls if c[:2] == ("storage", "sign-upload")]


def test_upload_url_refuses_when_the_shelf_is_full(client, db):
    db.tables["books"] = [{"id": "old", "user_id": USER, "storage_mode": "cloud", "status": "ready",
                           "file_bytes": policy.MAX_SHELF_BYTES_PER_USER - 10}]
    resp = client.post("/books/upload-url", json={"filename": "a.epub", "size": 11})
    assert resp.status_code == 413 and "shelf is full" in resp.json()["detail"]


def test_the_first_bytes_are_one_range_request(monkeypatch, db):
    db.files[f"{USER}/{BOOK}.pdf"] = b"%PDF-1.7"
    monkeypatch.undo()  # the real first_bytes, with httpx answered here
    monkeypatch.setattr(direct_upload, "supabase", db)
    seen = []

    class Response:
        content = b"%PDF-1.7 and more"

        def raise_for_status(self):
            return None

    monkeypatch.setattr(direct_upload.httpx, "get", lambda url, headers, timeout: seen.append(headers) or Response())
    assert direct_upload.first_bytes(f"{USER}/{BOOK}.pdf") == b"%PDF-1.7"
    assert seen == [{"Range": "bytes=0-7"}]
