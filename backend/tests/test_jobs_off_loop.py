"""C29.1 (issue 1): a book's jobs and its upload never block the event loop.

On Render's 0.1 CPU, parsing a book, classifying its pages and every Supabase call took tens of seconds; run on
the event loop they kept the server from answering /health, and Render restarted it (DEBUG_LOG 2026-11-18 C29.1).
Here every database call and every parse is made slow, and a heartbeat beside the job must never be held up.
C33.G: the heap is frozen first, as the server does at startup; unfrozen, release_memory's full collection walked
the whole test run's heap with the GIL held and held the heartbeat up for about 150 ms on CI's runners.
"""

import asyncio
import gc
import io
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi import BackgroundTasks, UploadFile

from backend.nlp import embedder
from backend.routers import books
from backend.services import (
    book_ingestor,
    ingestion_worker,
    ocr_pages,
    pdf_text,
    prose_job,
    region_job,
)
from backend.services import processing_jobs as jobs
from backend.tests import memory_db
from backend.tests.memory_db import MemoryDb

USER, BOOK = "user-1", "book-1"
SLOW = 0.3   # seconds each slow call blocks the thread it runs on
LATE = 0.15  # the most the heartbeat may be held up
EPUB = Path(__file__).resolve().parent / "fixtures" / "regions_sample.epub"


def blocking(result=None):
    def slow(*args, **kwargs):
        time.sleep(SLOW)
        return result() if callable(result) else result
    return slow


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    for module in (book_ingestor, region_job, prose_job, jobs, ingestion_worker, ocr_pages, books):
        monkeypatch.setattr(module, "supabase", fake)
    execute, upload = memory_db.Query.execute, memory_db.Bucket.upload
    monkeypatch.setattr(memory_db.Query, "execute", lambda self: (time.sleep(SLOW), execute(self))[1])
    monkeypatch.setattr(memory_db.Bucket, "upload", lambda self, *a, **k: (time.sleep(SLOW), upload(self, *a, **k))[1])
    monkeypatch.setattr(embedder, "embed", lambda texts: np.zeros((len(texts), embedder.EMBEDDING_DIM), dtype=np.float32))
    monkeypatch.setattr(book_ingestor, "look_up_cover", lambda book, data: None)

    async def no_prose(book, file_bytes):
        return None

    monkeypatch.setattr(prose_job, "after_regions", no_prose)
    pdf_text.freeze_startup_heap()  # as backend.main's lifespan does (C33.G)
    yield fake
    gc.unfreeze()


def add_book(db, file_type, data):
    path = f"{USER}/{BOOK}.{file_type}"
    db.tables.setdefault("books", []).append({"id": BOOK, "user_id": USER, "file_type": file_type,
                                              "storage_path": path, "status": "processing"})
    db.files[path] = data


def worst_wait(make_work) -> float:
    """How late a 10 ms heartbeat woke, at worst, while the work ran on the same loop."""
    async def main():
        worst, done = 0.0, False

        async def beat():
            nonlocal worst
            while not done:
                started = time.perf_counter()
                await asyncio.sleep(0.01)
                worst = max(worst, time.perf_counter() - started - 0.01)

        heart = asyncio.create_task(beat())
        await asyncio.sleep(0.05)
        try:
            await make_work()
        finally:
            done = True
            await heart
        return worst
    return asyncio.run(main())


def test_ingesting_a_pdf_never_blocks_the_loop(db, monkeypatch):
    add_book(db, "pdf", b"%PDF")
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", blocking(["word " * 700] * 3))
    monkeypatch.setattr(region_job, "after_ingest", lambda book, data=None: asyncio.sleep(0))
    job = jobs.claim(jobs.create(BOOK, USER))
    result = {}

    async def work():
        result.update(await book_ingestor.run_job(job))
    assert worst_wait(work) < LATE
    assert result["status"] == "ready" and result["total_chunks"] >= 3


