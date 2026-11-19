"""Ingestion on an in-memory database: local embeddings, bounded batches, a cursor saved after each
batch, and a job that resumes after a crash without duplicating chunks. Since C36.1 (issue 27) it makes no
questions (they follow the reader) and stores a PDF's chunk pages.

The embedder is a fake, so no model and no network are needed.
"""

import asyncio
import inspect

import numpy as np
import pytest

from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.nlp import embedder
from backend.regions import prose
from backend.services import (
    book_ingestor,
    covers,
    ingestion_worker,
    ocr_pages,
    region_job,
)
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

BOOK, USER = "book-1", "user-1"


class Crash(RuntimeError):
    pass


@pytest.fixture
def env(monkeypatch):
    """A book of `count` chunks in Storage, a fake embedder and a question agent that must never run."""
    db = MemoryDb()
    for module in (book_ingestor, jobs, ingestion_worker, ocr_pages):
        monkeypatch.setattr(module, "supabase", db)
    state = {"embed_calls": [], "crash_on_embed": None, "events": []}

    def fake_embed(texts):
        state["embed_calls"].append(len(texts))
        if state["crash_on_embed"] == len(state["embed_calls"]):
            raise Crash("server stopped")
        return np.full((len(texts), embedder.EMBEDDING_DIM), 0.05, dtype=np.float32)

    def fake_questions(self, book_id, chunk_ids):
        state["events"].append(("questions", list(chunk_ids)))

    monkeypatch.setattr(embedder, "embed", fake_embed)
    monkeypatch.setattr(QuestionGenerationAgent, "run", fake_questions)
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", lambda data, *a, **k: ["unused"])
    state["covers"] = []  # (book_id, title, author) per cover lookup; no network in these tests
    monkeypatch.setattr(covers, "ensure_cover", lambda *args: state["covers"].append(args))
    state["regions"] = []  # (book, file_bytes, ingest job status) per hand-off to the regions job

    async def after_ingest(book, file_bytes=None):
        state["regions"].append((book, file_bytes, jobs.get(book["id"])["status"]))

    monkeypatch.setattr(region_job, "after_ingest", after_ingest)

    def book(count):
        chunks = [f"chunk number {i} " + "word " * i for i in range(count)]
        monkeypatch.setattr(book_ingestor, "chunk_text", lambda pages, target_words=600: chunks)
        db.tables["books"] = [{"id": BOOK, "user_id": USER, "file_type": "pdf", "status": "processing",
                               "storage_path": f"{USER}/{BOOK}.pdf", "title": "Walden", "author": "Thoreau",
                               "cover_source": None}]
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


def test_the_book_is_ready_once_the_first_batch_is_stored_and_no_questions_are_made(env, monkeypatch):
    """C36.1 (issue 27): ingestion makes no questions; they follow the reader (reader_questions)."""
    db, events = env["db"], env["events"]
    original = book_ingestor.mark_ready
    seen = {}

    def spy(book_id, total, words, toc=None):
        events.append("ready")
        seen["chunks"] = chunk_indices(db)
        original(book_id, total, words, toc)

    monkeypatch.setattr(book_ingestor, "mark_ready", spy)
    run(env["book"](7), b"%PDF")
    assert events == ["ready"] and seen == {"chunks": [0, 1, 2, 3, 4]}
    assert not db.tables.get("question_bank") and jobs.get(BOOK)["status"] == "done"


