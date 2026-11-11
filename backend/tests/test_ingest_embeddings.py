"""Ingestion on an in-memory database: local embeddings, bounded batches, a cursor saved after each
batch, and a job that resumes after a crash without duplicating chunks or questions.

The embedder and the question agent are fakes, so no model and no network are needed.
"""

import asyncio
import inspect

import numpy as np
import pytest

from backend.nlp import embedder
from backend.services import book_ingestor, ingestion_worker
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

BOOK, USER = "book-1", "user-1"


class Crash(RuntimeError):
    pass


@pytest.fixture
def env(monkeypatch):
    """A book of `count` chunks in Storage, a fake embedder and a question agent that upserts one row per chunk."""
    db = MemoryDb()
    for module in (book_ingestor, jobs, ingestion_worker):
        monkeypatch.setattr(module, "supabase", db)
    state = {"embed_calls": [], "crash_on_embed": None, "events": []}

    def fake_embed(texts):
        state["embed_calls"].append(len(texts))
        if state["crash_on_embed"] == len(state["embed_calls"]):
            raise Crash("server stopped")
        return np.full((len(texts), embedder.EMBEDDING_DIM), 0.05, dtype=np.float32)

    def fake_questions(book_id, chunk_ids):
        rows = [c for c in db.tables["chunks"] if c["id"] in chunk_ids]
        state["events"].append(("questions", sorted(r["chunk_index"] for r in rows)))
        db.table("question_bank").upsert(
            [{"chunk_id": r["id"], "chunk_index": r["chunk_index"], "strategy": "cloze", "prompt_hash": "h"} for r in rows],
            on_conflict="chunk_id,strategy,prompt_hash", ignore_duplicates=True).execute()

    monkeypatch.setattr(embedder, "embed", fake_embed)
    monkeypatch.setattr(book_ingestor.question_agent, "run", fake_questions)
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", lambda data: ["unused"])

    def book(count):
        chunks = [f"chunk number {i} " + "word " * i for i in range(count)]
        monkeypatch.setattr(book_ingestor, "chunk_text", lambda pages, target_words=600: chunks)
        db.tables["books"] = [{"id": BOOK, "user_id": USER, "file_type": "pdf", "status": "processing",
                               "storage_path": f"{USER}/{BOOK}.pdf"}]
        db.files[f"{USER}/{BOOK}.pdf"] = b"%PDF"
        return jobs.claim(jobs.create(BOOK, USER))

    state["db"], state["book"] = db, book
    return state


def run(job, file_bytes=None):
    return asyncio.run(book_ingestor.run_job(job, file_bytes))


def chunk_indices(db):
    return sorted(c["chunk_index"] for c in db.tables.get("chunks", []))


@pytest.mark.parametrize("total, cursor, expected", [
    (0, 0, []),
    (3, 0, [(0, 3)]),
    (40, 0, [(0, 5), (5, 21), (21, 37), (37, 40)]),
    (40, 21, [(21, 37), (37, 40)]),
    (40, 40, []),
])
def test_batches_are_bounded_and_start_at_the_cursor(total, cursor, expected):
    assert list(book_ingestor.batches(total, cursor)) == expected


def test_every_chunk_is_stored_once_with_a_local_embedding_and_the_job_is_done(env):
    db = env["db"]
    result = run(env["book"](40), b"%PDF")
    rows = db.tables["chunks"]
    assert chunk_indices(db) == list(range(40))
    assert all(r["book_id"] == BOOK and r["user_id"] == USER for r in rows)
    assert all(len(r["embedding_local"]) == embedder.EMBEDDING_DIM and "embedding" not in r for r in rows)
    assert env["embed_calls"] == [5, 16, 16, 3]
    job = jobs.get(BOOK)
    assert (job["status"], job["cursor"], job["progress"]) == ("done", 40, 1)
    book = db.tables["books"][0]
    assert (book["status"], book["total_chunks"], result["status"]) == ("ready", 40, "ready")


