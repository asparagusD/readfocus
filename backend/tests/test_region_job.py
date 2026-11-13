"""The regions job (C18.2b): page batches of a PDF read into page_regions, resumable from the cursor."""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from backend.regions import extract
from backend.services import book_ingestor, ingestion_worker, region_job
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

SAMPLE = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures" / "books" / "sample.pdf"
USER, BOOK = "user-1", "book-1"
LONG_AGO = jobs.iso(datetime.now(UTC) - timedelta(hours=1))


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    for module in (region_job, jobs, ingestion_worker, book_ingestor):
        monkeypatch.setattr(module, "supabase", fake)
    monkeypatch.setattr(region_job, "PAGES_PER_BATCH", 2)
    return fake


def add_book(db, file_type="pdf", storage=True, data=None, status="ready"):
    path = f"{USER}/{BOOK}.{file_type}" if storage else None
    db.tables.setdefault("books", []).append({"id": BOOK, "user_id": USER, "file_type": file_type,
                                              "storage_path": path, "status": status})
    if path:
        db.files[path] = data if data is not None else SAMPLE.read_bytes()


def regions(db):
    return db.tables.get("page_regions", [])


def run(job, **kw):
    return asyncio.run(region_job.run_job(job, **kw))


def word(text, x0, top):
    return [{"text": c, "fontname": "ABCDEF+Body", "size": 10.0, "x0": x0 + 5 * i, "x1": x0 + 5 * i + 5,
             "top": top, "bottom": top + 10, "upright": True} for i, c in enumerate(text)]


def test_block_rows_turn_each_block_into_an_unclassified_region():
    page = extract.build_page(word("one", 100, 100) + word("two", 100, 112) + word("far", 100, 300),
                              page_no=3, bbox=(0, 0, 600, 800))
    rows = region_job.block_rows({"id": BOOK, "user_id": USER}, page)
    assert [r["order_in_page"] for r in rows] == [0, 1]
    first = rows[0]
    assert first["book_id"] == BOOK and first["user_id"] == USER and first["page"] == 3
    assert first["kind"] == "block" and first["text"] == "one\ntwo"
    assert first["bbox"] == [100, 100, 115, 122]
    assert first["meta"]["lines"] == 2 and first["meta"]["fonts"] == {"Body": 6}
    assert first["meta"]["garble"] == {"ratio": 0.0, "reasons": []}


def test_display_math_is_stored_as_a_math_row_and_inline_math_as_meta():
    prose = "the reader finds that x = 2 here and keeps on reading the long line"
    page = extract.build_page(word(prose, 72, 100) + word("a=b+c", 250, 140) + word(prose, 72, 170),
                              page_no=1, bbox=(0, 0, 600, 800))
    rows = region_job.block_rows({"id": BOOK, "user_id": USER}, page)
    assert [r["kind"] for r in rows] == ["block", "math", "block"]
    assert rows[1]["text"] == "a=b+c" and rows[1]["meta"]["display"] is True
    start, end = rows[0]["meta"]["inline_math"][0]
    assert rows[0]["text"][start:end] == "x = 2"


def test_batches_are_page_ranges_from_the_cursor():
    assert list(region_job.batches(5, 0, 2)) == [(1, 2), (3, 4), (5, 5)]
    assert list(region_job.batches(5, 2, 2)) == [(3, 4), (5, 5)]
    assert list(region_job.batches(5, 5, 2)) == []


def test_queue_makes_one_regions_job_beside_the_ingest_job(db):
    add_book(db)
    jobs.create(BOOK, USER)
    claimed = region_job.queue({"id": BOOK, "user_id": USER, "storage_path": f"{USER}/{BOOK}.pdf", "file_type": "pdf"})
    assert claimed["kind"] == "regions" and claimed["status"] == "running"
    assert sorted(j["kind"] for j in db.tables["processing_jobs"]) == ["ingest", "regions"]
    assert jobs.get(BOOK)["kind"] == "ingest" and jobs.get(BOOK, kind="regions")["id"] == claimed["id"]


