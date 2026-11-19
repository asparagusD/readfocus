"""Questions follow the reader (C36.2, issue 27).

Ingestion makes no questions (C36.1). Each time the reader's place is saved (`PUT /books/{id}/position`, about
once a second while pages turn), the chunk on screen and the next one are wanted; the question generation agent
makes the questions of those of them that are stored and have none. So a quiz on the pages just read is ready
when they are, and a page never read costs nothing (your decisions, 2026-11-19: only what is read, lookahead one).

Wants are kept in memory, one per book (the latest place wins): a restart loses only wants that the next page turn
sends again. They are served in the ingestion worker's slot (one job at a time on Render's 512 MB): ahead of any
waiting job (`ingestion_worker.run_questions`), and between an ingest's batches while one runs
(`book_ingestor.run_job` awaits `serve`), so a reader of a book being processed is not kept waiting for it.

Safe to repeat: the bank's unique key (chunk_id, strategy, prompt_hash) makes a second run add nothing.
"""

import asyncio

from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.services.supabase_client import supabase

LOOKAHEAD = 1  # chunks after the one on screen

question_agent = QuestionGenerationAgent()
_wanted: dict[str, list[int]] = {}  # book id -> chunk indices wanted, in order
_filling: dict[str, list[int]] = {}  # C36.7: book id -> chunks a quiz range lacked, made after the reader's own


def wanted_indices(at: int, total: int) -> list[int]:
    """The chunk on screen and the LOOKAHEAD after it, inside the book."""
    return [i for i in range(at, at + LOOKAHEAD + 1) if 0 <= i < total]


def want(book_id: str, at: int | None, total: int) -> bool:
    """Record the reader's chunk; True when there is something to want."""
    indices = wanted_indices(at, total) if at is not None else []
    if not indices:
        return False
    _wanted[book_id] = indices
    return True


def fill(book_id: str, indices: list[int]) -> bool:
    """C36.7: chunks of a quiz range that have no questions, made in the background (added to any already
    waiting), so the next quiz on that range has them; True when there is something to make."""
    merged = sorted(set(_filling.get(book_id, [])) | {int(i) for i in indices}, reverse=True)  # nearest the place first
    if merged:
        _filling[book_id] = merged
    return bool(merged)


def pending() -> bool:
    return bool(_wanted or _filling)


def _stored(book_id: str, indices: list[int]) -> dict[int, str]:
    rows = (supabase.table("chunks").select("id, chunk_index").eq("book_id", book_id).in_("chunk_index", indices)
            .execute().data or [])
    return {row["chunk_index"]: row["id"] for row in rows}


def _questioned(book_id: str, indices: list[int]) -> set[int]:
    rows = (supabase.table("question_bank").select("chunk_index").eq("book_id", book_id).in_("chunk_index", indices)
            .execute().data or [])
    return {row["chunk_index"] for row in rows}


def make(book_id: str, indices: list[int]) -> list[int]:
    """Make the questions of the wanted chunks that are stored and have none (blocking); the indices not stored
    yet, which an ingest still running stores later."""
    stored = _stored(book_id, indices)
    missing = [i for i in indices if i in stored and i not in _questioned(book_id, list(stored))]
    if missing:
        question_agent.run(book_id, [stored[i] for i in missing])
    return [i for i in indices if i not in stored]


async def serve(ingesting: str | None = None) -> int:
    """Serve every want recorded so far, one book after another, off the event loop; the books served. The
    chunks of the book being ingested (`ingesting`) that are not stored yet stay wanted, since its next batch calls
    again; any other book's are dropped (its next page turn asks again). Never raises: a failure loses only that
    book's questions for now, which the next page turn asks for again."""
    served = 0
    for book_id in list(_wanted):
        indices = _wanted.pop(book_id, None)
        if not indices:
            continue
        try:
            later = await asyncio.to_thread(make, book_id, indices)
        except Exception as error:  # noqa: BLE001 - the reader's quiz tops up what is missing
            print(f"Questions for book {book_id} not made: {error}")
            continue
        if later and book_id == ingesting and book_id not in _wanted:  # a newer place wins over these
            _wanted[book_id] = later
        served += 1
    for book_id in list(_filling):  # C36.7: a quiz range's gaps, after every reader's own place
        indices = _filling.pop(book_id, None)
        if not indices:
            continue
        try:
            for index in indices:  # one chunk at a time, the latest read first, so the first lands soonest
                await asyncio.to_thread(make, book_id, [index])
        except Exception as error:  # noqa: BLE001 - the next quiz on the range makes what it needs
            print(f"Questions for book {book_id}'s quiz range not made: {error}")
            continue
        served += 1
    return served


def forget(book_id: str | None = None) -> None:
    """Drop the wants of a book (or every book); for a deleted book and for tests."""
    if book_id is None:
        _wanted.clear()
        _filling.clear()
    else:
        _wanted.pop(book_id, None)
        _filling.pop(book_id, None)
