"""C36.2 (issue 27): questions follow the reader. A saved place wants the chunk on screen and the next one; the
question agent makes the questions of those that are stored and have none, in the worker's slot ahead of any
waiting job, or between an ingest's batches. In-memory database and a fake agent; no model, no network."""

import asyncio

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.dependencies import get_current_user
from backend.main import app
from backend.nlp import embedder
from backend.routers import reading
from backend.services import (
    book_ingestor,
    ingestion_worker,
    reader_questions,
    region_job,
)
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb
from backend.xp import badge_award

BOOK, USER = "book-1", "user-1"
PLACE = {"kind": "pdf", "page": 12, "quads": [[0, 0, 10, 10]], "text": "the"}


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    for module in (reader_questions, reading, book_ingestor, jobs, ingestion_worker):
        monkeypatch.setattr(module, "supabase", fake)
    fake.tables["books"] = [{"id": BOOK, "user_id": USER, "title": "SICP", "file_type": "pdf", "file_format": "pdf",
                             "storage_mode": "cloud", "status": "ready", "total_chunks": 6, "toc": [],
                             "scanned_pages": None, "storage_path": f"{USER}/{BOOK}.pdf", "cover_source": "none"}]
    return fake


@pytest.fixture
def made(monkeypatch, db):
    """The agent's runs, as chunk indices; each run stores one question per chunk."""
    runs = []

    def run(self, book_id, chunk_ids):
        rows = [c for c in db.tables.get("chunks", []) if c["id"] in chunk_ids]
        runs.append(sorted(r["chunk_index"] for r in rows))
        db.table("question_bank").upsert([{"book_id": book_id, "chunk_id": r["id"], "chunk_index": r["chunk_index"],
                                           "strategy": "cloze", "prompt_hash": "h"} for r in rows],
                                         on_conflict="chunk_id,strategy,prompt_hash", ignore_duplicates=True).execute()
    monkeypatch.setattr(QuestionGenerationAgent, "run", run)
    return runs


def store(db, *indices):
    db.tables.setdefault("chunks", []).extend(
        {"id": f"c{i}", "book_id": BOOK, "user_id": USER, "chunk_index": i, "content": f"chunk {i}"} for i in indices)


@pytest.mark.parametrize("at, total, expected", [(3, 10, [3, 4]), (9, 10, [9]), (0, 0, []), (12, 10, [])])
def test_the_chunk_on_screen_and_the_next_one_are_wanted(at, total, expected):
    assert reader_questions.wanted_indices(at, total) == expected


def test_only_stored_chunks_without_questions_get_them_once(db, made):
    store(db, 0, 1, 2, 3)
    reader_questions.want(BOOK, 1, 6)
    assert asyncio.run(reader_questions.serve()) == 1
    reader_questions.want(BOOK, 2, 6)  # chunk 2 has its questions now; only 3 is new
    asyncio.run(reader_questions.serve())
    reader_questions.want(BOOK, 2, 6)
    asyncio.run(reader_questions.serve())
    assert made == [[1, 2], [3]] and not reader_questions.pending()


def test_unread_chunks_never_get_questions(db, made):
    store(db, *range(6))
    reader_questions.want(BOOK, 0, 6)
    reader_questions.want(BOOK, 4, 6)  # a jump: the latest place wins
    asyncio.run(reader_questions.serve())
    assert made == [[4, 5]]


def test_a_failing_agent_loses_only_these_questions(db, monkeypatch):
    store(db, 0, 1)
    monkeypatch.setattr(QuestionGenerationAgent, "run", lambda self, b, ids: (_ for _ in ()).throw(RuntimeError("x")))
    reader_questions.want(BOOK, 0, 6)
    assert asyncio.run(reader_questions.serve()) == 0 and not reader_questions.pending()


