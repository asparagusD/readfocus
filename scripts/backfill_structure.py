"""Store reader blocks and a table of contents for books ingested before C12.1.

Takes ready books with no toc (books.toc null), oldest id first, and builds
blocks from each book's stored chunks, never from a fresh extraction: a PDF
extracted again today can differ in whitespace from what was stored (pypdf
was unpinned before 2026-11-10; DEBUG_LOG 2026-11-11 C12.1c), and the
reader must show the stored text. An EPUB's file is read from Storage for
its tags; its blocks are aligned to the stored chunks ignoring whitespace,
and fall back to text blocks if the text differs. chunks.content is never
written. It writes chunks.blocks for each chunk and then books.toc, last,
so a run stopped halfway redoes that book next time, and a book done once
is never pending again: running it twice changes nothing.

Run from the repo root with the virtualenv active:

    python scripts/backfill_structure.py --dry-run
    python scripts/backfill_structure.py [--limit N] [--book-id UUID]

--dry-run builds the blocks but writes nothing. It refuses to run unless
ENV=development in .env. Running it against any other database needs
--allow-non-dev and the user's explicit approval (CLAUDE.md, hard
constraint 2).
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def check_environment(allow_non_dev: bool) -> None:
    env = os.getenv("ENV")
    if env != "development" and not allow_non_dev:
        raise SystemExit(f"refusing to run: ENV is {env!r}, not 'development' (see --allow-non-dev)")


def pending_rows(supabase, limit=None, book_id=None) -> list[dict]:
    query = supabase.table("books").select("id, title, file_type, storage_path").eq("status", "ready").is_(
        "toc", "null")
    if book_id:
        query = query.eq("id", book_id)
    rows = sorted(query.execute().data, key=lambda r: r["id"])
    return rows[:limit] if limit is not None else rows


def stored_contents(supabase, book_id: str) -> list[str]:
    rows = supabase.table("chunks").select("chunk_index, content").eq("book_id", book_id).execute().data
    return [row["content"] for row in sorted(rows, key=lambda r: r["chunk_index"])]


def backfill_book(row, supabase, book_ingestor, book_structure, dry_run=False) -> str:
    """One book: blocks and toc built from its stored chunks; the file is read only for an EPUB's tags."""
    chunks = stored_contents(supabase, row["id"])
    data = b""
    if row["file_type"].lower() == "epub" and row.get("storage_path"):
        data = book_ingestor.download(row["storage_path"])
    blocks, toc = book_structure.build(row["file_type"], data, chunks)
    if blocks is None:
        return "error: structure not built"
    summary = f"{len(blocks)} chunks, {len(toc)} chapters"
    if dry_run:
        return f"would store {summary}"
    for index, chunk_blocks in enumerate(blocks):
        supabase.table("chunks").update({"blocks": chunk_blocks}).eq("book_id", row["id"]).eq(
            "chunk_index", index).execute()
    supabase.table("books").update({"toc": toc}).eq("id", row["id"]).execute()
    return f"stored {summary}"


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
    parser.add_argument("--dry-run", action="store_true", help="build the blocks; write nothing")
    parser.add_argument("--limit", type=int, help="stop after this many books")
    parser.add_argument("--book-id", help="only this book")
    parser.add_argument("--allow-non-dev", action="store_true", help="run although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    check_environment(args.allow_non_dev)
    from backend.services import book_ingestor, book_structure
    from backend.services.supabase_client import supabase

    rows = pending_rows(supabase, args.limit, args.book_id)
    print(f"ENV={os.getenv('ENV')}; books without a toc: {len(rows)}")
    done = run(rows, lambda row: backfill_book(row, supabase, book_ingestor, book_structure, args.dry_run),
               report=lambda row, outcome: print(f"  {row['id']}  {row['title']!r}: {outcome}", flush=True))
    print(f"{'checked' if args.dry_run else 'handled'} {done} books")
    return 0


if __name__ == "__main__":
    sys.exit(main())
