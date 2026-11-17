"""Books over 50 MB kept on the device (C26.7): POST /books/device, POST /books/{id}/pages and ingestion from the
text the browser sent. In-memory database, a fake embedder and question agent; no file is ever sent or read."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.main import app
from backend.nlp import embedder
from backend.routers import books, device_books
from backend.services import (
    book_ingestor,
    covers,
    ingestion_worker,
    ocr_pages,
    region_job,
)
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
SHA = "a" * 64
BIG = policy.MAX_BOOK_FILE_BYTES + 1


def page_text(n: int) -> str:
    return f"Page {n} begins. " + " ".join(f"word{n}x{i}" for i in range(250)) + "."


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    for module in (book_ingestor, jobs, ingestion_worker, books, device_books, ocr_pages):
        monkeypatch.setattr(module, "supabase", fake)
    monkeypatch.setattr(embedder, "embed", lambda texts: np.zeros((len(texts), embedder.EMBEDDING_DIM), dtype=np.float32))
    monkeypatch.setattr(book_ingestor.question_agent, "run", lambda book_id, chunk_ids: None)
    monkeypatch.setattr(covers, "ensure_cover", lambda *args: None)
    regions = []

    async def after_ingest(book, file_bytes=None):  # must not be reached: there is no file for a region map
        regions.append(book["id"])

    monkeypatch.setattr(region_job, "after_ingest", after_ingest)
    fake.regions = regions
    return fake


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def create(client, **over):
    body = {"title": "Atlas", "author": "A. Maker", "file_type": "pdf", "file_bytes": BIG, "sha256": SHA,
            "page_count": 120, **over}
    return client.post("/books/device", json=body)


def send(client, book_id, first, texts, last=False):
    return client.post(f"/books/{book_id}/pages", json={"first": first, "texts": texts, "last": last})


def test_a_device_book_is_made_with_no_file(client, db):
    made = create(client)
    assert made.status_code == 200
    body = made.json()
    assert body["status"] == "processing" and body["pages_per_batch"] == policy.BROWSER_TEXT_PAGES_PER_BATCH
    (row,) = db.tables["books"]
    assert row["id"] == body["book_id"] and row["user_id"] == USER
    assert {k: row[k] for k in ("storage_mode", "storage_path", "source_format", "file_bytes", "status")} == {
        "storage_mode": "device", "storage_path": None, "source_format": "browser-text", "file_bytes": BIG,
        "status": "processing"}
    assert db.files == {}  # nothing in Storage


@pytest.mark.parametrize("over", [
    {"file_bytes": policy.MAX_BOOK_FILE_BYTES},  # 50 MB or less goes through /books/upload
    {"file_bytes": policy.MAX_DEVICE_BOOK_FILE_BYTES + 1},  # over the 300 MB cap
    {"sha256": "not-a-hash"},
    {"file_type": "md"},  # a Markdown book is converted on the server
    {"title": ""},
    {"page_count": policy.BROWSER_TEXT_MAX_PAGES + 1},
    {"storage_path": "x"},
])
def test_a_bad_device_book_is_refused_and_nothing_is_made(client, db, over):
    assert create(client, **over).status_code == 422
    assert db.tables.get("books", []) == []


def test_the_text_comes_in_batches_and_the_last_one_starts_ingestion(client, db):
    book_id = create(client).json()["book_id"]
    first = send(client, book_id, 1, [page_text(n) for n in range(1, 51)])
    assert first.json() == {"received": 50, "through": 50, "ingesting": False}
    assert jobs.get(book_id) is None and db.tables["books"][0]["status"] == "processing"
    last = send(client, book_id, 51, [page_text(n) for n in range(51, 61)], last=True)
    assert last.json() == {"received": 10, "through": 60, "ingesting": True}
    stored = sorted(db.tables["page_ocr"], key=lambda r: r["page"])
    assert [r["page"] for r in stored] == list(range(1, 61)) and {r["engine"] for r in stored} == {"browser"}
    book = db.tables["books"][0]
    assert book["status"] == "ready" and book["total_chunks"] > 0
    assert jobs.get(book_id)["status"] == "done"
    chunks = sorted(db.tables["chunks"], key=lambda c: c["chunk_index"])
    assert chunks[0]["content"].startswith("Page 1 begins.") and "word60x249" in chunks[-1]["content"]
    assert db.regions == []  # no file, so no region map


def test_pages_are_read_in_page_order_and_empty_pages_are_left_out(client, db):
    book_id = create(client).json()["book_id"]
    send(client, book_id, 3, [page_text(3), ""])
    send(client, book_id, 1, [page_text(1), page_text(2)], last=True)
    text = " ".join(c["content"] for c in sorted(db.tables["chunks"], key=lambda c: c["chunk_index"]))
    assert text.index("Page 1 begins.") < text.index("Page 2 begins.") < text.index("Page 3 begins.")


def test_a_resent_batch_replaces_its_pages(client, db):
    book_id = create(client).json()["book_id"]
    send(client, book_id, 1, ["old text"])
    send(client, book_id, 1, [page_text(1)])
    assert [r["text"] for r in db.tables["page_ocr"]] == [page_text(1)]


def test_pages_for_a_server_read_book_another_readers_or_a_ready_one_are_refused(client, db):
    db.tables["books"] = [
        {"id": "cloud", "user_id": USER, "status": "processing", "source_format": None},
        {"id": "theirs", "user_id": OTHER, "status": "processing", "source_format": "browser-text"},
        {"id": "done", "user_id": USER, "status": "ready", "source_format": "browser-text"},
    ]
    assert send(client, "cloud", 1, ["x"]).status_code == 409
    assert send(client, "theirs", 1, ["x"]).status_code == 404
    assert send(client, "done", 1, ["x"]).status_code == 409
    assert db.tables.get("page_ocr", []) == []


@pytest.mark.parametrize("body", [
    {"first": 0, "texts": ["x"]},
    {"first": 1, "texts": []},
    {"first": 1, "texts": ["x"] * (policy.BROWSER_TEXT_PAGES_PER_BATCH + 1)},
    {"first": 1, "texts": ["x" * (policy.BROWSER_TEXT_MAX_PAGE_CHARS + 1)]},
    {"first": policy.BROWSER_TEXT_MAX_PAGES, "texts": ["x", "y"]},
    {"first": 1, "texts": ["x"], "words": []},
])
def test_a_bad_batch_is_refused_and_nothing_is_stored(client, db, body):
    book_id = create(client).json()["book_id"]
    assert client.post(f"/books/{book_id}/pages", json=body).status_code == 422
    assert db.tables.get("page_ocr", []) == []


def test_a_failed_browser_text_book_resumes_from_its_stored_text(client, db, monkeypatch):
    book_id = create(client).json()["book_id"]
    real_embed = embedder.embed
    monkeypatch.setattr(embedder, "embed", lambda texts: (_ for _ in ()).throw(RuntimeError("model down")))
    send(client, book_id, 1, [page_text(n) for n in range(1, 4)], last=True)
    assert jobs.get(book_id)["status"] == "failed" and db.tables["books"][0]["status"] == "error"
    monkeypatch.setattr(embedder, "embed", real_embed)
    resumed = client.post(f"/books/{book_id}/resume")
    assert resumed.status_code == 200
    assert jobs.get(book_id)["status"] == "done" and db.tables["books"][0]["status"] == "ready"


def test_a_device_book_read_on_the_server_still_cannot_resume(client, db):
    db.tables["books"] = [{"id": "small", "user_id": USER, "status": "error", "storage_path": None,
                           "source_format": None}]
    assert client.post("/books/small/resume").status_code == 409
