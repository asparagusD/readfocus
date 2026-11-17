"""Store file_sha256, file_bytes, file_format and page_count for books uploaded before C17.1.

Takes books with no file_sha256, oldest id first. file_format is copied from
file_type. A book whose original is in Storage is downloaded once to hash and
measure it (and count a PDF's pages); a book with no storage_path gets
file_format only. storage_mode keeps migration 016's default, 'cloud'. Only
those columns are written, in one update per book. A hashed book is never
pending again; a book with no stored file stays pending and a second run only
writes the same file_format again.

Needs migration 016 applied. Run from the repo root with the virtualenv active:

    python scripts/backfill_book_files.py --dry-run
    python scripts/backfill_book_files.py [--limit N] [--book-id UUID]

--dry-run downloads and hashes but writes nothing. It refuses to run unless
ENV=development in .env; any other database needs --allow-non-dev and the
user's explicit approval and a fresh dump (CLAUDE.md, hard constraint 2).
"""

import argparse
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.backfill_structure import check_environment, run  # noqa: E402


def pending_rows(supabase, limit=None, book_id=None) -> list[dict]:
    query = supabase.table("books").select("id, title, file_type, storage_path").is_("file_sha256", "null")
    if book_id:
        query = query.eq("id", book_id)
    rows = sorted(query.execute().data, key=lambda r: r["id"])
    return rows[:limit] if limit is not None else rows


def file_fields(row, download, page_count) -> dict:
    """The new columns for one book; the file is read only when it is in Storage."""
    fmt = str(row["file_type"]).lower()
    fields: dict = {"file_format": fmt}
    if row.get("storage_path"):
        data = download(row["storage_path"])
        fields.update(file_bytes=len(data), page_count=page_count(fmt, data),
                      file_sha256=hashlib.sha256(data).hexdigest())
    return fields


def backfill_book(row, supabase, download, page_count, dry_run=False) -> str:
    fields = file_fields(row, download, page_count)
    summary = ", ".join(f"{key}={value}" for key, value in fields.items() if key != "file_sha256")
    if dry_run:
        return f"would store {summary}"
    supabase.table("books").update(fields).eq("id", row["id"]).execute()
    return f"stored {summary}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="download and hash; write nothing")
    parser.add_argument("--limit", type=int, help="stop after this many books")
    parser.add_argument("--book-id", help="only this book")
    parser.add_argument("--allow-non-dev", action="store_true", help="run although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    check_environment(args.allow_non_dev)
    from backend.routers.books import pdf_page_count
    from backend.services.book_ingestor import download
    from backend.services.supabase_client import supabase

    rows = pending_rows(supabase, args.limit, args.book_id)
    print(f"ENV={os.getenv('ENV')}; books without a file hash: {len(rows)}")
    done = run(rows, lambda row: backfill_book(row, supabase, download, pdf_page_count, args.dry_run),
               report=lambda row, outcome: print(f"  {row['id']}  {row['title']!r}: {outcome}", flush=True))
    print(f"{'checked' if args.dry_run else 'handled'} {done} books")
    return 0


if __name__ == "__main__":
    sys.exit(main())
