"""Rebuild EPUB block paths stored one step too deep (C23.G, docs/DEBUG_LOG.md 2026-11-15).

Before cd97676, an EPUB whose <body> tag carries attributes (Standard Ebooks put epub:type on it) had every
chunks.block_paths entry one /2 step too deep, so a reader's CFI never matched its block: focus quiz ranges
(and A6 lookups) fell back to a neighbouring block. This rebuilds the paths from each ready EPUB's stored file
with the fixed code and writes chunks.block_paths only, for the chunks whose paths differ. chunks.content,
chunks.blocks and books.toc (which uses spine indexes only) are never written. A book whose rebuilt blocks do
not match its stored blocks (text or count) is skipped untouched. A book kept on the reader's device has no
stored file and is left as it is. Running it twice changes nothing.

Run from the repo root with the virtualenv active:

    python scripts/backfill_block_paths.py                  # dry run: reports, writes nothing
    python scripts/backfill_block_paths.py --write [--limit N] [--book-id UUID]

It refuses to run unless ENV=development in .env; the shared Supabase project (CLAUDE.md, hard constraint 2)
needs --allow-non-dev only if ENV says otherwise, and every --write needs the user's explicit approval and a
fresh `supabase db dump` first.
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


def candidate_rows(supabase, limit=None, book_id=None) -> list[dict]:
    """Ready EPUBs with a stored file, oldest id first."""
    query = supabase.table("books").select("id, title, file_type, storage_path").eq("status", "ready")
    if book_id:
        query = query.eq("id", book_id)
    rows = sorted((r for r in query.execute().data
                   if str(r.get("file_type") or "").lower() == "epub" and r.get("storage_path")), key=lambda r: r["id"])
    return rows[:limit] if limit is not None else rows


def stored_chunks(supabase, book_id: str) -> list[dict]:
    rows = supabase.table("chunks").select("chunk_index, content, blocks, block_paths").eq("book_id", book_id).execute().data
    return sorted(rows, key=lambda r: r["chunk_index"])


def _texts(blocks) -> list[list[tuple]]:
    return [[(b.get("type"), b.get("text")) for b in chunk or []] for chunk in blocks]


def fix_book(row, supabase, book_ingestor, book_structure, write=False) -> str:
    """One book: its paths rebuilt from the stored file and stored chunks; only differing chunks are written."""
    chunks = stored_chunks(supabase, row["id"])
    data = book_ingestor.download(row["storage_path"])
    blocks, _toc, paths = book_structure.build_with_paths("epub", data, [c["content"] for c in chunks])
    if not paths or len(paths) != len(chunks):
        return "skipped: no block paths built"
    if _texts(blocks) != _texts([c.get("blocks") for c in chunks]):
        return "skipped: stored blocks differ from the file (not rebuilt)"
    changed = [i for i, c in enumerate(chunks) if c.get("block_paths") != paths[i]]
    if not changed:
        return "unchanged"
    if not write:
        return f"would rewrite {len(changed)} of {len(chunks)} chunks"
    for i in changed:
        supabase.table("chunks").update({"block_paths": paths[i]}).eq("book_id", row["id"]).eq(
            "chunk_index", chunks[i]["chunk_index"]).execute()
    return f"rewrote {len(changed)} of {len(chunks)} chunks"


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
    parser.add_argument("--write", action="store_true", help="write chunks.block_paths (default: dry run)")
    parser.add_argument("--limit", type=int, help="stop after this many books")
    parser.add_argument("--book-id", help="only this book")
    parser.add_argument("--allow-non-dev", action="store_true", help="run although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    check_environment(args.allow_non_dev)
    from backend.services import book_ingestor, book_structure
    from backend.services.supabase_client import supabase

    rows = candidate_rows(supabase, args.limit, args.book_id)
    print(f"ENV={os.getenv('ENV')}; ready EPUBs with a stored file: {len(rows)}; {'WRITE' if args.write else 'dry run'}")
    outcomes = []

    def report(row, outcome):
        outcomes.append(outcome)
        print(f"  {row['id']}  {row['title']!r}: {outcome}", flush=True)

    run(rows, lambda row: fix_book(row, supabase, book_ingestor, book_structure, args.write), report=report)
    kinds = {"unchanged": 0, "would rewrite": 0, "rewrote": 0, "skipped": 0, "error": 0}
    for outcome in outcomes:
        kinds[next(k for k in kinds if outcome.startswith(k))] += 1
    print("summary:", ", ".join(f"{k} {v}" for k, v in kinds.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
