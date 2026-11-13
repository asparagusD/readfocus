"""The startup sweep and the book endpoints that start, resume and report ingestion jobs."""

import asyncio
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.nlp import embedder
from backend.routers import books
from backend.services import book_ingestor, ingestion_worker, region_job
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
LONG_AGO = jobs.iso(datetime.now(UTC) - timedelta(hours=1))


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    for module in (book_ingestor, jobs, ingestion_worker, books):
        monkeypatch.setattr(module, "supabase", fake)
    monkeypatch.setattr(embedder, "embed", lambda texts: np.zeros((len(texts), embedder.EMBEDDING_DIM), dtype=np.float32))
    monkeypatch.setattr(book_ingestor.question_agent, "run", lambda book_id, chunk_ids: None)

    async def no_regions(book, file_bytes=None):  # covered in test_region_job.py
        return None

    monkeypatch.setattr(region_job, "after_ingest", no_regions)
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", lambda data: ["unused"])
    monkeypatch.setattr(book_ingestor, "chunk_text", lambda pages, target_words=600: [f"c{i}" for i in range(9)])
    return fake


def add_book(db, book_id, user=USER, status="processing", job=None):
    db.tables.setdefault("books", []).append({"id": book_id, "user_id": user, "file_type": "pdf", "status": status,
                                              "storage_path": f"{user}/{book_id}.pdf"})
    db.files[f"{user}/{book_id}.pdf"] = b"%PDF"
    if job:
        db.tables.setdefault("processing_jobs", []).append({
            "id": f"job-{book_id}", "book_id": book_id, "user_id": user, "kind": "ingest", "progress": 0,
            "cursor": 0, "error": None, "attempts": 0, "updated_at": LONG_AGO, **job})


def test_the_sweep_resumes_abandoned_jobs_and_gives_up_at_the_attempt_cap(db):
    add_book(db, "stale", job={"status": "running", "attempts": 1})
    add_book(db, "fresh", job={"status": "running", "attempts": 1, "updated_at": jobs.iso(datetime.now(UTC))})
    add_book(db, "worn", job={"status": "running", "attempts": jobs.MAX_ATTEMPTS})
    report = asyncio.run(ingestion_worker.sweep())
    assert report == {"resumed": ["stale"], "gave_up": ["worn"]}
    assert jobs.get("stale")["status"] == "done" and jobs.get("stale")["attempts"] == 2
    assert jobs.get("fresh")["status"] == "running"
    assert jobs.get("worn")["status"] == "failed" and "attempts" in jobs.get("worn")["error"]
    assert {b["id"]: b["status"] for b in db.tables["books"]} == {"stale": "ready", "fresh": "processing", "worn": "error"}


def test_a_failing_sweep_is_logged_and_does_not_raise(db):
    db.broken.add("processing_jobs")
    assert asyncio.run(ingestion_worker.sweep()) == {"resumed": [], "gave_up": []}


def test_the_sweep_is_off_when_ingest_sweep_is_0(monkeypatch):
    monkeypatch.setenv("INGEST_SWEEP", "0")
    assert ingestion_worker.sweep_enabled() is False
    monkeypatch.setenv("INGEST_SWEEP", "1")
    assert ingestion_worker.sweep_enabled() is True


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)  # not entered: no startup sweep
    app.dependency_overrides.clear()


def test_upload_creates_a_job_and_ingests_the_book(client, db):
    resp = client.post("/books/upload", files={"file": ("b.pdf", b"%PDF", "application/pdf")},
                       data={"title": "t", "author": "a"})
    assert resp.status_code == 200 and set(resp.json()) == {"book_id", "status", "source_format", "notes"}  # the last two since C19.2c
    book_id = resp.json()["book_id"]
    status = client.get(f"/books/{book_id}/status").json()
    assert status["status"] == "ready" and status["total_chunks"] == 9
    assert {k: status["ingestion"][k] for k in ("status", "cursor", "progress", "attempts")} == {
        "status": "done", "cursor": 9, "progress": 1, "attempts": 1}


def test_status_reports_the_progress_of_a_running_job(client, db):
    add_book(db, "b1", status="ready", job={"status": "running", "cursor": 21, "progress": 21 / 40, "attempts": 1})
    status = client.get("/books/b1/status").json()
    assert status["status"] == "ready"
    assert {k: status["ingestion"][k] for k in ("status", "cursor", "progress", "attempts", "error")} == {
        "status": "running", "cursor": 21, "progress": 0.525, "attempts": 1, "error": None}


def test_resume_finishes_a_failed_job(client, db):
    add_book(db, "b1", status="error", job={"status": "failed", "cursor": 0, "attempts": jobs.MAX_ATTEMPTS})
    resp = client.post("/books/b1/resume")
    assert resp.status_code == 200 and resp.json()["ingestion"]["status"] == "running"
    assert jobs.get("b1")["status"] == "done" and db.tables["books"][0]["status"] == "ready"


def test_resume_starts_a_job_for_a_stuck_book_that_has_none(client, db):
    add_book(db, "old")
    assert client.post("/books/old/resume").status_code == 200
    assert jobs.get("old")["status"] == "done"


@pytest.mark.parametrize("job, code", [
    ({"status": "done"}, 409),
    ({"status": "running", "updated_at": jobs.iso(datetime.now(UTC))}, 409),
])
def test_resume_refuses_a_done_or_live_job(client, db, job, code):
    add_book(db, "b1", job=job)
    resp = client.post("/books/b1/resume")
    assert resp.status_code == code and job["status"] in resp.json()["detail"]


def test_resume_of_another_users_book_is_404(client, db):
    add_book(db, "theirs", user=OTHER, job={"status": "failed"})
    assert client.post("/books/theirs/resume").status_code == 404
    assert jobs.get("theirs")["status"] == "failed"