def test_chunks_not_stored_yet_stay_wanted_only_for_the_book_being_ingested(db, made):
    store(db, 0)
    reader_questions.want(BOOK, 0, 6)
    asyncio.run(reader_questions.serve(ingesting=BOOK))
    assert made == [[0]] and reader_questions.pending()  # chunk 1 is stored by the ingest's next batch
    store(db, 1)
    asyncio.run(reader_questions.serve(ingesting=BOOK))
    assert made == [[0], [1]] and not reader_questions.pending()
    reader_questions.want(BOOK, 5, 6)
    asyncio.run(reader_questions.serve())  # not ingesting: nothing will store chunk 5 now
    assert not reader_questions.pending()


def test_the_readers_questions_go_before_a_waiting_job_and_queue_once(db, made):
    store(db, 0, 1)
    order = []

    async def scenario():
        slot = ingestion_worker._slot()
        await slot.acquire(ingestion_worker.INGEST_FIRST)  # an ingest is running
        waiting_job = asyncio.create_task(slot.acquire(ingestion_worker.REGIONS_LATER))
        reader_questions.want(BOOK, 0, 6)
        first = asyncio.create_task(ingestion_worker.run_questions())
        await asyncio.sleep(0)
        second = await ingestion_worker.run_questions()  # a page turn a second later: no second waiter
        waiting_job.add_done_callback(lambda _: order.append("job"))
        first.add_done_callback(lambda _: order.append("questions"))
        slot.release()
        assert await first == 1 and second == 0
        await waiting_job
        slot.release()
    asyncio.run(scenario())
    assert order == ["questions", "job"] and made == [[0, 1]]


def test_an_ingest_makes_a_readers_questions_between_its_batches(db, made, monkeypatch):
    """A reader on the first pages of a book being processed gets their questions after its first batch, not after
    the whole book."""
    monkeypatch.setattr(embedder, "embed", lambda texts: np.zeros((len(texts), embedder.EMBEDDING_DIM)))
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", lambda data, *a, **k: ["unused"])
    monkeypatch.setattr(book_ingestor, "chunk_text", lambda pages, target_words=600: [f"chunk {i}" for i in range(30)])
    monkeypatch.setattr(book_ingestor, "look_up_cover", lambda book, data: None)

    async def no_regions(book, data=None):
        return None
    monkeypatch.setattr(region_job, "after_ingest", no_regions)
    db.tables["books"][0]["status"] = "processing"
    stored_when = []
    advance = jobs.advance
    monkeypatch.setattr(jobs, "advance", lambda job_id, cursor, total, now=None: (
        stored_when.append((cursor, list(made))), advance(job_id, cursor, total, now))[1])
    reader_questions.want(BOOK, 3, 30)
    asyncio.run(book_ingestor.run_job(jobs.claim(jobs.create(BOOK, USER)), b"%PDF"))
    assert stored_when[0] == (5, [[3, 4]])  # made with the first batch, before the next one
    assert made == [[3, 4]]


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_saving_the_place_makes_the_questions_of_that_chunk_and_the_next(client, db, made, monkeypatch):
    monkeypatch.setattr(badge_award, "check_quietly", lambda *args, **kwargs: [])
    store(db, *range(6))
    assert client.put(f"/books/{BOOK}/position", json={"anchor": PLACE, "chunk_index": 2}).status_code == 200
    assert client.put(f"/books/{BOOK}/position", json={"anchor": PLACE, "chunk_index": 2}).status_code == 200
    assert made == [[2, 3]]  # the second save found them made


def test_a_quiz_ranges_gaps_are_made_after_the_readers_place_and_merged(db, made):
    """C36.7: fill() adds a quiz range's chunks without questions; serve makes them after the reader's own place."""
    store(db, *range(6))
    reader_questions.fill(BOOK, [1, 4])
    reader_questions.fill(BOOK, [4, 5])
    reader_questions.want(BOOK, 2, 6)
    asyncio.run(reader_questions.serve())
    assert made == [[2, 3], [1, 4, 5]] and not reader_questions.pending()
