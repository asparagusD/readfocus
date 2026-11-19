"""C35.3a (issue 16): a PDF or EPUB goes straight to Storage. POST /books/upload-url checks the type, the size and
the shelf, then signs an upload to the reader's own path; POST /books/register checks what arrived (there, at most
50 MB, a PDF or EPUB by its first bytes, room on the shelf; a refused file is removed) and writes the row and the
job, which works out the hash, page count and author. Markdown, notebooks and device-only books keep /upload.
"""

import asyncio
import hashlib
import io
import uuid

import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.services import book_ingestor, book_purge, direct_upload, ingestion_worker
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
BOOK = str(uuid.UUID(int=7))


def pdf_bytes(pages=2):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    writer.add_metadata({"/Author": "  Mary   Shelley "})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


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


def register(client, file_type="pdf", **extra):
    return client.post("/books/register", json={"book_id": BOOK, "file_type": file_type, "title": "Frankenstein",
                                                **extra})


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


def test_register_writes_the_row_and_the_job_and_the_job_adds_the_files_facts(client, db, monkeypatch):
    data = pdf_bytes()
    db.files[f"{USER}/{BOOK}.pdf"] = data
    started = []
    monkeypatch.setattr(ingestion_worker, "run", lambda job, file_bytes=None: started.append((job, file_bytes)))
    resp = register(client)
    assert resp.status_code == 200
    assert resp.json() == {"book_id": BOOK, "status": "processing", "source_format": None, "notes": [], "author": None}
    row = db.tables["books"][0]
    assert {k: row[k] for k in ("user_id", "storage_path", "file_bytes", "file_sha256", "page_count", "storage_mode",
                                "status")} == {"user_id": USER, "storage_path": f"{USER}/{BOOK}.pdf",
                                               "file_bytes": len(data), "file_sha256": None, "page_count": None,
                                               "storage_mode": "cloud", "status": "processing"}
    assert [(job["book_id"], file_bytes) for job, file_bytes in started] == [(BOOK, None)]  # the job reads Storage
    book = book_ingestor.record_file_facts(book_ingestor._load_book(BOOK), data)
    row = db.tables["books"][0]
    assert row["file_sha256"] == hashlib.sha256(data).hexdigest() and row["page_count"] == 2
    assert row["author"] == book["author"] == "Mary Shelley"


def test_a_typed_author_is_kept_and_not_replaced_by_the_files(client, db, monkeypatch):
    db.files[f"{USER}/{BOOK}.pdf"] = pdf_bytes()
    monkeypatch.setattr(ingestion_worker, "run", lambda job, file_bytes=None: None)
    assert register(client, author="  M.  Shelley ").json()["author"] == "M. Shelley"
    book_ingestor.record_file_facts(book_ingestor._load_book(BOOK), db.files[f"{USER}/{BOOK}.pdf"])
    assert db.tables["books"][0]["author"] == "M. Shelley"


def test_a_missing_upload_is_404_and_nothing_is_written(client, db):
    assert register(client).status_code == 404
    assert db.tables["books"] == []


def test_an_oversize_file_is_removed(client, db, monkeypatch):
    monkeypatch.setattr(policy, "MAX_BOOK_FILE_BYTES", 10)
    db.files[f"{USER}/{BOOK}.pdf"] = b"%PDF-" + b"x" * 20
    assert register(client).status_code == 413
    assert db.files == {} and db.tables["books"] == []


@pytest.mark.parametrize("file_type, head", [("pdf", b"PK\x03\x04rest"), ("epub", b"%PDF-1.7"), ("pdf", b"<html>")])
def test_a_file_that_is_not_its_type_is_removed(client, db, file_type, head):
    db.files[f"{USER}/{BOOK}.{file_type}"] = head
    resp = register(client, file_type=file_type)
    assert resp.status_code == 400 and file_type.upper() in resp.json()["detail"]
    assert db.files == {} and db.tables["books"] == []


def test_a_file_that_overfills_the_shelf_is_removed(client, db):
    db.tables["books"] = [{"id": "old", "user_id": USER, "storage_mode": "cloud", "status": "ready",
                           "file_bytes": policy.MAX_SHELF_BYTES_PER_USER - 3}]
    db.files[f"{USER}/{BOOK}.epub"] = b"PK\x03\x04mimetype"
    assert register(client, file_type="epub").status_code == 413
    assert db.files == {} and [b["id"] for b in db.tables["books"]] == ["old"]


def test_register_reads_only_the_callers_own_path(client, db):
    db.files[f"{OTHER}/{BOOK}.pdf"] = pdf_bytes()  # another reader's upload under the same id
    assert register(client).status_code == 404
    assert f"{OTHER}/{BOOK}.pdf" in db.files and db.tables["books"] == []


def test_a_book_id_already_on_a_shelf_is_409(client, db):
    db.tables["books"] = [{"id": BOOK, "user_id": OTHER, "status": "ready"}]
    db.files[f"{USER}/{BOOK}.pdf"] = pdf_bytes()
    assert register(client).status_code == 409
    assert f"{USER}/{BOOK}.pdf" in db.files


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


def test_the_job_adds_the_facts_before_it_parses(db, monkeypatch):
    data = pdf_bytes(3)
    db.files[f"{USER}/{BOOK}.pdf"] = data
    db.tables["books"] = [{"id": BOOK, "user_id": USER, "file_type": "pdf", "storage_path": f"{USER}/{BOOK}.pdf",
                           "status": "processing", "title": "F", "author": None, "file_sha256": None}]
    seen = []
    monkeypatch.setattr(book_ingestor, "read_pages", lambda book, file_bytes, browser: seen.append(book) or 1 / 0)
    monkeypatch.setattr(book_ingestor.processing_jobs, "fail", lambda job_id, error: None)
    asyncio.run(book_ingestor.run_job({"id": "j", "book_id": BOOK, "user_id": USER, "cursor": 0}))
    assert seen[0]["file_sha256"] == hashlib.sha256(data).hexdigest()
    assert db.tables["books"][0]["page_count"] == 3


def test_the_upload_url_and_register_answer_without_background_work_of_their_own(db):
    db.files[f"{USER}/{BOOK}.pdf"] = pdf_bytes()
    tasks = BackgroundTasks()
    books.register_upload(books.RegisterRequest(book_id=BOOK, file_type="pdf", title="F"), tasks, USER)
    assert [t.func for t in tasks.tasks] == [ingestion_worker.run]
    assert not [c for c in db.calls if c[:2] == ("storage", "download")]  # never the whole file on the request
