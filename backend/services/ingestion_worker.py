"""Resumes ingestion and regions jobs that a stopped server left behind.

All state is in processing_jobs; this module only decides which jobs to
pick up. The sweep runs at startup and then once per stale window: a queued
or running job not updated within the window is claimed and run again from
its cursor, one job at a time (each kind by its own runner), or marked
failed once it has used MAX_ATTEMPTS. Losing this loop loses nothing, because the next start sweeps
again. INGEST_SWEEP=0 turns it off (the test suite does).

C26.1: every job in the process runs through `run`, one at a time (uploads, resumes, OCR re-reads and the
sweep alike), so two uploads never parse at once on Render's 512 MB. C27.1: waiting ingest jobs go before
waiting regions jobs, each kind in arrival order; a book's region map is queued as its own job when its
ingestion ends inside the worker (region_job.after_ingest asks `defer`), so a second upload's first questions
no longer wait for the first book's region map. The queued regions job reads the file from Storage when its
turn comes, so no file waits in memory.
"""

import asyncio
import contextvars
import heapq
import os
import weakref
from datetime import UTC, datetime

from backend.services import book_ingestor, book_purge, region_job
from backend.services import processing_jobs as jobs
from backend.services.supabase_client import supabase

MIN_SWEEP_SECONDS = 30


INGEST_FIRST, REGIONS_LATER = 0, 1  # C27.1: a waiting ingest job goes before a waiting regions job


class _Slot:
    """One job at a time; when it is free, the waiter with the lowest priority, then the earliest, goes next."""

    def __init__(self):
        self.busy, self.waiting, self.arrivals = False, [], 0

    async def acquire(self, priority: int) -> None:
        if not self.busy and not self.waiting:
            self.busy = True
            return
        handed = asyncio.get_running_loop().create_future()
        self.arrivals += 1
        heapq.heappush(self.waiting, (priority, self.arrivals, handed))
        try:
            await handed
        except asyncio.CancelledError:
            if handed.done() and not handed.cancelled():  # the slot was handed over as the waiter was cancelled
                self.release()
            raise

    def release(self) -> None:
        while self.waiting:
            _priority, _arrival, handed = heapq.heappop(self.waiting)
            if not handed.done():  # a cancelled waiter is skipped
                handed.set_result(None)
                return
        self.busy = False


# One slot per event loop: the test client runs each request on its own loop.
_slots: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, _Slot]" = weakref.WeakKeyDictionary()
_in_worker = contextvars.ContextVar("in_ingestion_worker", default=False)
_deferred: set[asyncio.Task] = set()
# C27.2: ids of the jobs this process holds, waiting for the slot or running. A held job is not updated while
# it waits, so without this the sweep would take it for abandoned once the stale window passed, claim it again
# (a second run) and, after MAX_ATTEMPTS, fail a job that was only waiting.
_held: set[str] = set()


def _slot() -> _Slot:
    loop = asyncio.get_running_loop()
    slot = _slots.get(loop)
    if slot is None:
        slot = _slots[loop] = _Slot()
    return slot


async def run(job: dict, file_bytes: bytes | None = None) -> dict:
    """Run a claimed job when the slot is free: ingest jobs first, then regions jobs, each in arrival order.
    A job that raises never stops the ones after."""
    regions = job.get("kind") == jobs.REGIONS
    runner = region_job.run_job if regions else book_ingestor.run_job
    slot = _slot()
    held = job.get("id")
    if held:
        _held.add(held)
    try:
        await slot.acquire(REGIONS_LATER if regions else INGEST_FIRST)
    except BaseException:
        _held.discard(held)
        raise
    inside = _in_worker.set(True)
    try:
        return await runner(job, file_bytes)
    except Exception as error:  # noqa: BLE001 - the runners record their own failures; this is the backstop
        print(f"Job for book {job.get('book_id')} stopped: {error}")
        return {"status": "error", "error": str(error)}
    finally:
        _in_worker.reset(inside)
        _held.discard(held)
        slot.release()


def defer(job: dict) -> bool:
    """Queue a claimed regions job behind any waiting ingest (C27.1); False outside the worker, where the caller
    runs it at once. It reads the book's file from Storage when its turn comes."""
    if not _in_worker.get():
        return False
    if job.get("id"):
        _held.add(job["id"])  # held from now: the task starts on the loop's next turn
    task = asyncio.get_running_loop().create_task(run(job))
    _deferred.add(task)
    task.add_done_callback(_deferred.discard)
    return True


async def drain() -> None:
    """Wait for every deferred regions job (and any it defers in turn); for scripts and tests."""
    while _deferred:
        await asyncio.gather(*list(_deferred), return_exceptions=True)


region_job.defer = defer


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
        if job.get("id") in _held:  # C27.2: waiting or running in this process, not abandoned
            continue
        try:
            if jobs.claimable(job, moment, jobs.stale_minutes()) == (False, "attempts"):
                give_up(job)
                report["gave_up"].append(job["book_id"])
                continue
            claimed = jobs.claim(job, moment)
            if claimed:
                await run(claimed)
                report["resumed"].append(job["book_id"])
        except Exception as error:  # noqa: BLE001 - one bad job must not stop the others
            print(f"Ingestion sweep could not resume book {job.get('book_id')}: {error}")
    return report


async def purge_deleted() -> list[str]:
    """C35.2 (issue 18): finish the deletes a restart or a failure left (book_purge); never raises."""
    try:
        return await asyncio.to_thread(book_purge.purge_left)
    except Exception as error:  # noqa: BLE001 - a failed purge must not stop the sweep
        print(f"Purge of deleted books failed: {error}")
        return []


async def sweep_forever() -> None:
    while True:
        purged = await purge_deleted()
        if purged:
            print(f"Purged deleted books: {purged}")
        report = await sweep()
        if report["resumed"] or report["gave_up"]:
            print(f"Ingestion sweep: {report}")
        await asyncio.sleep(max(MIN_SWEEP_SECONDS, jobs.stale_minutes() * 60))
