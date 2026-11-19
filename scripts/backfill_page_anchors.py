"""Give a PDF read from OCR or from the reader's browser its page map (DEBUG_LOG 2026-11-19 C36.G).

Such a book was ingested with no chunk anchors and contents entries without pages, so a quiz range found no words
("There is nothing to ask about yet") and the reader's place no chunk. Since the C36.G fix ingestion writes them;
this script does it for books ingested before:

- a ready PDF whose chunks have no `anchors` and whose pages' texts are in `page_ocr` (a browser-text book, or a
  fully scanned one read by OCR);
- its chunks are checked to be cut from exactly those texts (the same characters, whitespace aside), else the book
  is reported and left alone;
- each chunk with no anchors gets `book_ingestor.page_anchors` (pages and per-page spans; a chunk that has anchors
  is never touched), and `books.toc` gets the pages of entries that have a chunk but no page.

Idempotent: a second run finds nothing to do. Run from the repo root with the virtualenv active:

    python scripts/backfill_page_anchors.py --dry-run [--book-id UUID]
    python scripts/backfill_page_anchors.py [--book-id UUID] [--limit N]

--dry-run reads and reports but writes nothing. It refuses to run unless ENV=development in .env; any other database
needs --allow-non-dev, and a write needs the user's explicit approval and a fresh dump (CLAUDE.md, constraint 2).
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.backfill_structure import check_environment, run

PAGE = 1000  # PostgREST returns at most 1000 rows per select


def _all(supabase, table: str, columns: str, book_id: str, order: str) -> list[dict]:
    rows, start = [], 0
    while True:
        batch = (supabase.table(table).select(columns).eq("book_id", book_id).order(order)
                 .range(start, start + PAGE - 1).execute().data or [])
        rows += batch
        if len(batch) < PAGE:
            return rows
        start += PAGE


def pending_rows(supabase, limit=None, book_id=None) -> list[dict]:
    """Ready PDFs, in id order (each is checked for missing anchors when handled)."""
    query = supabase.table("books").select("id, title, file_type, toc, source_format").eq("status", "ready").eq(
        "file_type", "pdf")
    if book_id:
        query = query.eq("id", book_id)
    rows = sorted(query.execute().data or [], key=lambda r: r["id"])
    return rows[:limit] if limit is not None else rows


def squeeze(text: str) -> str:
    return "".join(text.split())


def backfill_book(row, supabase, book_ingestor, dry_run=False) -> str:
    chunks = _all(supabase, "chunks", "id, chunk_index, content, anchors", row["id"], "chunk_index")
    missing = [c for c in chunks if not (c.get("anchors") or {}).get("pages")]
    if not chunks or not missing:
        return "nothing to do"
    texts = {int(r["page"]): r["text"] for r in _all(supabase, "page_ocr", "page, text", row["id"], "page")
             if (r.get("text") or "").strip()}
    if not texts:
        return "skipped: no page texts"
    contents = [c["content"] for c in chunks]
    if squeeze("".join(contents)) != squeeze("".join(texts[n] for n in sorted(texts))):
        return "skipped: its chunks were not cut from these page texts"
    anchors = book_ingestor.page_anchors({"file_type": "pdf"}, contents, [], texts)
    toc = book_ingestor.toc_with_pages(row.get("toc"), anchors)
    pages_added = sum(1 for old, new in zip(row.get("toc") or [], toc or []) if old.get("page") != new.get("page"))
    verb = "would add" if dry_run else "added"
    if not dry_run:
        for chunk in missing:
            supabase.table("chunks").update({"anchors": anchors[chunk["chunk_index"]]}).eq("id", chunk["id"]).execute()
        if pages_added:
            supabase.table("books").update({"toc": toc}).eq("id", row["id"]).execute()
    return f"{verb} pages to {len(missing)} of {len(chunks)} chunks and {pages_added} contents entries"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="read and report; write nothing")
    parser.add_argument("--limit", type=int, help="stop after this many books")
    parser.add_argument("--book-id", help="only this book")
    parser.add_argument("--allow-non-dev", action="store_true", help="run although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    check_environment(args.allow_non_dev)
    from backend.services import book_ingestor
    from backend.services.supabase_client import supabase

    rows = pending_rows(supabase, args.limit, args.book_id)
    count = run(rows, lambda row: backfill_book(row, supabase, book_ingestor, args.dry_run),
                lambda row, outcome: print(f"{row['id']} {row.get('title', '')[:40]!r}: {outcome}", flush=True))
    print(f"{count} books checked{' (dry run, nothing written)' if args.dry_run else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
