"""scripts/backfill_structure.py on the in-memory database. No network."""

import pytest

from backend.services import book_ingestor, book_structure
from backend.tests.memory_db import MemoryDb
from scripts import backfill_structure as backfill

TEXT = "CHAPTER 1\nIt was a long night and the rain fell on the road.\n\nThe morning came at last."


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    monkeypatch.setattr(book_ingestor, "supabase", db)
    monkeypatch.setattr(book_ingestor, "extract", lambda file_type, data: [data.decode()])
    db.tables["books"] = [
        {"id": "b2", "status": "ready", "file_type": "pdf", "storage_path": "u/b2.pdf", "toc": None},
        {"id": "b1", "status": "ready", "file_type": "pdf", "storage_path": "u/b1.pdf", "toc": None},
        {"id": "b3", "status": "ready", "file_type": "pdf", "storage_path": "u/b3.pdf", "toc": []},
        {"id": "b4", "status": "processing", "file_type": "pdf", "storage_path": "u/b4.pdf", "toc": None},
        {"id": "b5", "status": "ready", "file_type": "pdf", "storage_path": None, "toc": None},
    ]
    db.files["u/b1.pdf"] = db.files["u/b2.pdf"] = TEXT.encode()
    chunks = book_ingestor.chunk_text([TEXT], book_ingestor.TARGET_WORDS)
    db.tables["chunks"] = [{"id": f"{book}-{i}", "book_id": book, "chunk_index": i, "content": content}
                           for book in ("b1", "b2") for i, content in enumerate(chunks)]
    return db


def handle(db, row, dry_run=False):
    return backfill.backfill_book(row, db, book_ingestor, book_structure, dry_run)


def book(db, book_id):
    return next(b for b in db.tables["books"] if b["id"] == book_id)


def test_pending_is_ready_books_with_no_toc_in_id_order(db):
    assert [r["id"] for r in backfill.pending_rows(db)] == ["b1", "b2", "b5"]
    assert [r["id"] for r in backfill.pending_rows(db, limit=1)] == ["b1"]
    assert [r["id"] for r in backfill.pending_rows(db, book_id="b2")] == ["b2"]


def test_a_matching_book_gets_blocks_and_toc_and_is_then_done(db):
    assert handle(db, book(db, "b1")) == "stored 1 chunks, 1 chapters"
    chunk = next(c for c in db.tables["chunks"] if c["book_id"] == "b1")
    assert [b["type"] for b in chunk["blocks"]] == ["chapter", "paragraph", "paragraph"]
    assert book(db, "b1")["toc"] == [{"title": "CHAPTER 1", "chunk_index": 0, "block_id": "0.0"}]
    assert "blocks" not in next(c for c in db.tables["chunks"] if c["book_id"] == "b2")  # other books untouched
    assert [r["id"] for r in backfill.pending_rows(db)] == ["b2", "b5"]  # a second run skips it


def test_dry_run_reads_and_compares_but_writes_nothing(db):
    assert handle(db, book(db, "b1"), dry_run=True) == "would store 1 chunks, 1 chapters"
    assert book(db, "b1")["toc"] is None
    assert all("blocks" not in c for c in db.tables["chunks"])


def test_blocks_come_from_the_stored_text_even_when_the_file_now_extracts_differently(db):
    # Regression (DEBUG_LOG 2026-11-11 C12.1c): books ingested with an older pypdf re-extract with other
    # whitespace, so a re-chunked file never equals the stored chunks; the stored text is what the reader shows.
    stored = "CHAPTER 1\nIt was a long night and the rain fell\non the road.\n\nThe morning came at last."
    next(c for c in db.tables["chunks"] if c["book_id"] == "b1")["content"] = stored
    assert handle(db, book(db, "b1")) == "stored 1 chunks, 1 chapters"
    chunk = next(c for c in db.tables["chunks"] if c["book_id"] == "b1")
    assert chunk["content"] == stored  # never rewritten
    assert [b["text"] for b in chunk["blocks"]] == [
        "CHAPTER 1", "It was a long night and the rain fell on the road.", "The morning came at last."]


def test_a_pdf_needs_no_file_and_is_not_downloaded(db):
    db.tables["chunks"].append({"id": "b5-0", "book_id": "b5", "chunk_index": 0, "content": "Only text."})
    assert handle(db, book(db, "b5")) == "stored 1 chunks, 0 chapters"
    assert ("storage", "download") not in db.calls
    assert book(db, "b5")["toc"] == []


def test_a_failing_book_does_not_stop_the_run():
    seen = []

    def fail_first(row):
        if row["id"] == "x":
            raise RuntimeError("download failed")
        return "stored"

    done = backfill.run([{"id": "x"}, {"id": "y"}], fail_first, report=lambda row, outcome: seen.append(outcome))
    assert done == 2 and seen[0].startswith("error") and seen[1] == "stored"


def test_it_refuses_to_run_outside_development(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    with pytest.raises(SystemExit):
        backfill.check_environment(allow_non_dev=False)
    backfill.check_environment(allow_non_dev=True)