def test_a_pdf_chunk_is_stored_with_its_pages_and_spans(env, monkeypatch):
    """C36.1: the pages ingestion read give each chunk its anchors, as the prose job would without regions."""
    pages = ["alpha beta", "", "gamma delta", "epsilon"]

    def extract(data, ocr=None, scanned=None, every_page=None):
        every_page.extend(pages)
        return [p for p in pages if p]
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", extract)
    job = env["book"](0)
    chunks = ["alpha beta\n\ngamma", "delta\n\nepsilon"]
    monkeypatch.setattr(book_ingestor, "chunk_text", lambda texts, target_words=600: chunks)
    run(job, b"%PDF")
    stored = sorted(env["db"].tables["chunks"], key=lambda c: c["chunk_index"])
    assert [c["anchors"]["pages"] for c in stored] == [[1, 3], [3, 4]]
    assert stored[1]["anchors"]["spans"] == [{"page": 3, "char_start": 5, "char_end": 10},
                                             {"page": 4, "char_start": 0, "char_end": 7}]
    built = prose.pdf_prose([c["content"] for c in stored], pages, [])
    assert [c["anchors"] for c in stored] == [b["anchors"] for b in built]  # the prose job's, with no regions


def test_an_epub_chunk_gets_no_page_anchors(env, monkeypatch):
    monkeypatch.setattr(book_ingestor, "extract_text_from_epub", lambda data: ["chapter"])
    job = env["book"](3)
    env["db"].tables["books"][0]["file_type"] = "epub"
    assert run(job, b"PK")["status"] == "ready"
    assert chunk_indices(env["db"]) == [0, 1, 2]
    assert all("anchors" not in c for c in env["db"].tables["chunks"])


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
    assert not db.tables.get("question_bank")  # C36.1: questions follow the reader
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
    assert not db.tables.get("question_bank")
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


def test_ingestion_does_not_import_a_remote_embedding_client():
    source = inspect.getsource(book_ingestor)
    assert "services.embeddings" not in source and "generate_embedding" not in source


# C11.2: the cover lookup runs once the book is ingested and never fails the job.

def test_the_cover_is_looked_up_after_ingestion_with_the_typed_title_as_fallback(env):
    run(env["book"](7), b"%PDF")
    assert env["covers"] == [(BOOK, "Walden", "Thoreau")]
    assert jobs.get(BOOK)["status"] == "done"


def test_the_file_metadata_is_preferred_for_the_lookup(env, monkeypatch):
    monkeypatch.setattr(book_ingestor, "extract_metadata", lambda kind, data: ("Walden; or, Life in the Woods", None))
    run(env["book"](2), b"%PDF")
    assert env["covers"] == [(BOOK, "Walden; or, Life in the Woods", "Thoreau")]


def test_a_book_already_checked_is_not_looked_up_again(env):
    job = env["book"](2)
    env["db"].tables["books"][0]["cover_source"] = "none"
    run(job, b"%PDF")
    assert env["covers"] == []


def test_a_failing_cover_lookup_does_not_fail_the_job(env, monkeypatch):
    def broken(*args):
        raise RuntimeError("open library down")
    monkeypatch.setattr(covers, "ensure_cover", broken)
    assert run(env["book"](3), b"%PDF")["status"] == "ready"
    assert jobs.get(BOOK)["status"] == "done"


def test_no_cover_lookup_when_ingestion_fails(env):
    env["crash_on_embed"] = 1
    run(env["book"](3), b"%PDF")
    assert env["covers"] == []


# --- C12.1: structured blocks and table of contents ---------------------

def test_every_chunk_is_stored_with_its_blocks_and_the_book_with_its_toc(env, monkeypatch):
    job = env["book"](2)
    chunks = ["CHAPTER 1\nIt was a long night and the rain fell on the road.", "More of the night passed slowly."]
    monkeypatch.setattr(book_ingestor, "chunk_text", lambda pages, target_words=600: chunks)
    run(job, b"%PDF")
    db = env["db"]
    stored = sorted(db.tables["chunks"], key=lambda c: c["chunk_index"])
    assert [c["content"] for c in stored] == chunks  # the agents' text is unchanged
    assert [(b["id"], b["type"]) for b in stored[0]["blocks"]] == [("0.0", "chapter"), ("0.1", "paragraph")]
    assert stored[1]["blocks"] == [{"id": "1.0", "type": "paragraph", "text": chunks[1], "marks": []}]
    assert db.tables["books"][0]["toc"] == [{"title": "CHAPTER 1", "chunk_index": 0, "block_id": "0.0"}]
    assert db.tables["books"][0]["status"] == "ready" and jobs.get(BOOK)["status"] == "done"


