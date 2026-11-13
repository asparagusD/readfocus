"""Resumes ingestion and regions jobs that a stopped server left behind.

All state is in processing_jobs; this module only decides which jobs to
pick up. The sweep runs at startup and then once per stale window: a queued
or running job not updated within the window is claimed and run again from
its cursor, one job at a time (each kind by its own runner), or marked
failed once it has used MAX_ATTEMPTS. Losing this loop loses nothing, because the next start sweeps
again. INGEST_SWEEP=0 turns it off (the test suite does).
"""

import asyncio
import os
from datetime import UTC, datetime

from backend.services import book_ingestor, region_job
from backend.services import processing_jobs as jobs
from backend.services.supabase_client import supabase

MIN_SWEEP_SECONDS = 30


def sweep_enabled() -> bool:
    return os.getenv("INGEST_SWEEP", "1") != "0"


def give_up(job: dict) -> None:
    """Stop retrying: the job fails, and a book that never became readable shows the error.

    A regions job never touches the book: the book reads without its region map.
    """
    jobs.fail(job["id"], f"Stopped after {job['attempts']} attempts")
    if job.get("kind") == jobs.REGIONS:
        return
    supabase.table("books").update({"status": "error"}).eq("id", job["book_id"]).eq("status", "processing").execute()


async def sweep(now: datetime | None = None) -> dict:
    """Resume or give up on every stale job; returns the book ids of each."""
    report = {"resumed": [], "gave_up": []}
    moment = now or datetime.now(UTC)
    try:
        stale = jobs.stale_jobs(moment)
    except Exception as error:  # noqa: BLE001 - the app must start even if the sweep cannot
        print(f"Ingestion sweep failed: {error}")
        return report
    for job in stale:
        try:
            if jobs.claimable(job, moment, jobs.stale_minutes()) == (False, "attempts"):
                give_up(job)
                report["gave_up"].append(job["book_id"])
                continue
            claimed = jobs.claim(job, moment)
            if claimed:
                runner = region_job.run_job if claimed.get("kind") == jobs.REGIONS else book_ingestor.run_job
                await runner(claimed)
                report["resumed"].append(job["book_id"])
        except Exception as error:  # noqa: BLE001 - one bad job must not stop the others
            print(f"Ingestion sweep could not resume book {job.get('book_id')}: {error}")
    return report


async def sweep_forever() -> None:
    while True:
        report = await sweep()
        if report["resumed"] or report["gave_up"]:
            print(f"Ingestion sweep: {report}")
        await asyncio.sleep(max(MIN_SWEEP_SECONDS, jobs.stale_minutes() * 60))