def test_ingesting_an_epub_never_blocks_the_loop(db, monkeypatch):
    add_book(db, "epub", EPUB.read_bytes())
    monkeypatch.setattr(book_ingestor, "extract", blocking(["word " * 700] * 2))
    monkeypatch.setattr(region_job, "after_ingest", lambda book, data=None: asyncio.sleep(0))
    job = jobs.claim(jobs.create(BOOK, USER))
    assert worst_wait(lambda: book_ingestor.run_job(job)) < LATE


def test_a_pdf_region_map_never_blocks_the_loop(db, monkeypatch):
    add_book(db, "pdf", b"%PDF")
    monkeypatch.setattr(region_job, "_count", lambda data: 3)
    monkeypatch.setattr(region_job, "_read", lambda data, first, last: [])
    monkeypatch.setattr(region_job, "block_rows", blocking([]))
    job = region_job.queue(db.tables["books"][0])
    result = {}

    async def work():
        result.update(await region_job.run_job(job))
    assert worst_wait(work) < LATE
    assert result["status"] == "done"


def test_an_epub_region_map_never_blocks_the_loop(db, monkeypatch):
    add_book(db, "epub", EPUB.read_bytes())
    monkeypatch.setattr(region_job, "epub_rows", blocking([]))
    job = region_job.queue(db.tables["books"][0])
    assert worst_wait(lambda: region_job.run_job(job)) < LATE


def test_after_ingest_queues_the_region_map_off_the_loop(db, monkeypatch):
    add_book(db, "pdf", b"%PDF")

    async def regions(job, file_bytes=None):
        return {"status": "done"}

    monkeypatch.setattr(region_job, "run_job", regions)
    assert worst_wait(lambda: region_job.after_ingest(db.tables["books"][0])) < LATE


def test_an_upload_never_blocks_the_loop(db, monkeypatch):
    monkeypatch.setattr(books, "pdf_page_count", blocking(3))
    upload = UploadFile(file=io.BytesIO(b"%PDF-1.4 a small book"), filename="book.pdf")
    tasks = BackgroundTasks()
    result = {}

    async def work():
        result.update(await books.upload_book(tasks, upload, "A Book", "An Author", "cloud", USER))
    assert worst_wait(work) < LATE
    assert result["status"] == "processing" and len(tasks.tasks) == 1


def test_ingestion_makes_way_between_batches_while_a_request_is_served(db, monkeypatch):
    """C35.6 (issue 17): with a request in flight, each batch after the first waits for it (capped)."""
    from backend.services import make_way

    add_book(db, "pdf", b"%PDF")
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", lambda data, *a, **k: ["word " * 700] * 8)
    monkeypatch.setattr(region_job, "after_ingest", lambda book, data=None: asyncio.sleep(0))
    waits = []
    real = make_way.between_batches

    async def recorded(*args, **kwargs):
        waits.append(make_way.busy())
        return await real(pause=0.0, max_wait=0.05)
    monkeypatch.setattr(make_way, "between_batches", recorded)
    monkeypatch.setattr(make_way, "_in_flight", 1)  # a request being served throughout
    job = jobs.claim(jobs.create(BOOK, USER))
    result = asyncio.run(book_ingestor.run_job(job))
    assert result["status"] == "ready"
    assert waits and all(w == 1 for w in waits)
    assert len(waits) == len(list(book_ingestor.batches(result["total_chunks"]))) - 1  # every batch but the first


def test_reading_a_pdfs_pages_makes_way_page_by_page(monkeypatch):
    """C35.6: the page parse asks make_way before each page, so a request's thread runs first."""
    from pypdf import PdfWriter

    from backend.services import make_way

    writer = PdfWriter()
    for _ in range(4):
        writer.add_blank_page(width=100, height=100)
    out = io.BytesIO()
    writer.write(out)
    asked = []
    monkeypatch.setattr(make_way, "in_thread", lambda *a, **k: asked.append(1) or 0.0)
    assert pdf_text.page_texts(out.getvalue()) == ["", "", "", ""]
    assert len(asked) == 4
