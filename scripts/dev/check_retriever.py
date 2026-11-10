"""Integration check of the hybrid retriever against the dev database.

Uploads nothing to Storage. It chunks sample.pdf, embeds the chunks with
the local model, inserts them as a fixture book owned by dev test user A,
runs backend.services.retriever.search against it, and deletes the book
again (its chunks go with it). Exits 1 if an expectation fails.

Run from the repo root with the virtualenv active, .env pointing at the
dev project (ENV=development) and .env.test present:

    python scripts/dev/check_retriever.py
"""

import asyncio
import os
import sys
import time
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")
if os.getenv("ENV") != "development":
    raise SystemExit("refusing to run: ENV is not 'development'")

from backend.nlp import concepts, embedder
from backend.services import retriever
from backend.services.book_ingestor import chunk_text, extract_text_from_pdf
from backend.services.supabase_client import supabase

# A paraphrase with few words in common with the text, and the chunk it should find.
PARAPHRASE = ("How does the number of samples per training step affect the neural surrogate?", 3)


def insert_fixture(user_id: str, chunks: list[str]) -> str:
    book = supabase.table("books").insert({
        "user_id": user_id, "title": "C4.5 retriever fixture", "author": "check_retriever",
        "file_type": "pdf", "storage_path": f"{user_id}/c45-fixture.pdf", "status": "ready",
        "total_chunks": len(chunks), "total_words": sum(len(c.split()) for c in chunks),
    }).execute().data[0]
    vectors = embedder.embed(chunks)
    supabase.table("chunks").insert([
        {"book_id": book["id"], "user_id": user_id, "chunk_index": i, "word_count": len(chunk.split()),
         "content": chunk, "embedding_local": [float(v) for v in vectors[i]]}
        for i, chunk in enumerate(chunks)
    ]).execute()
    return book["id"]


def main() -> int:
    user_id = dotenv_values(ROOT / ".env.test")["TEST_USER_A_ID"]
    chunks = chunk_text(extract_text_from_pdf((ROOT / "sample.pdf").read_bytes()))
    cases = [
        (" ".join(c.label for c in concepts.extract_concepts(chunks[i], top_k=4, use_embeddings=False)), i)
        for i in range(1, len(chunks) - 1, 2)
    ] + [PARAPHRASE]
    failures = 0
    book_id = insert_fixture(user_id, chunks)
    try:
        print(f"fixture book {book_id}: {len(chunks)} chunks of sample.pdf")
        for query, expected in cases:
            vector = [r["chunk_index"] for r in retriever._vector_search(query, book_id)]
            words = [r["chunk_index"] for r in retriever._text_search(query, book_id)]
            start = time.perf_counter()
            fused = [r["chunk_index"] for r in asyncio.run(retriever.search(query, book_id, k=3))]
            took = (time.perf_counter() - start) * 1000
            ok = expected in fused
            failures += not ok
            print(f"{'ok  ' if ok else 'FAIL'} expect chunk {expected} in top 3: fused {fused} "
                  f"(vector {vector[:3]}, text {words[:3]}), {took:.0f} ms | {query!r}")
        supabase.table("chunks").update({"embedding_local": None}).eq("book_id", book_id).execute()
        query, expected = cases[0]
        fused = [r["chunk_index"] for r in asyncio.run(retriever.search(query, book_id, k=3))]
        ok = expected in fused and not retriever._vector_search(query, book_id)
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} no local embeddings: text search alone gives {fused}")
        texts = asyncio.run(retriever.get_similar_chunks(query, book_id))
        ok = len(texts) == 3 and all(isinstance(t, str) and t for t in texts)
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} get_similar_chunks returns {len(texts)} strings")
    finally:
        supabase.table("books").delete().eq("id", book_id).execute()
        left = supabase.table("chunks").select("id", count="exact").eq("book_id", book_id).limit(1).execute().count
        print(f"fixture removed; chunks left for it: {left}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
