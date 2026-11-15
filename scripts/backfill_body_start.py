"""Detect and store books.body_start for books that have none (C23.1, docs/FOCUS_RULES.md F2).

Takes ready books with no body_start, oldest id first, and runs the same detection as GET /books/{id}/body-start
(backend/services/body_start.py): the outline, then a heading in the region map, then the first page after the
contents with enough prose. Only body_start and body_start_source are written, one update per book, and only
where body_start is still null, so a reader's own choice (source user) is never overwritten. A book where
nothing is found stays null (the reader's GET tries again later, once its regions exist).

Needs migration 028 applied for a write. Run from the repo root with the virtualenv active:

    python scripts/backfill_body_start.py --dry-run
    python scripts/backfill_body_start.py [--limit N] [--book-id UUID]

--dry-run reads every ready book (whether or not it has a body start, so it also runs before 028 is applied)
and prints what would be stored; it writes nothing. A write refuses to run unless ENV=development in .env; any
other database needs --allow-non-dev and the user's explicit approval and a fresh dump (CLAUDE.md, hard
constraint 2). Dev and production share one project since Gate G4, so a write always needs that approval.
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.backfill_structure import check_environment, run

FIELDS = "id, title, file_type, toc"


def pending_rows(supabase, limit=None, book_id=None, dry_run=False) -> list[dict]:
    query = supabase.table("books").select(FIELDS).eq("status", "ready")
    if not dry_run:
        query = query.is_("body_start", "null")
    if book_id:
        query = query.eq("id", book_id)
    rows = sorted(query.execute().data, key=lambda r: r["id"])
    return rows[:limit] if limit is not None else rows


def backfill_book(row, supabase, body_start, dry_run=False) -> str:
    found = body_start.for_book(supabase, row)
    if not found:
        return "nothing found"
    start = found["body_start"]
    where = f"p. {start['page']}" if start["kind"] == "pdf" else f"section {start['spine_index']}"
    outcome = f"{found['source']}: {where} {start.get('title') or ''}".strip()
    if dry_run:
        return f"would store {outcome}"
    written = supabase.table("books").update({"body_start": start, "body_start_source": found["source"]}).eq(
        "id", row["id"]).is_("body_start", "null").execute().data
    return f"stored {outcome}" if written else "already set, kept"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="detect and print; write nothing")
    parser.add_argument("--limit", type=int, help="stop after this many books")
    parser.add_argument("--book-id", help="only this book")
    parser.add_argument("--allow-non-dev", action="store_true", help="write although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    if not args.dry_run:
        check_environment(args.allow_non_dev)
    from backend.services import body_start
    from backend.services.supabase_client import supabase

    rows = pending_rows(supabase, args.limit, args.book_id, args.dry_run)
    count = run(rows, lambda row: backfill_book(row, supabase, body_start, args.dry_run),
                lambda row, outcome: print(f"{row['id']}  {str(row.get('title'))[:40]:40}  {outcome}"))
    print(f"{count} book(s) {'checked' if args.dry_run else 'handled'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
