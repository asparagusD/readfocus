"""The regions job: read a PDF's pages into page_regions, in batches, resumable (C18.2b).

A job of kind "regions" in processing_jobs (migration 018) runs after a
book's ingestion has finished, so reading never waits for it. It reads the
file PAGES_PER_BATCH pages at a time through backend.regions.extract,
reopening it for each batch (opened once, pdfminer keeps every object and a
long book reaches 280 MB; docs/BENCHMARKS.md, C18.2), writes each page's
regions (display math as kind 'math' since C18.3, the rest as 'block' with
their inline math in meta until C18.4 and C18.5 classify them), and
saves the cursor (pages done) after every batch. A batch run again first
deletes its pages' rows, so a resumed job rewrites and never duplicates.

A failed regions job is recorded on its row and never changes the book's
status. Once a job is done the chunks' prose-only text is rebuilt from the
regions (prose_job, C18.6b). EPUBs get theirs from their structure (backend/regions/epub.py,
C18.5b), a spine document at a time; device-only books have no file on the
server to resume from, so they get no job.
"""

import asyncio
from collections import Counter
from statistics import median

from backend.regions.classify import classify_page
from backend.regions.garble import garble_score
from backend.services import pdf_text, prose_job
from backend.services import processing_jobs as jobs
from backend.services.supabase_client import supabase

PAGES_PER_BATCH = 20
TABLE = "page_regions"
TOP_FONTS = 5


def block_rows(book: dict, page) -> list[dict]:
    """One page_regions row per region of an extract.Page, in reading order. Pure.

    Display math is kind 'math' (C18.3); the rest stays 'block' until code, figures and tables are
    told apart (C18.4, C18.5), with its inline math as character ranges in meta.inline_math.
    """
    rows = []
    for order, region in enumerate(classify_page(page)):
        fonts = Counter(char.font for line in region.lines for char in line.chars)
        score = garble_score(region.text)
        rows.append({
            "user_id": book["user_id"], "book_id": book["id"], "page": page.page, "kind": region.kind,
            "bbox": [round(v, 2) for v in region.bbox], "text": region.text, "order_in_page": order,
            "meta": {**region.meta, "lines": len(region.lines),
                     "size": median(line.size for line in region.lines) if region.lines else None,
                     "upright": region.lines[0].upright if region.lines else True,
                     "fonts": dict(fonts.most_common(TOP_FONTS)),
                     "garble": {"ratio": round(score["ratio"], 4), "reasons": score["reasons"]}},
        })
    return rows


def batches(total: int, cursor: int, size: int):
    """(first, last) 1-based page ranges after `cursor` pages are done."""
    for first in range(cursor + 1, total + 1, size):
        yield first, min(first + size - 1, total)


def epub_rows(book: dict, regions: list[dict]) -> list[dict]:
    """page_regions rows for EPUB regions (C18.5b): no page or box, an anchor and a spine item instead. Pure."""
    rows = []
    for region in regions:
        score = garble_score(region["text"])
        rows.append({"user_id": book["user_id"], "book_id": book["id"], "page": None, "bbox": None,
                     "spine_index": region["spine_index"], "anchor": region["anchor"], "kind": region["kind"],
                     "text": region["text"], "order_in_page": region["order"],
                     "meta": {**region["meta"], "path": region["path"],
                              "garble": {"ratio": round(score["ratio"], 4), "reasons": score["reasons"]}}})
    return rows


def queue(book: dict) -> dict | None:
    """Create and claim the book's regions job; None for a device-only book or a job already taken."""
    if book.get("file_type") not in ("pdf", "epub") or not book.get("storage_path"):
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


async def _run_epub(job: dict, book: dict, file_bytes: bytes) -> int:
    """An EPUB's regions, written PAGES_PER_BATCH spine documents at a time; the cursor counts documents."""
    from backend.regions import epub

    found = await asyncio.to_thread(epub.epub_regions, file_bytes)
    total = await asyncio.to_thread(epub.spine_count, file_bytes)
    for first, last in batches(total, job["cursor"], PAGES_PER_BATCH):
        low, high = first - 1, last - 1
        (supabase.table(TABLE).delete().eq("book_id", book["id"]).gte("spine_index", low).lte("spine_index", high)
         .execute())
        rows = epub_rows(book, [r for r in found if low <= r["spine_index"] <= high])
        if rows:
            supabase.table(TABLE).insert(rows).execute()
        jobs.advance(job["id"], last, total)
    return total


async def run_job(job: dict, file_bytes: bytes | None = None) -> dict:
    """Read the claimed job's pages (PDF) or spine documents (EPUB) from its cursor, saved after each batch."""
    book = supabase.table("books").select("id, user_id, file_type, storage_path").eq(
        "id", job["book_id"]).execute().data[0]
    try:
        if file_bytes is None:
            file_bytes = await asyncio.to_thread(supabase.storage.from_("books").download, book["storage_path"])
        if book["file_type"] == "epub":
            total = await _run_epub(job, book, file_bytes)
            jobs.finish(job["id"], total)
            prose = await prose_job.after_regions(book, file_bytes)  # C18.6b: the agents' prose from the regions
            return {"status": "done", "pages": total, "prose": prose}
        total = await asyncio.to_thread(_count, file_bytes)
        for first, last in batches(total, job["cursor"], PAGES_PER_BATCH):
            pages = await asyncio.to_thread(_read, file_bytes, first, last)
            _store(book, first, last, pages)
            del pages
            pdf_text.release_memory()  # this batch's pdfplumber pages go back (C18.G)
            jobs.advance(job["id"], last, total)
        jobs.finish(job["id"], total)
        prose = await prose_job.after_regions(book, file_bytes)  # C18.6b: the agents' prose from the regions
        return {"status": "done", "pages": total, "prose": prose}
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
