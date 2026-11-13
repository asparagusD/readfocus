"""scripts/backfill_prose.py on the in-memory database (C18.6c). No network, no model."""

import asyncio

import numpy as np
import pytest

from backend.nlp import embedder
from backend.services import processing_jobs as jobs
from backend.services import prose_job, region_job
from backend.tests.memory_db import MemoryDb
from scripts import backfill_prose as backfill

USER = "user-1"
PAGE = "Ohm's law is simple.\nE = I R (2.1)\nIt holds for metals."
REGIONS = [
    {"kind": "block", "page": 1, "text": "Ohm's law is simple.", "order_in_page": 0, "meta": {}},
    {"kind": "math", "page": 1, "text": "E = IR (2.1)", "order_in_page": 1, "meta": {"equation_number": "2.1"}},
    {"kind": "block", "page": 1, "text": "It holds for metals.", "order_in_page": 2, "meta": {}},
]


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    for module in (prose_job, region_job, jobs):
        monkeypatch.setattr(module, "supabase", fake)
    monkeypatch.setattr(prose_job, "pdf_page_texts", lambda data: [PAGE])
    monkeypatch.setattr(embedder, "embed", lambda texts: np.ones((len(texts), embedder.EMBEDDING_DIM)))
    fake.generated = []
    monkeypatch.setattr(prose_job.question_agent, "run", lambda book_id, ids: fake.generated.append(sorted(ids)))

    def rows(book, data):  # what the regions job would find in the file
        return [{**r, "book_id": book["id"], "user_id": book["user_id"]} for r in REGIONS]

    monkeypatch.setattr(backfill, "file_regions", rows)

    async def run_job(job, file_bytes=None):  # the regions job: stores the regions, then rebuilds prose
        book = next(b for b in fake.tables["books"] if b["id"] == job["book_id"])
        fake.tables.setdefault("page_regions", []).extend(rows(book, file_bytes))
        jobs.finish(job["id"], 1)
        return {"status": "done", "pages": 1, "prose": await prose_job.after_regions(book, file_bytes)}

    monkeypatch.setattr(region_job, "run_job", run_job)
    fake.tables["books"] = [
        {"id": "b2", "user_id": USER, "status": "ready", "file_type": "pdf", "storage_path": "u/b2.pdf", "title": "B"},
        {"id": "b1", "user_id": USER, "status": "ready", "file_type": "pdf", "storage_path": "u/b1.pdf", "title": "A"},
        {"id": "b3", "user_id": USER, "status": "ready", "file_type": "pdf", "storage_path": None, "title": "C"},
        {"id": "b4", "user_id": USER, "status": "processing", "file_type": "pdf", "storage_path": "u/b4.pdf"},
    ]
    fake.files["u/b1.pdf"] = fake.files["u/b2.pdf"] = b"%PDF"
    fake.tables["chunks"] = [{"id": f"{b}-0", "book_id": b, "user_id": USER, "chunk_index": 0, "content": PAGE}
                             for b in ("b1", "b2")]
    return fake


def handle(db, book_id, dry_run=False):
    row = next(b for b in db.tables["books"] if b["id"] == book_id)
    return asyncio.run(backfill.backfill_book(row, db, dry_run))


def chunk(db, book_id):
    return next(c for c in db.tables["chunks"] if c["book_id"] == book_id)


def test_pending_is_ready_books_kept_on_the_server_in_id_order(db):
    assert [r["id"] for r in backfill.pending_rows(db)] == ["b1", "b2"]
    assert [r["id"] for r in backfill.pending_rows(db, limit=1)] == ["b1"]
    assert [r["id"] for r in backfill.pending_rows(db, book_id="b2")] == ["b2"]


def test_dry_run_reports_what_would_change_and_writes_nothing(db):
    calls = len(db.calls)
    outcome = handle(db, "b1", dry_run=True)
    assert outcome == "would map regions; would store 1 of 1 chunks, re-question 1, 1 placeholders, 0 garbled"
    assert not [c for c in db.calls[calls:] if c[1] not in ("select", "download")]  # reads only
    assert "prose" not in chunk(db, "b1") and not db.generated


def test_a_book_without_regions_gets_its_regions_job_and_prose(db):
    assert handle(db, "b1") == "mapped regions; stored 1 of 1 chunks, re-question 1, 1 placeholders, 0 garbled"
    assert chunk(db, "b1")["prose"] == "Ohm's law is simple.\n[Equation 2.1, p. 1]\nIt holds for metals."
    assert db.generated == [["b1-0"]]
    assert "prose" not in chunk(db, "b2")


def test_running_it_again_changes_nothing(db):
    handle(db, "b1")
    calls = len(db.calls)
    assert handle(db, "b1") == "regions done; stored 0 of 1 chunks, re-question 0, 1 placeholders, 0 garbled"
    assert not [c for c in db.calls[calls:] if c[1] in ("update", "delete", "insert")]
    assert db.generated == [["b1-0"]]


def test_a_regions_job_running_elsewhere_is_left_alone(db):
    job = jobs.create("b1", USER, kind=jobs.REGIONS)
    jobs.claim(job)
    assert handle(db, "b1") == "skipped: regions job running"


def test_one_failing_book_does_not_stop_the_run(db):
    seen = []
    done = backfill.run([{"id": "x"}, {"id": "y"}], lambda row: 1 / 0 if row["id"] == "x" else "ok",
                        report=lambda row, outcome: seen.append(outcome))
    assert done == 2 and seen[0].startswith("error:") and seen[1] == "ok"


def test_it_refuses_to_run_outside_development_without_the_flag(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    with pytest.raises(SystemExit):
        backfill.check_environment(False)
    backfill.check_environment(True)
