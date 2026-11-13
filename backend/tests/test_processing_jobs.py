"""The processing_jobs service on an in-memory database: create, claim, advance, finish, fail, sweep."""

from datetime import UTC, datetime, timedelta

import pytest

from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

NOW = datetime(2026, 11, 11, 6, 0, tzinfo=UTC)


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    monkeypatch.setattr(jobs, "supabase", fake)
    return fake


def job(**fields):
    base = {"id": "job-1", "book_id": "book-1", "user_id": "user-1", "kind": "ingest", "status": "queued",
            "progress": 0, "cursor": 0, "error": None, "attempts": 0, "updated_at": jobs.iso(NOW)}
    return {**base, **fields}


def test_create_makes_one_queued_job_per_book(db):
    first = jobs.create("book-1", "user-1", now=NOW)
    again = jobs.create("book-1", "user-1", now=NOW)
    assert len(db.tables["processing_jobs"]) == 1
    assert first["status"] == again["status"] == "queued"
    assert (first["cursor"], first["progress"], first["attempts"], first["kind"]) == (0, 0, 0, "ingest")
    assert jobs.get("book-1")["id"] == first["id"]
    assert jobs.get("book-2") is None


def test_each_kind_has_its_own_job_per_book(db):
    ingest = jobs.create("book-1", "user-1", now=NOW)
    regions = jobs.create("book-1", "user-1", now=NOW, kind=jobs.REGIONS)
    assert len(db.tables["processing_jobs"]) == 2 and ingest["id"] != regions["id"]
    assert regions["kind"] == "regions"
    assert jobs.get("book-1")["id"] == ingest["id"]
    assert jobs.get("book-1", kind=jobs.REGIONS)["id"] == regions["id"]


@pytest.mark.parametrize("fields, manual, expected", [
    ({"status": "queued"}, False, (True, "queued")),
    ({"status": "failed"}, False, (True, "failed")),
    ({"status": "done"}, True, (False, "done")),
    ({"status": "running", "updated_at": jobs.iso(NOW - timedelta(minutes=4, seconds=59))}, True, (False, "running")),
    ({"status": "running", "updated_at": jobs.iso(NOW - timedelta(minutes=5))}, False, (True, "stale")),
    ({"status": "failed", "attempts": jobs.MAX_ATTEMPTS}, False, (False, "attempts")),
    ({"status": "failed", "attempts": jobs.MAX_ATTEMPTS}, True, (True, "failed")),
])
def test_claimable(fields, manual, expected):
    assert jobs.claimable(job(**fields), NOW, window=5, manual=manual) == expected


def test_claim_runs_the_job_once_even_when_two_callers_race(db):
    created = jobs.create("book-1", "user-1", now=NOW)
    claimed = jobs.claim(created, now=NOW + timedelta(seconds=1))
    assert (claimed["status"], claimed["attempts"], claimed["error"]) == ("running", 1, None)
    assert jobs.claim(created, now=NOW + timedelta(seconds=2)) is None  # the other caller read the old row


def test_advance_records_the_cursor_progress_and_a_fresh_timestamp(db):
    created = jobs.create("book-1", "user-1", now=NOW)
    jobs.advance(created["id"], cursor=21, total=84, now=NOW + timedelta(minutes=1))
    row = jobs.get("book-1")
    assert (row["cursor"], row["progress"], row["updated_at"]) == (21, 0.25, jobs.iso(NOW + timedelta(minutes=1)))


def test_finish_and_fail(db):
    created = jobs.create("book-1", "user-1", now=NOW)
    jobs.finish(created["id"], total=0, now=NOW)
    assert (jobs.get("book-1")["status"], jobs.get("book-1")["progress"]) == ("done", 1)
    jobs.fail(created["id"], "x" * 2000, now=NOW)
    row = jobs.get("book-1")
    assert row["status"] == "failed" and len(row["error"]) == jobs.ERROR_LIMIT


def test_stale_jobs_are_queued_or_running_and_older_than_the_window(db):
    db.tables["processing_jobs"] = [
        job(id="old-running", status="running", updated_at=jobs.iso(NOW - timedelta(minutes=6))),
        job(id="old-queued", status="queued", updated_at=jobs.iso(NOW - timedelta(minutes=6))),
        job(id="fresh-running", status="running", updated_at=jobs.iso(NOW - timedelta(minutes=1))),
        job(id="old-done", status="done", updated_at=jobs.iso(NOW - timedelta(minutes=60))),
        job(id="old-failed", status="failed", updated_at=jobs.iso(NOW - timedelta(minutes=60))),
    ]
    assert [j["id"] for j in jobs.stale_jobs(now=NOW, window=5)] == ["old-running", "old-queued"]


def test_the_stale_window_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("INGEST_STALE_MINUTES", "2")
    assert jobs.stale_minutes() == 2
    monkeypatch.delenv("INGEST_STALE_MINUTES")
    assert jobs.stale_minutes() == jobs.DEFAULT_STALE_MINUTES
