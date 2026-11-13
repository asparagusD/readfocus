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
import io

from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.nlp import embedder
from backend.regions import prose
from backend.services.supabase_client import supabase

question_agent = QuestionGenerationAgent()
PAGE = 1000  # rows per select: PostgREST returns at most 1000 at a time
BATCH = 16   # chunks embedded and questioned together


def pdf_page_texts(file_bytes: bytes) -> list[str]:
    """pypdf's text of every page, empty pages included, as ingestion reads it."""
    from pypdf import PdfReader

    return [(page.extract_text() or "").replace("\x00", "") for page in PdfReader(io.BytesIO(file_bytes)).pages]


def _rows(table: str, columns: str, book_id: str, order: str) -> list[dict]:
    out, start = [], 0
    while True:
        rows = (supabase.table(table).select(columns).eq("book_id", book_id).order(order)
                .range(start, start + PAGE - 1).execute().data or [])
        out += rows
        if len(rows) < PAGE:
            return out
        start += PAGE


def rebuild(book: dict, file_bytes: bytes) -> dict:
    """Store every chunk's prose, anchors and garbled count; embed and question again the chunks that changed."""
    regions = _rows("page_regions", "*", book["id"], "order_in_page")
    chunks = sorted(_rows("chunks", "id, chunk_index, content, blocks, block_paths, prose, anchors, garbled_sentences",
                          book["id"], "chunk_index"), key=lambda row: row["chunk_index"])
    report = {"chunks": len(chunks), "stored": 0, "requestioned": 0, "garbled": 0, "placeholders": 0}
    if not regions or not chunks:
        return report
    contents = [row["content"] for row in chunks]
    if book["file_type"] == "pdf":
        built = prose.pdf_prose(contents, pdf_page_texts(file_bytes), regions)
    else:
        built = prose.epub_prose(contents, [row.get("blocks") for row in chunks] if all(
            row.get("blocks") for row in chunks) else None, [row.get("block_paths") for row in chunks] if all(
            row.get("block_paths") for row in chunks) else None, regions)
    changed = []
    for row, new in zip(chunks, built):
        garbled = prose.sentence_counts(new["prose"])["garbled"]
        report["garbled"] += garbled
        report["placeholders"] += len((new["anchors"] or {}).get("placeholders") or [])
        values = {"prose": new["prose"], "anchors": new["anchors"], "garbled_sentences": garbled}
        if all(row.get(key) == value for key, value in values.items()):
            continue
        if new["prose"] != (row.get("prose") or row["content"]):
            changed.append((row, values))
        else:
            supabase.table("chunks").update(values).eq("id", row["id"]).execute()
        report["stored"] += 1
    for start in range(0, len(changed), BATCH):
        batch = changed[start:start + BATCH]
        vectors = embedder.embed([values["prose"] for _, values in batch])
        for (row, values), vector in zip(batch, vectors):
            supabase.table("chunks").update({**values, "embedding_local": [float(v) for v in vector]}).eq(
                "id", row["id"]).execute()
        ids = [row["id"] for row, _ in batch]
        supabase.table("question_bank").delete().in_("chunk_id", ids).eq("times_used", 0).execute()
        question_agent.run(book["id"], ids)
        report["requestioned"] += len(ids)
    return report


async def after_regions(book: dict, file_bytes: bytes) -> None:
    """Rebuild the book's prose once its regions job is done. Never raises."""
    try:
        report = await asyncio.to_thread(rebuild, book, file_bytes)
        print(f"Prose of book {book['id']}: {report}")
    except Exception as error:  # noqa: BLE001 - prose is extra; the book reads from content without it
        print(f"Prose of book {book.get('id')} not rebuilt: {error}")
