"""scripts/backfill_body_start.py on the in-memory database (C23.1). No network."""

import pytest

from backend.services import body_start
from backend.tests.memory_db import MemoryDb
from scripts import backfill_body_start as backfill

CHAPTER = {"title": "Chapter 1", "page": 6}


@pytest.fixture
def db():
    db = MemoryDb()
    db.tables["books"] = [
        {"id": "b2", "title": "B", "file_type": "pdf", "status": "ready", "toc": [CHAPTER], "body_start": None,
         "body_start_source": None},
        {"id": "b1", "title": "A", "file_type": "epub", "status": "ready", "toc": [{"title": "Cover", "spine_index": 0},
         {"title": "One", "spine_index": 3}], "body_start": None, "body_start_source": None},
        {"id": "b3", "title": "Mine", "file_type": "pdf", "status": "ready", "toc": [CHAPTER],
         "body_start": body_start.place("pdf", 2, "Prologue"), "body_start_source": "user"},
        {"id": "b4", "title": "Busy", "file_type": "pdf", "status": "processing", "toc": None, "body_start": None,
         "body_start_source": None},
        {"id": "b5", "title": "Bare", "file_type": "pdf", "status": "ready", "toc": [], "body_start": None,
         "body_start_source": None},
    ]
    db.tables["page_regions"] = []
    return db


def by_id(db, book_id):
    return next(b for b in db.tables["books"] if b["id"] == book_id)


def test_pending_books_are_ready_and_unset_oldest_first(db):
    assert [r["id"] for r in backfill.pending_rows(db)] == ["b1", "b2", "b5"]
    assert [r["id"] for r in backfill.pending_rows(db, dry_run=True)] == ["b1", "b2", "b3", "b5"]


def test_a_run_stores_what_detection_finds_and_never_a_readers_choice(db):
    outcomes = {r["id"]: backfill.backfill_book(r, db, body_start) for r in backfill.pending_rows(db, dry_run=True)}
    assert outcomes == {"b1": "stored outline: section 3 One", "b2": "stored outline: p. 6 Chapter 1",
                        "b3": "already set, kept", "b5": "nothing found"}
    assert by_id(db, "b2")["body_start"]["page"] == 6 and by_id(db, "b2")["body_start_source"] == "outline"
    assert by_id(db, "b3")["body_start"]["page"] == 2 and by_id(db, "b3")["body_start_source"] == "user"  # untouched
    assert by_id(db, "b5")["body_start"] is None


def test_a_dry_run_writes_nothing(db):
    before = [dict(b) for b in db.tables["books"]]
    outcomes = [backfill.backfill_book(r, db, body_start, dry_run=True) for r in backfill.pending_rows(db, dry_run=True)]
    assert outcomes[0] == "would store outline: section 3 One"
    assert db.tables["books"] == before
