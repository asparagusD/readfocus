"""Give books ingested before C18.6 their region map and prose-only agent text.

Takes ready books with a file kept on the server (PDF or EPUB), oldest id
first. A book whose regions job is done gets its prose rebuilt from the
stored regions (backend/services/prose_job.py); any other book gets its
regions job, which rebuilds the prose when it finishes. Either way chunks
whose agent text changed are embedded again from their prose, their unused
questions deleted and the question bank and concepts generated again.
chunks.content is never written.

Idempotent: regions are rewritten per batch, never duplicated, and a chunk
whose prose is already right is not written, so a second run changes
nothing. A regions job running elsewhere is left alone.

Run from the repo root with the virtualenv active:

    python scripts/backfill_prose.py --dry-run
    python scripts/backfill_prose.py [--limit N] [--book-id UUID]

--dry-run reads each file and maps its regions in memory, then reports what
would be stored; it writes nothing. It refuses to run unless
ENV=development in .env. Running it against any other database needs
--allow-non-dev and the user's explicit approval (CLAUDE.md, hard
constraint 2); a run that writes also needs a fresh dump first.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import processing_jobs as jobs
from backend.services import prose_job, region_job


def check_environment(allow_non_dev: bool) -> None:
    env = os.getenv("ENV")
    if env != "development" and not allow_non_dev:
        raise SystemExit(f"refusing to run: ENV is {env!r}, not 'development' (see --allow-non-dev)")


def pending_rows(supabase, limit=None, book_id=None) -> list[dict]:
    query = supabase.table("books").select("id, user_id, title, file_type, storage_path").eq("status", "ready")
    if book_id:
        query = query.eq("id", book_id)
    rows = sorted((r for r in query.execute().data if r.get("storage_path") and r.get("file_type") in ("pdf", "epub")),
                  key=lambda r: r["id"])
    return rows[:limit] if limit is not None else rows


def file_regions(book: dict, data: bytes) -> list[dict]:
    """The page_regions rows the regions job would store, built in memory."""
    if book["file_type"] == "epub":
        from backend.regions import epub

        return region_job.epub_rows(book, epub.epub_regions(data))
    from backend.regions import extract

    total = extract.page_count(data)
    return [row for first, last in region_job.batches(total, 0, region_job.PAGES_PER_BATCH)
            for page in extract.iter_pages(data, first, last) for row in region_job.block_rows(book, page)]


def summary(report: dict | None, verb: str = "stored") -> str:
    if not report:
        return "prose not rebuilt"
    return (f"{verb} {report['stored']} of {report['chunks']} chunks, re-question {report['requestioned']}, "
            f"{report['placeholders']} placeholders, {report['garbled']} garbled")


async def backfill_book(row: dict, supabase, dry_run: bool = False) -> str:
    data = await asyncio.to_thread(supabase.storage.from_("books").download, row["storage_path"])
    job = jobs.get(row["id"], kind=jobs.REGIONS)
    done = job is not None and job["status"] == "done"
    if dry_run:
        stored, chunks = prose_job.load(row["id"])
        regions = stored if done else await asyncio.to_thread(file_regions, row, data)
        report = prose_job.plan(row, data, regions, chunks)[1]
        return f"{'regions done' if done else 'would map regions'}; {summary(report, 'would store')}"
    if done:
        return f"regions done; {summary(await asyncio.to_thread(prose_job.rebuild, row, data))}"
    claimed = jobs.claim(jobs.create(row["id"], row["user_id"], kind=jobs.REGIONS), manual=True)
    if claimed is None:
        return "skipped: regions job running"
    result = await region_job.run_job(claimed, data)
    if result.get("status") != "done":
        return f"error: regions job {result.get('status')}: {result.get('error')}"
    return f"mapped regions; {summary(result.get('prose'))}"


def run(rows, handle, report=None) -> int:
    """Handle each row in order; one failing book is reported and the run goes on."""
    for row in rows:
        try:
            outcome = handle(row)
        except Exception as e:  # noqa: BLE001 - one bad book must not stop the run
            outcome = f"error: {e}"
        if report:
            report(row, outcome)
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="map regions in memory; write nothing")
    parser.add_argument("--limit", type=int, help="stop after this many books")
    parser.add_argument("--book-id", help="only this book")
    parser.add_argument("--allow-non-dev", action="store_true", help="run although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    check_environment(args.allow_non_dev)
    from backend.services.supabase_client import supabase

    rows = pending_rows(supabase, args.limit, args.book_id)
    print(f"ENV={os.getenv('ENV')}; ready books kept on the server: {len(rows)}")
    done = run(rows, lambda row: asyncio.run(backfill_book(row, supabase, args.dry_run)),
               report=lambda row, outcome: print(f"  {row['id']}  {row.get('title')!r}: {outcome}", flush=True))
    print(f"{'checked' if args.dry_run else 'handled'} {done} books")
    return 0


if __name__ == "__main__":
    sys.exit(main())
