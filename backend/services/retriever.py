"""Hybrid retrieval over one book's chunks. No API calls.

Two searches run side by side and are merged with reciprocal rank fusion:

- vector: the query is embedded locally (backend/nlp/embedder.py) and
  matched against chunks.embedding_local by match_chunks_local (005);
- text: the query's content words go to Postgres full-text search through
  search_chunks_text (006).

Either search may come back empty or fail (a book with no local embeddings
yet, the model not on disk); the other still answers. Callers must have
checked that the book belongs to the user: the backend's database client
is not narrowed by row-level security.
"""

import asyncio
import logging
from collections import Counter

from backend.nlp import embedder, text
from backend.services.supabase_client import supabase

logger = logging.getLogger(__name__)

RRF_K = 60            # reciprocal rank fusion constant: score = sum of 1 / (RRF_K + rank)
CANDIDATES = 20       # rows asked of each search before fusing
MAX_QUERY_TERMS = 12  # content words sent to the text search


def rrf_fuse(rankings: list[list[dict]], k: int = RRF_K) -> list[dict]:
    """Merge ranked lists of rows (each with `id`) into one, best first.

    A row scores 1 / (k + rank) in every list it appears in, rank counted
    from 1. Ties go to the earlier chunk. Pure.
    """
    fused: dict[str, dict] = {}
    for ranking in rankings:
        for rank, row in enumerate(ranking, start=1):
            entry = fused.setdefault(row["id"], {**row, "score": 0.0})
            entry["score"] += 1.0 / (k + rank)
    return sorted(fused.values(), key=lambda row: (-row["score"], row["chunk_index"]))


def text_query(query: str) -> str:
    """The query's content words joined with "or", most frequent first.

    websearch_to_tsquery would otherwise require every word, and a whole
    passage as the query would then match nothing but itself.
    """
    counts = Counter(text.content_words(query))
    return " or ".join(word for word, _ in counts.most_common(MAX_QUERY_TERMS))


def _vector_search(query: str, book_id: str) -> list[dict]:
    vector = [float(value) for value in embedder.embed_one(query)]
    result = supabase.rpc("match_chunks_local", {
        "query_embedding": vector, "match_count": CANDIDATES, "p_book_id": book_id,
    }).execute()
    return result.data or []


def _text_search(query: str, book_id: str) -> list[dict]:
    terms = text_query(query)
    if not terms:
        return []
    result = supabase.rpc("search_chunks_text", {
        "query_text": terms, "match_count": CANDIDATES, "p_book_id": book_id,
    }).execute()
    return result.data or []


async def search(query_text: str, book_id: str, k: int = 3) -> list[dict]:
    """The `k` chunks of a book that best match the query: id, chunk_index, content, score."""
    if not query_text.strip():
        return []
    results = await asyncio.gather(
        asyncio.to_thread(_vector_search, query_text, book_id),
        asyncio.to_thread(_text_search, query_text, book_id),
        return_exceptions=True,
    )
    rankings = []
    for name, result in zip(("vector", "text"), results):
        if isinstance(result, BaseException):
            logger.warning("%s search failed for book %s: %s", name, book_id, result)
        else:
            rankings.append(result)
    return rrf_fuse(rankings)[:k]


async def get_similar_chunks(query_text: str, book_id: str, k: int = 3) -> list[str]:
    """The text of the `k` chunks of a book most related to the query."""
    return [row["content"] for row in await search(query_text, book_id, k)]
