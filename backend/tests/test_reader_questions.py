"""C36.2 (issue 27): questions follow the reader. A saved place wants the chunk on screen and the next one; the
question agent makes the questions of those that are stored and have none. In-memory database and a fake agent;
no model, no network."""

import asyncio

import pytest

from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.services import reader_questions
from backend.tests.memory_db import MemoryDb

BOOK, USER = "book-1", "user-1"


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    monkeypatch.setattr(reader_questions, "supabase", fake)
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