def test_queue_skips_device_only_books_and_epubs(db):
    assert region_job.queue({"id": BOOK, "user_id": USER, "storage_path": None, "file_type": "pdf"}) is None
    assert region_job.queue({"id": BOOK, "user_id": USER, "storage_path": "x.epub", "file_type": "epub"}) is None
    assert "processing_jobs" not in db.tables


def test_run_job_reads_every_page_in_batches_and_finishes(db):
    add_book(db)
    job = region_job.queue(db.tables["books"][0])
    result = run(job)
    total = extract.page_count(SAMPLE)
    assert result == {"status": "done", "pages": total}
    assert sorted({r["page"] for r in regions(db)}) == list(range(1, total + 1))
    stored = jobs.get(BOOK, kind="regions")
    assert (stored["status"], stored["cursor"], stored["progress"]) == ("done", total, 1)
    deletes = [c for c in db.calls if c == ("page_regions", "delete")]
    assert len(deletes) == -(-total // 2)  # one per batch of two pages


def test_a_resumed_job_starts_at_its_cursor_and_never_duplicates(db):
    add_book(db)
    job = region_job.queue(db.tables["books"][0])
    run(job)
    first_pages = [r for r in regions(db) if r["page"] <= 2]
    db.tables["processing_jobs"][-1].update(status="running", cursor=2, updated_at=LONG_AGO)
    again = jobs.claim(jobs.get(BOOK, kind="regions"))
    run(again)
    assert [r for r in regions(db) if r["page"] <= 2] == first_pages  # untouched
    keys = [(r["page"], r["order_in_page"]) for r in regions(db)]
    assert len(keys) == len(set(keys))


def test_a_failing_job_is_recorded_and_the_book_stays_readable(db):
    add_book(db, data=b"not a pdf")
    job = region_job.queue(db.tables["books"][0])
    result = run(job)
    assert result["status"] == "failed"
    assert jobs.get(BOOK, kind="regions")["status"] == "failed"
    assert db.tables["books"][0]["status"] == "ready"
    assert regions(db) == []


def test_run_job_uses_bytes_it_is_given(db):
    add_book(db)
    job = region_job.queue(db.tables["books"][0])
    db.files.clear()
    assert run(job, file_bytes=SAMPLE.read_bytes())["status"] == "done"


def test_the_sweep_sends_each_job_to_its_own_runner(db, monkeypatch):
    add_book(db, status="processing")
    for kind in ("ingest", "regions"):
        db.tables.setdefault("processing_jobs", []).append({
            "id": f"job-{kind}", "book_id": BOOK, "user_id": USER, "kind": kind, "status": "running",
            "progress": 0, "cursor": 0, "error": None, "attempts": 1, "updated_at": LONG_AGO})
    ran = []

    async def ingest(job, file_bytes=None):
        ran.append(("ingest", job["id"]))

    async def regions_runner(job, file_bytes=None):
        ran.append(("regions", job["id"]))

    monkeypatch.setattr(book_ingestor, "run_job", ingest)
    monkeypatch.setattr(region_job, "run_job", regions_runner)
    asyncio.run(ingestion_worker.sweep())
    assert sorted(ran) == [("ingest", "job-ingest"), ("regions", "job-regions")]


def test_giving_up_on_a_regions_job_leaves_the_book_alone(db):
    add_book(db, status="processing")
    db.tables["processing_jobs"] = [{"id": "job-r", "book_id": BOOK, "user_id": USER, "kind": "regions",
                                     "status": "running", "progress": 0, "cursor": 0, "error": None,
                                     "attempts": jobs.MAX_ATTEMPTS, "updated_at": LONG_AGO}]
    asyncio.run(ingestion_worker.sweep())
    assert db.tables["processing_jobs"][0]["status"] == "failed"
    assert db.tables["books"][0]["status"] == "processing"


def test_after_ingest_queues_and_runs_the_job(db):
    add_book(db)
    asyncio.run(region_job.after_ingest(db.tables["books"][0]))
    assert jobs.get(BOOK, kind="regions")["status"] == "done" and regions(db)


def test_after_ingest_never_raises(db):
    db.broken.add("processing_jobs")
    asyncio.run(region_job.after_ingest({"id": BOOK, "user_id": USER, "file_type": "pdf", "storage_path": "x.pdf"}))
