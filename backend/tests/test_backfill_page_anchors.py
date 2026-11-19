"""scripts/backfill_page_anchors.py (DEBUG_LOG 2026-11-19 C36.G) on the in-memory database."""

from backend.services import book_ingestor
from backend.tests.memory_db import MemoryDb
from scripts import backfill_page_anchors as backfill

BOOK = "b1"
TEXTS = {1: "alpha beta", 2: "", 3: "gamma delta", 4: "epsilon"}


def db_with(contents, anchors=None, toc=None):
    db = MemoryDb()
    db.tables["books"] = [{"id": BOOK, "title": "Atlas", "file_type": "pdf", "status": "ready", "toc": toc,
                           "source_format": "browser-text"}]
    db.tables["chunks"] = [{"id": f"c{i}", "book_id": BOOK, "chunk_index": i, "content": text,
                            "anchors": (anchors or {}).get(i)} for i, text in enumerate(contents)]
    db.tables["page_ocr"] = [{"book_id": BOOK, "page": n, "text": t} for n, t in TEXTS.items()]
    return db


def handle(db, dry_run=False):
    (row,) = backfill.pending_rows(db, book_id=BOOK)
    return backfill.backfill_book(row, db, book_ingestor, dry_run)


CONTENTS = ["alpha beta\n\ngamma", "delta\n\nepsilon"]
TOC = [{"title": "One", "chunk_index": 1, "page": None}]


def test_a_dry_run_reports_and_writes_nothing():
    db = db_with(CONTENTS, toc=TOC)
    assert handle(db, dry_run=True) == "would add pages to 2 of 2 chunks and 1 contents entries"
    assert all(c["anchors"] is None for c in db.tables["chunks"]) and db.tables["books"][0]["toc"] == TOC


def test_the_chunks_get_their_pages_and_the_contents_too_once():
    db = db_with(CONTENTS, toc=TOC)
    assert handle(db) == "added pages to 2 of 2 chunks and 1 contents entries"
    assert [c["anchors"]["pages"] for c in db.tables["chunks"]] == [[1, 3], [3, 4]]
    assert db.tables["books"][0]["toc"][0]["page"] == 3
    assert handle(db) == "nothing to do"


def test_a_chunk_with_anchors_is_never_touched():
    kept = {"kind": "pdf", "pages": [9, 9], "spans": [], "placeholders": []}
    db = db_with(CONTENTS, anchors={0: kept})
    assert handle(db) == "added pages to 1 of 2 chunks and 0 contents entries"
    assert db.tables["chunks"][0]["anchors"] == kept and db.tables["chunks"][1]["anchors"]["pages"] == [3, 4]


def test_chunks_not_cut_from_these_texts_are_left_alone():
    db = db_with(["something else entirely"])
    assert handle(db) == "skipped: its chunks were not cut from these page texts"
    assert db.tables["chunks"][0]["anchors"] is None


def test_a_book_with_no_page_texts_is_skipped():
    db = db_with(CONTENTS)
    db.tables["page_ocr"] = []
    assert handle(db) == "skipped: no page texts"
