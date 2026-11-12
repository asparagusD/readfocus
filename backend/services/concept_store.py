"""The concepts of a book, stored once per (user, book, concept key).

save() takes the concepts backend/nlp/concepts.py found in a batch of
chunks and upserts one row per concept into the `concepts` table: the
first label seen is kept, `chunk_indices` grows with every chunk that
mentions the concept, and `weight` is the highest weight it has in any
chunk. link_key_terms() ties a question's key terms to concept keys.

merge_rows and link_key_terms are pure; save and concepts_for_chunks do the
I/O (two round trips and one). No model and no API calls.
"""

from backend.nlp.concepts import Concept, concept_key, normalize_phrase
from backend.services.supabase_client import supabase

CONFLICT_COLUMNS = "user_id,book_id,concept_key"
COLUMNS = "concept_key, label, chunk_indices, weight"


def merge_rows(existing: list[dict], extracted: list[tuple[dict, list[Concept]]]) -> list[dict]:
    """The rows to upsert: `existing` rows of the book merged with new (chunk, concepts) pairs.

    Only rows that are new or changed are returned, so a repeated batch gives none.
    """
    stored = {row["concept_key"]: row for row in existing}
    merged: dict[str, dict] = {}
    for chunk, concepts in extracted:
        for concept in concepts:
            if not concept.key:
                continue
            row = merged.get(concept.key) or {
                "user_id": chunk["user_id"], "book_id": chunk["book_id"], "concept_key": concept.key,
                "label": concept.label, "chunk_indices": [], "weight": 0.0, **stored.get(concept.key, {}),
            }
            row["chunk_indices"] = sorted({*row["chunk_indices"], chunk["chunk_index"]})
            row["weight"] = max(row["weight"] or 0.0, concept.weight)
            merged[concept.key] = row
    return [
        row for key, row in merged.items()
        if key not in stored or any(row[column] != stored[key][column] for column in ("chunk_indices", "weight"))
    ]


def save(extracted: list[tuple[dict, list[Concept]]]) -> int:
    """Upsert the concepts of a batch of one book's chunks. Returns the rows written. Safe to run again."""
    keys = sorted({concept.key for _, concepts in extracted for concept in concepts if concept.key})
    if not keys:
        return 0
    chunk = extracted[0][0]
    query = supabase.table("concepts").select(COLUMNS).eq("user_id", chunk["user_id"]).eq("book_id", chunk["book_id"])
    rows = merge_rows(query.in_("concept_key", keys).execute().data or [], extracted)
    if rows:
        supabase.table("concepts").upsert(rows, on_conflict=CONFLICT_COLUMNS).execute()
    return len(rows)


def concepts_for_chunks(user_id: str, book_id: str, chunk_indices: list[int]) -> list[dict]:
    """The reader's concepts of a book that any of these chunks mention."""
    if not chunk_indices:
        return []
    query = supabase.table("concepts").select(COLUMNS).eq("user_id", user_id).eq("book_id", book_id)
    return query.overlaps("chunk_indices", chunk_indices).execute().data or []


def link_key_terms(key_terms: list[str], concepts: list[dict]) -> list[str]:
    """The keys of the concepts a question's key terms name, in the order the concepts are given.

    A term names a concept when, after normalising (case, determiners,
    plurals), it is the concept's key or all of its words are words of it:
    "the deep foundations" names deep-foundation, "energy" names light-energy.
    """
    terms = [set(key.split("-")) for key in (concept_key(normalize_phrase(term)) for term in key_terms) if key]
    return list(dict.fromkeys(
        row["concept_key"] for row in concepts
        if any(words <= set(row["concept_key"].split("-")) for words in terms)
    ))