def test_the_book_is_ready_after_the_first_batch_before_its_questions(env, monkeypatch):
    db, events = env["db"], env["events"]
    original = book_ingestor.mark_ready

    def spy(book_id, total, words):
        events.append("ready")
        original(book_id, total, words)

    monkeypatch.setattr(book_ingestor, "mark_ready", spy)
    run(env["book"](7), b"%PDF")
    assert events == ["ready", ("questions", [0, 1, 2, 3, 4]), ("questions", [5, 6])]
    assert len(db.tables["question_bank"]) == 7


def test_a_crash_keeps_the_cursor_and_a_resume_finishes_without_duplicates(env):
    db = env["db"]
    env["crash_on_embed"] = 3  # the third batch dies, as if the server stopped
    job = env["book"](40)
    run(job, b"%PDF")
    stopped = jobs.get(BOOK)
    assert (stopped["status"], stopped["cursor"], stopped["progress"]) == ("failed", 21, 21 / 40)
    assert "server stopped" in stopped["error"]
    assert db.tables["books"][0]["status"] == "ready"  # the first batch is readable
    ids_before = {c["chunk_index"]: c["id"] for c in db.tables["chunks"]}

    env["crash_on_embed"] = None
    resumed = jobs.claim(stopped, manual=True)
    run(resumed)  # no bytes: the file comes from Storage
    assert ("storage", "download") in db.calls
    assert env["embed_calls"][-2:] == [16, 3]  # only the batches after the cursor
    assert chunk_indices(db) == list(range(40))
    assert {i: c["id"] for c in db.tables["chunks"] for i in [c["chunk_index"]] if i < 21} == ids_before
    assert sorted(q["chunk_index"] for q in db.tables["question_bank"]) == list(range(40))
    assert jobs.get(BOOK)["status"] == "done" and jobs.get(BOOK)["attempts"] == 2


def test_a_batch_stored_but_not_recorded_is_safe_to_run_again(env, monkeypatch):
    db = env["db"]
    job = env["book"](21)
    real_advance = jobs.advance
    calls = []

    def advance_then_stop(job_id, cursor, total, now=None):
        calls.append(cursor)
        if cursor == 21:
            raise Crash("stopped before the cursor was saved")
        real_advance(job_id, cursor, total, now)

    monkeypatch.setattr(jobs, "advance", advance_then_stop)
    run(job, b"%PDF")
    assert jobs.get(BOOK)["cursor"] == 5 and len(db.tables["chunks"]) == 21
    monkeypatch.setattr(jobs, "advance", real_advance)
    run(jobs.claim(jobs.get(BOOK), manual=True))
    assert chunk_indices(db) == list(range(21))  # the batch 5..21 was upserted again, not duplicated
    assert len(db.tables["question_bank"]) == 21
    assert jobs.get(BOOK)["status"] == "done"


def test_a_failure_before_the_first_batch_marks_the_book_error(env):
    env["crash_on_embed"] = 1
    run(env["book"](12), b"%PDF")
    assert env["db"].tables["books"][0]["status"] == "error"
    assert jobs.get(BOOK)["status"] == "failed" and jobs.get(BOOK)["cursor"] == 0


def test_an_empty_book_is_ready_with_no_chunks(env):
    run(env["book"](0), b"%PDF")
    book = env["db"].tables["books"][0]
    assert (book["status"], book["total_chunks"], book["total_words"]) == ("ready", 0, 0)
    assert jobs.get(BOOK)["status"] == "done"


def test_a_failing_question_agent_does_not_fail_the_job(env, monkeypatch):
    def broken(book_id, chunk_ids):
        raise RuntimeError("question bank unavailable")

    monkeypatch.setattr(book_ingestor.question_agent, "run", broken)
    run(env["book"](7), b"%PDF")
    assert chunk_indices(env["db"]) == list(range(7))
    assert jobs.get(BOOK)["status"] == "done"


def test_ingestion_does_not_import_a_remote_embedding_client():
    source = inspect.getsource(book_ingestor)
    assert "services.embeddings" not in source and "generate_embedding" not in source