def test_a_book_without_chapters_gets_an_empty_toc(env):
    run(env["book"](3), b"%PDF")
    assert env["db"].tables["books"][0]["toc"] == []
    assert all(c["blocks"] for c in env["db"].tables["chunks"])


def test_no_structure_never_fails_the_job(env, monkeypatch):
    monkeypatch.setattr(book_ingestor.book_structure, "build_with_paths", lambda *args: (None, None, None))
    assert run(env["book"](3), b"%PDF")["status"] == "ready"
    assert all(c["blocks"] is None and c["block_paths"] is None for c in env["db"].tables["chunks"])
    assert env["db"].tables["books"][0].get("toc") is None and jobs.get(BOOK)["status"] == "done"


def test_a_pdf_job_hands_its_page_texts_to_the_structure(env, monkeypatch):
    """C26.2: the outline uses the pages ingestion read, not a second pass over the book."""
    seen = []

    def extract(data, ocr=None, scanned=None, every_page=None):
        every_page.extend(["page one", ""])
        return ["page one"]

    def build(file_type, file_bytes, chunks, page_texts=None):
        seen.append(page_texts)
        return None, None, None
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", extract)
    monkeypatch.setattr(book_ingestor.book_structure, "build_with_paths", build)
    assert run(env["book"](3), b"%PDF")["status"] == "ready"
    assert seen == [["page one", ""]]


def test_a_resumed_job_stores_blocks_for_every_chunk(env):
    env["crash_on_embed"] = 3
    run(env["book"](40), b"%PDF")
    env["crash_on_embed"] = None
    run(jobs.claim(jobs.get(BOOK), manual=True))
    stored = sorted(env["db"].tables["chunks"], key=lambda c: c["chunk_index"])
    assert [c["blocks"][0]["id"] for c in stored] == [f"{i}.0" for i in range(40)]
    assert env["db"].tables["books"][0]["toc"] == []


def test_the_regions_job_follows_a_finished_ingestion(env):
    job = env["book"](3)
    run(job, b"%PDF bytes")
    [(book, data, ingest_status)] = env["regions"]
    assert (book["id"], book["user_id"], book["file_type"], book["storage_path"]) == (
        BOOK, USER, "pdf", f"{USER}/{BOOK}.pdf")
    assert data == b"%PDF bytes" and ingest_status == "done"


def test_a_pdf_read_from_ocr_or_browser_text_gets_its_pages_by_number():
    """DEBUG_LOG 2026-11-19 C36.G: the texts by page number stand in for pypdf's pages (a blank page 2 kept)."""
    book = {"file_type": "pdf"}
    texts = {1: "alpha beta", 3: "gamma delta"}
    anchors = book_ingestor.page_anchors(book, ["alpha beta\n\ngamma", "delta"], [], texts)
    assert [a["pages"] for a in anchors] == [[1, 3], [3, 3]]
    assert book_ingestor.page_anchors({"file_type": "epub"}, ["x"], None, texts) is None
    assert book_ingestor.numbered({2: "b"}, 4) == ["", "b", "", ""]


def test_contents_entries_without_a_page_take_their_chunks_first_page():
    anchors = [{"pages": [1, 2]}, {"pages": [2, 5]}, {"pages": None}]
    toc = [{"title": "One", "chunk_index": 1, "page": None}, {"title": "Two", "chunk_index": 2, "page": None},
           {"title": "Kept", "chunk_index": 0, "page": 9}, {"title": "None", "page": None}]
    assert [e["page"] for e in book_ingestor.toc_with_pages(toc, anchors)] == [2, None, 9, None]
    assert book_ingestor.toc_with_pages(toc, None) is toc
