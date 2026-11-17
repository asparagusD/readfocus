"""Prose-only text per chunk, stored once a book's regions are known (C18.6b).

After the regions job (region_job.run_job) has written a book's page_regions,
`rebuild` lines its chunks up with them (backend/regions/prose.py) and stores
each chunk's `prose`, `anchors` and `garbled_sentences` (migration 020).
Chunks whose agent text changed are embedded again from their prose, their
unused questions are deleted and the question generation agent runs on them
again (it reads prose and saves the chunk's concepts); questions already used
in a session stay. `content` is never written.

Idempotent: a chunk whose stored prose, anchors and count are already right
is not written, so a second run changes nothing. A book without regions is
left alone. `after_regions` never raises: the book stays readable either way.
"""

import asyncio

from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.nlp import embedder
from backend.regions import prose
from backend.services import pdf_text
from backend.services.supabase_client import supabase

question_agent = QuestionGenerationAgent()
PAGE = 1000  # rows per select: PostgREST returns at most 1000 at a time
BATCH = 16   # chunks embedded and questioned together


def pdf_page_texts(file_bytes: bytes) -> list[str]:
    """pypdf's text of every page, empty pages included, as ingestion reads it (a few pages per reader, C18.G)."""
    return [text.replace("\x00", "") for text in pdf_text.page_texts(file_bytes)]


def _rows(table: str, columns: str, book_id: str, order: str, shape=None) -> list[dict]:
    """Every row of the book, PAGE at a time; `shape` trims each page of rows as it arrives."""
    out, start = [], 0
    while True:
        rows = (supabase.table(table).select(columns).eq("book_id", book_id).order(order).order("id")  # id: a unique tiebreak
                .range(start, start + PAGE - 1).execute().data or [])
        out += [shape(row) for row in rows] if shape else rows
        if len(rows) < PAGE:
            return out
        start += PAGE


CHUNK_COLUMNS = "*"  # works before migration 020 adds prose, anchors and garbled_sentences
REGION_COLUMNS = ("id", "kind", "page", "text", "order_in_page", "spine_index", "anchor", "meta")
# What backend/regions/prose.py reads of a region's meta; fonts, garble scores and boxes are left behind (C18.G:
# kept, they were most of the rebuild's memory on a 769-page book).
PROSE_META = ("equation_number", "label", "caption", "alt", "labels", "inline_math")


def _slim(region: dict) -> dict:
    meta = region.get("meta") or {}
    return {**{key: region.get(key) for key in REGION_COLUMNS},
            "meta": {key: meta[key] for key in PROSE_META if key in meta}}


def load(book_id: str) -> tuple[list[dict], list[dict]]:
    """The book's stored regions (only what prose needs) and chunks (in chunk order)."""
    regions = _rows("page_regions", ", ".join(REGION_COLUMNS), book_id, "order_in_page", _slim)
    chunks = sorted(_rows("chunks", CHUNK_COLUMNS, book_id, "chunk_index"), key=lambda row: row["chunk_index"])
    return regions, chunks


def plan(book: dict, file_bytes: bytes, regions: list[dict], chunks: list[dict]) -> tuple[list, dict]:
    """What a rebuild would write: [(chunk row, values, text changed)] and the report. No writes."""
    report = {"chunks": len(chunks), "stored": 0, "requestioned": 0, "garbled": 0, "placeholders": 0}
    if not regions or not chunks:
        return [], report
    contents = [row["content"] for row in chunks]
    if book["file_type"] == "pdf":
        built = prose.pdf_prose(contents, pdf_page_texts(file_bytes), regions)
    else:
        blocks = [row.get("blocks") for row in chunks]
        paths = [row.get("block_paths") for row in chunks]
        built = prose.epub_prose(contents, blocks if all(blocks) else None, paths if all(paths) else None, regions)
    writes = []
    for row, new in zip(chunks, built):
        garbled = new["garbled"]  # sentences replaced by "[Unreadable text, p. N]" (C18.G)
        report["garbled"] += garbled
        report["placeholders"] += len((new["anchors"] or {}).get("placeholders") or [])
        values = {"prose": new["prose"], "anchors": new["anchors"], "garbled_sentences": garbled}
        if all(row.get(key) == value for key, value in values.items()):
            continue
        changed = new["prose"] != (row.get("prose") or row["content"])
        writes.append((row, values, changed))
        report["stored"] += 1
        report["requestioned"] += changed
    return writes, report


def rebuild(book: dict, file_bytes: bytes) -> dict:
    """Store every chunk's prose, anchors and garbled count; embed and question again the chunks that changed."""
    writes, report = plan(book, file_bytes, *load(book["id"]))
    pdf_text.release_memory()  # the regions and page texts are no longer needed (C18.G)
    for row, values, changed in writes:
        if not changed:
            supabase.table("chunks").update(values).eq("id", row["id"]).execute()
    changed = [(row, values) for row, values, text_changed in writes if text_changed]
    for start in range(0, len(changed), BATCH):
        batch = changed[start:start + BATCH]
        vectors = embedder.embed([values["prose"] for _, values in batch])
        for (row, values), vector in zip(batch, vectors):
            supabase.table("chunks").update({**values, "embedding_local": [float(v) for v in vector]}).eq(
                "id", row["id"]).execute()
        ids = [row["id"] for row, _ in batch]
        supabase.table("question_bank").delete().in_("chunk_id", ids).eq("times_used", 0).execute()
        question_agent.run(book["id"], ids)
    return report


async def after_regions(book: dict, file_bytes: bytes) -> dict | None:
    """Rebuild the book's prose once its regions job is done: the report, or None if it failed. Never raises."""
    try:
        report = await asyncio.to_thread(rebuild, book, file_bytes)
        print(f"Prose of book {book['id']}: {report}")
        return report
    except Exception as error:  # noqa: BLE001 - prose is extra; the book reads from content without it
        print(f"Prose of book {book.get('id')} not rebuilt: {error}")
        return None
