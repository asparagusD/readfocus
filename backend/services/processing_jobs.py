"""Durable job rows for book ingestion and the region map (table processing_jobs, migrations 010, 018).

The job row, not the process, holds the state: status, the cursor (the next
chunk index to process), progress and attempts. A worker claims a job with
an update that only succeeds if the row has not changed since it was read
(same attempts and updated_at), so two callers cannot both run it. The
backend writes updated_at on every change; a running job whose updated_at
is older than the stale window was abandoned by a stopped server and may be
claimed again, up to MAX_ATTEMPTS times by the sweep.
"""

import os
from datetime import UTC, datetime, timedelta

from backend.services.supabase_client import supabase

INGEST = "ingest"
REGIONS = "regions"  # the page-region map (C18.2b, backend/services/region_job.py)
KIND = INGEST
MAX_ATTEMPTS = 3
DEFAULT_STALE_MINUTES = 5
ERROR_LIMIT = 500
TABLE = "processing_jobs"


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat()


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


def stale_minutes() -> float:
    """Minutes without an update after which a running job counts as abandoned: INGEST_STALE_MINUTES or 5."""
    return float(os.getenv("INGEST_STALE_MINUTES") or DEFAULT_STALE_MINUTES)


def create(book_id: str, user_id: str, now: datetime | None = None, *, kind: str = INGEST) -> dict:
    """The book's job of this kind, made queued if it does not exist yet."""
    row = {"book_id": book_id, "user_id": user_id, "kind": kind, "status": "queued", "progress": 0,
           "cursor": 0, "error": None, "attempts": 0, "updated_at": iso(_now(now))}
    supabase.table(TABLE).upsert(row, on_conflict="book_id,kind", ignore_duplicates=True).execute()
    return get(book_id, kind=kind)


def requeue(book_id: str, user_id: str, now: datetime | None = None, *, kind: str = INGEST) -> dict | None:
    """The book's job of this kind, made queued from the start again (a book re-ingested from OCR text, C19.4)."""
    create(book_id, user_id, now, kind=kind)
    supabase.table(TABLE).update({"status": "queued", "progress": 0, "cursor": 0, "error": None, "attempts": 0,
                                  "updated_at": iso(_now(now))}).eq("book_id", book_id).eq("kind", kind).execute()
    return get(book_id, kind=kind)


def get(book_id: str, *, kind: str = INGEST) -> dict | None:
    rows = supabase.table(TABLE).select("*").eq("book_id", book_id).eq("kind", kind).execute().data
    return rows[0] if rows else None


def claimable(job: dict, now: datetime, window: float, manual: bool = False) -> tuple[bool, str]:
    """Whether a worker may take this job now, and why. Pure.

    The sweep (manual=False) stops at MAX_ATTEMPTS; a reader's resume may go past it.
    """
    status = job["status"]
    if status == "done":
        return False, "done"
    if status == "running":
        updated = datetime.fromisoformat(job["updated_at"])
        if now - updated < timedelta(minutes=window):
            return False, "running"
    if not manual and job["attempts"] >= MAX_ATTEMPTS:
        return False, "attempts"
    return True, "stale" if status == "running" else status


def claim(job: dict, now: datetime | None = None, manual: bool = False) -> dict | None:
    """Mark the job running for this worker; None if it is not claimable or another caller got it first."""
    moment = _now(now)
    ok, _ = claimable(job, moment, stale_minutes(), manual)
    if not ok:
        return None
    values = {"status": "running", "attempts": job["attempts"] + 1, "error": None, "updated_at": iso(moment)}
    rows = (supabase.table(TABLE).update(values).eq("id", job["id"])
            .eq("attempts", job["attempts"]).eq("updated_at", job["updated_at"]).execute().data)
    return rows[0] if rows else None


def advance(job_id: str, cursor: int, total: int, now: datetime | None = None) -> None:
    """Record that every unit (chunk, or page for regions) before `cursor` is done."""
    progress = 1.0 if total <= 0 else min(1.0, cursor / total)
    supabase.table(TABLE).update({"cursor": cursor, "progress": progress, "updated_at": iso(_now(now))}).eq(
        "id", job_id).execute()


def finish(job_id: str, total: int, now: datetime | None = None) -> None:
    supabase.table(TABLE).update({"status": "done", "cursor": max(total, 0), "progress": 1,
                                  "error": None, "updated_at": iso(_now(now))}).eq("id", job_id).execute()


def fail(job_id: str, error: str, now: datetime | None = None) -> None:
    supabase.table(TABLE).update({"status": "failed", "error": str(error)[:ERROR_LIMIT],
                                  "updated_at": iso(_now(now))}).eq("id", job_id).execute()


def stale_jobs(now: datetime | None = None, window: float | None = None) -> list[dict]:
    """Queued or running jobs of every kind not updated within the stale window, oldest first."""
    cutoff = iso(_now(now) - timedelta(minutes=stale_minutes() if window is None else window))
    return (supabase.table(TABLE).select("*").in_("status", ["queued", "running"]).lt("updated_at", cutoff)
            .order("updated_at").execute().data or [])
