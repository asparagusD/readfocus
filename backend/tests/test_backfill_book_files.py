"""scripts/backfill_book_files.py on the in-memory database. No network."""

import hashlib

import pytest

from backend.services import book_ingestor
from backend.tests.memory_db import MemoryDb
from scripts import backfill_book_files as backfill


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    monkeypatch.setattr(book_ingestor, "supabase", db)
    db.tables["books"] = [
        {"id": "b2", "title": "B", "file_type": "epub", "storage_path": "u/b2.epub", "file_sha256": None},
        {"id": "b1", "title": "A", "file_type": "pdf", "storage_path": "u/b1.pdf", "file_sha256": None},
        {"id": "b3", "title": "C", "file_type": "pdf", "storage_path": None, "file_sha256": None},
        {"id": "b4", "title": "D", "file_type": "pdf", "storage_path": "u/b4.pdf", "file_sha256": "done"},
    ]
    db.files.update({"u/b1.pdf": b"%PDF one", "u/b2.epub": b"PK epub bytes", "u/b4.pdf": b"x"})
    return db


def handle(db, rows, dry_run=False):
    pages = lambda fmt, data: 7 if fmt == "pdf" else None  # pypdf is not under test here
    return backfill.run(rows, lambda row: backfill.backfill_book(row, db, book_ingestor.download, pages, dry_run))


def test_pending_books_have_no_hash_oldest_id_first(db):
    assert [r["id"] for r in backfill.pending_rows(db)] == ["b1", "b2", "b3"]
    assert [r["id"] for r in backfill.pending_rows(db, limit=1)] == ["b1"]


def test_sha256_size_format_and_pages_are_stored(db):
    handle(db, backfill.pending_rows(db))
    by_id = {row["id"]: row for row in db.tables["books"]}
    assert by_id["b1"]["file_sha256"] == hashlib.sha256(b"%PDF one").hexdigest()
    assert (by_id["b1"]["file_bytes"], by_id["b1"]["file_format"], by_id["b1"]["page_count"]) == (8, "pdf", 7)
    assert by_id["b2"]["file_format"] == "epub" and by_id["b2"]["page_count"] is None
    assert by_id["b4"]["file_sha256"] == "done" and "file_format" not in by_id["b4"]


def test_a_book_without_a_stored_file_gets_its_format_only(db):
    handle(db, backfill.pending_rows(db, book_id="b3"))
    row = next(r for r in db.tables["books"] if r["id"] == "b3")
    assert row["file_format"] == "pdf" and row["file_sha256"] is None and "file_bytes" not in row


def test_a_dry_run_writes_nothing(db):
    before = [dict(row) for row in db.tables["books"]]
    handle(db, backfill.pending_rows(db), dry_run=True)
    assert db.tables["books"] == before


def test_twice_changes_nothing_for_hashed_books(db):
    handle(db, backfill.pending_rows(db))
    assert [r["id"] for r in backfill.pending_rows(db)] == ["b3"]  # no file to hash, so it stays pending


def test_it_refuses_to_run_outside_development(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    with pytest.raises(SystemExit):
        backfill.check_environment(False)
