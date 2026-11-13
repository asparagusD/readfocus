"""The regions job: read a PDF's pages into page_regions, in batches, resumable (C18.2b).

A job of kind "regions" in processing_jobs (migration 018) runs after a
book's ingestion has finished, so reading never waits for it. It reads the
file PAGES_PER_BATCH pages at a time through backend.regions.extract,
reopening it for each batch (opened once, pdfminer keeps every object and a
long book reaches 280 MB; docs/BENCHMARKS.md, C18.2), writes each page's
blocks as regions of kind 'block' (classified later, C18.3 to C18.5), and
saves the cursor (pages done) after every batch. A batch run again first
deletes its pages' rows, so a resumed job rewrites and never duplicates.

A failed regions job is recorded on its row and never changes the book's
status. EPUBs get their regions from their structure (C18.5); device-only
books have no file on the server to resume from, so neither gets a job.
"""

import asyncio
from collections import Counter
from statistics import median

from backend.regions.garble import garble_score
from backend.services import processing_jobs as jobs
from backend.services.supabase_client import supabase

PAGES_PER_BATCH = 20
TABLE = "page_regions"
TOP_FONTS = 5


def block_rows(book: dict, page) -> list[dict]:
    """One page_regions row per block of an extract.Page, in reading order. Pure."""
    rows = []
    for order, block in enumerate(page.blocks):
        text = "\n".join(line.text for line in block.lines)
        fonts = Counter(char.font for line in block.lines for char in line.chars)
        score = garble_score(text)
        rows.append({
            "user_id": book["user_id"], "book_id": book["id"], "page": page.page, "kind": "block",
            "bbox": [block.x0, block.top, block.x1, block.bottom], "text": text, "order_in_page": order,
            "meta": {"lines": len(block.lines), "size": median(line.size for line in block.lines),
                     "upright": block.lines[0].upright, "fonts": dict(fonts.most_common(TOP_FONTS)),
                     "garble": {"ratio": round(score["ratio"], 4), "reasons": score["reasons"]}},
        })
    return rows


def batches(total: int, cursor: int, size: int):
    """(first, last) 1-based page ranges after `cursor` pages are done."""
    for first in range(cursor + 1, total + 1, size):
        yield first, min(first + size - 1, total)


def queue(book: dict) -> dict | None:
    """Create and claim the book's regions job; None for an EPUB, a device-only book, or a job already taken."""
    if book.get("file_type") != "pdf" or not book.get("storage_path"):
        return None
    return jobs.claim(jobs.create(book["id"], book["user_id"], kind=jobs.REGIONS))


def _read(file_bytes: bytes, first: int, last: int) -> list:
    # Imported here: pdfplumber loads with the first job, not at startup.
    from backend.regions import extract

    return list(extract.iter_pages(file_bytes, first, last))


def _count(file_bytes: bytes) -> int:
    from backend.regions import extract

    return extract.page_count(file_bytes)


def _store(book: dict, first: int, last: int, pages: list) -> None:
    (supabase.table(TABLE).delete().eq("book_id", book["id"]).gte("page", first).lte("page", last).execute())
    rows = [row for page in pages for row in block_rows(book, page)]
    if rows:
        supabase.table(TABLE).insert(rows).execute()


async def run_job(job: dict, file_bytes: bytes | None = None) -> dict:
    """Read the claimed job's pages from its cursor; the cursor is saved after each batch."""
    book = supabase.table("books").select("id, user_id, file_type, storage_path").eq(
        "id", job["book_id"]).execute().data[0]
    try:
        if file_bytes is None:
            file_bytes = await asyncio.to_thread(supabase.storage.from_("books").download, book["storage_path"])
        total = await asyncio.to_thread(_count, file_bytes)
        for first, last in batches(total, job["cursor"], PAGES_PER_BATCH):
            pages = await asyncio.to_thread(_read, file_bytes, first, last)
            _store(book, first, last, pages)
            jobs.advance(job["id"], last, total)
        jobs.finish(job["id"], total)
        return {"status": "done", "pages": total}
    except Exception as error:  # noqa: BLE001 - recorded on the job; the book stays as it is
        print(f"Regions of book {job['book_id']} stopped: {error}")
        jobs.fail(job["id"], str(error))
        return {"status": "failed", "error": str(error)}


async def after_ingest(book: dict, file_bytes: bytes | None = None) -> None:
    """Queue and run the book's regions job once its ingestion is done. Never raises."""
    try:
        job = queue(book)
        if job:
            await run_job(job, file_bytes)
    except Exception as error:  # noqa: BLE001 - the region map must never break ingestion
        print(f"Regions of book {book.get('id')} could not start: {error}")
