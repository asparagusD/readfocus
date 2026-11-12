"""Fill chunks.embedding_local for chunks stored before local embeddings.

Idempotent and resumable: it only ever touches rows whose embedding_local
is null, in id order, so it can be stopped and run again, and a second
run after a complete one does nothing. Nothing else in a row is changed.

Run from the repo root with the virtualenv active:

    python scripts/backfill_local_embeddings.py --dry-run
    python scripts/backfill_local_embeddings.py [--batch-size 16] [--limit N] [--book-id UUID]

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

from backend.nlp import embedder


def check_environment(allow_non_dev: bool) -> None:
    env = os.getenv("ENV")
    if env != "development" and not allow_non_dev:
        raise SystemExit(f"refusing to run: ENV is {env!r}, not 'development' (see --allow-non-dev)")


def run(pending, save, batch_size=16, limit=None, dry_run=False, book_id=None, report=None) -> int:
    """Embed every pending chunk; returns how many were handled.

    `pending(after_id, limit, book_id)` returns the next rows (id, content)
    with no local embedding, in id order; `save(chunk_id, vector)` stores
    one. With dry_run the rows are counted and nothing is embedded or saved.
    """
    done, after = 0, ""
    while limit is None or done < limit:
        size = batch_size if limit is None else min(batch_size, limit - done)
        rows = pending(after, size, book_id)
        if not rows:
            break
        if not dry_run:
            vectors = embedder.embed([row["content"] or "" for row in rows])
            for row, vector in zip(rows, vectors):
                save(row["id"], [float(value) for value in vector])
        done += len(rows)
        after = rows[-1]["id"]
        if report:
            report(done)
    return done


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="count the chunks; embed and write nothing")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--limit", type=int, help="stop after this many chunks")
    parser.add_argument("--book-id", help="only this book")
    parser.add_argument("--allow-non-dev", action="store_true", help="run although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    check_environment(args.allow_non_dev)
    from backend.services.supabase_client import supabase

    def pending(after, limit, book_id):
        query = supabase.table("chunks").select("id, content").is_("embedding_local", "null")
        if after:
            query = query.gt("id", after)
        if book_id:
            query = query.eq("book_id", book_id)
        return query.order("id").limit(limit).execute().data

    def save(chunk_id, vector):
        supabase.table("chunks").update({"embedding_local": vector}).eq("id", chunk_id).execute()

    def count(with_local):
        query = supabase.table("chunks").select("id", count="exact")
        query = query.not_.is_("embedding_local", "null") if with_local else query.is_("embedding_local", "null")
        if args.book_id:
            query = query.eq("book_id", args.book_id)
        return query.limit(1).execute().count

    print(f"ENV={os.getenv('ENV')}; chunks without a local embedding: {count(False)}, with: {count(True)}")
    start = time.perf_counter()
    done = run(pending, save, args.batch_size, args.limit, args.dry_run, args.book_id,
               report=lambda n: print(f"  {n} chunks", flush=True) if n % (args.batch_size * 10) == 0 else None)
    took = time.perf_counter() - start
    verb = "would embed" if args.dry_run else "embedded"
    print(f"{verb} {done} chunks in {took:.1f} s; without a local embedding now: {count(False)}, with: {count(True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
