"""Look up Open Library covers for books ingested before C11.2.

Takes ready books whose cover was never looked up (cover_source null) or
whose lookup failed (cover_source 'error'), oldest id first, and runs the
same lookup as ingestion: the file's metadata (read from Storage) with the
typed title and author as the fallback. A book found to have no cover
('none') or already given one is never asked again, so a second run after
a complete one does nothing. Open Library asks clients not to bulk-harvest:
one book at a time, at least PAUSE_SECONDS apart, and --limit to stop early.

Run from the repo root with the virtualenv active:

    python scripts/backfill_covers.py --dry-run
    python scripts/backfill_covers.py [--limit N] [--book-id UUID]

It refuses to run unless ENV=development in .env. Running it against any
other database needs --allow-non-dev and the user's explicit approval
(CLAUDE.md, hard constraint 2).
"""

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Open Library allows unidentified clients one request a second; each book
# makes one search (the cover image by ID is not rate-limited).
PAUSE_SECONDS = 1.5


def check_environment(allow_non_dev: bool) -> None:
    env = os.getenv("ENV")
    if env != "development" and not allow_non_dev:
        raise SystemExit(f"refusing to run: ENV is {env!r}, not 'development' (see --allow-non-dev)")


def run(rows, look_up, dry_run=False, pause=time.sleep, report=None) -> int:
    """Look up each row's cover in order, pausing between books; returns how many were handled.

    With dry_run nothing is fetched or written. `look_up(row)` returns the
    saved outcome ({"cover_url", "cover_source"}).
    """
    for index, row in enumerate(rows):
        outcome = None
        if not dry_run:
            if index:
                pause(PAUSE_SECONDS)
            try:
                outcome = look_up(row)
            except Exception as e:  # noqa: BLE001 - one bad book must not stop the run
                print(f"  {row['id']}: lookup failed: {e}", flush=True)
                outcome = {"cover_url": None, "cover_source": "error"}
        if report:
            report(row, outcome)
    return len(rows)


def look_up(row, book_ingestor, covers) -> dict:
    """Same terms as ingestion; a book whose file cannot be read falls back to its typed title."""
    meta = (None, None)
    if row.get("storage_path"):
        try:
            meta = book_ingestor.extract_metadata(row["file_type"], book_ingestor.download(row["storage_path"]))
        except Exception as e:  # noqa: BLE001
            print(f"  {row['id']}: file not read ({e}); using the typed title", flush=True)
    return covers.ensure_cover(row["id"], *covers.lookup_terms(*meta, row["title"], row["author"]))


def pending_rows(supabase, limit=None, book_id=None) -> list[dict]:
    columns = "id, title, author, file_type, storage_path, cover_source"
    rows = []
    for narrow in (lambda q: q.is_("cover_source", "null"), lambda q: q.eq("cover_source", "error")):
        query = narrow(supabase.table("books").select(columns).eq("status", "ready"))
        if book_id:
            query = query.eq("id", book_id)
        rows += query.execute().data
    rows.sort(key=lambda r: r["id"])
    return rows[:limit] if limit is not None else rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="list the books; fetch and write nothing")
    parser.add_argument("--limit", type=int, help="stop after this many books")
    parser.add_argument("--book-id", help="only this book")
    parser.add_argument("--allow-non-dev", action="store_true", help="run although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    check_environment(args.allow_non_dev)
    from backend.services import book_ingestor, covers
    from backend.services.supabase_client import supabase

    def report(row, outcome):
        result = "would look up" if outcome is None else outcome["cover_source"]
        print(f"  {row['id']}  {row['title']!r}: {result}", flush=True)

    rows = pending_rows(supabase, args.limit, args.book_id)
    print(f"ENV={os.getenv('ENV')}; books to look up: {len(rows)}")
    done = run(rows, lambda row: look_up(row, book_ingestor, covers), args.dry_run, report=report)
    print(f"{'would look up' if args.dry_run else 'looked up'} {done} books")
    return 0


if __name__ == "__main__":
    sys.exit(main())
