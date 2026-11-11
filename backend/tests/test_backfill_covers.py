"""scripts/backfill_covers.py on a fake database. No network."""

from types import SimpleNamespace

import pytest

from backend.services import covers
from backend.tests.memory_db import MemoryDb
from scripts import backfill_covers as backfill


@pytest.fixture
def db():
    db = MemoryDb()
    db.tables["books"] = [
        {"id": "b3", "title": "C", "status": "ready", "cover_source": "error"},
        {"id": "b1", "title": "A", "status": "ready", "cover_source": None},
        {"id": "b2", "title": "B", "status": "ready", "cover_source": "none"},
        {"id": "b4", "title": "D", "status": "ready", "cover_source": "openlibrary"},
        {"id": "b5", "title": "E", "status": "processing", "cover_source": None},
    ]
    return db


def test_pending_is_never_looked_up_or_failed_and_ready_in_id_order(db):
    assert [r["id"] for r in backfill.pending_rows(db)] == ["b1", "b3"]
    assert [r["id"] for r in backfill.pending_rows(db, limit=1)] == ["b1"]
    assert [r["id"] for r in backfill.pending_rows(db, book_id="b3")] == ["b3"]


def test_run_looks_up_one_book_at_a_time_with_a_pause_between():
    events = []
    rows = [{"id": "b1"}, {"id": "b3"}, {"id": "b6"}]
    done = backfill.run(rows, lambda row: events.append(("look", row["id"])) or {"cover_source": "none"},
                        pause=lambda seconds: events.append(("pause", seconds)))
    assert done == 3
    assert events == [("look", "b1"), ("pause", backfill.PAUSE_SECONDS), ("look", "b3"),
                      ("pause", backfill.PAUSE_SECONDS), ("look", "b6")]
    assert backfill.PAUSE_SECONDS >= 1.0  # Open Library: one request a second without a contact


def test_dry_run_looks_up_nothing():
    seen = []
    assert backfill.run([{"id": "b1"}], lambda row: seen.append(row), dry_run=True,
                        pause=lambda s: seen.append(s)) == 1
    assert seen == []


def test_refuses_a_non_dev_environment(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    with pytest.raises(SystemExit):
        backfill.check_environment(allow_non_dev=False)
    backfill.check_environment(allow_non_dev=True)


# Found on dev (C11.2 backfill): a book with no stored file stopped the run.

def test_a_failing_book_is_reported_and_the_run_goes_on():
    seen = []

    def look_up(row):
        if row["id"] == "bad":
            raise TypeError("argument of type 'NoneType' is not iterable")
        return {"cover_source": "none"}

    done = backfill.run([{"id": "bad"}, {"id": "b2"}], look_up, pause=lambda s: None,
                        report=lambda row, outcome: seen.append((row["id"], outcome["cover_source"])))
    assert done == 2
    assert seen == [("bad", "error"), ("b2", "none")]


def test_a_book_without_a_readable_file_is_looked_up_by_its_typed_title():
    calls = []

    def broken_download(path):
        raise RuntimeError("not found")

    ingestor = SimpleNamespace(download=broken_download, extract_metadata=lambda kind, data: ("Meta", "M"))
    lookups = SimpleNamespace(lookup_terms=covers.lookup_terms,
                              ensure_cover=lambda book_id, title, author: calls.append((book_id, title, author)))
    for path in (None, "user/b.pdf"):
        backfill.look_up({"id": "b", "file_type": "pdf", "storage_path": path, "title": "Walden",
                          "author": "Thoreau"}, ingestor, lookups)
    assert calls == [("b", "Walden", "Thoreau"), ("b", "Walden", "Thoreau")]
