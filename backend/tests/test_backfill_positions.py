"""scripts/backfill_positions.py on the in-memory database and the reader fixtures (C17.5). No network."""

from pathlib import Path

import pytest

from backend.services import book_ingestor
from backend.tests.memory_db import MemoryDb
from scripts import backfill_positions as backfill

BOOKS = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures" / "books"
PDF = (BOOKS / "sample.pdf").read_bytes()
EPUB = (BOOKS / "reflow.epub").read_bytes()
LAMP = "The lamp on the desk threw a small circle of light, and inside it the page was the only thing that mattered."


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    monkeypatch.setattr(book_ingestor, "supabase", db)
    db.tables["books"] = [
        {"id": "pdf", "file_format": "pdf", "storage_path": "u/pdf.pdf"},
        {"id": "epub", "file_format": "epub", "storage_path": "u/epub.epub"},
        {"id": "device", "file_format": "pdf", "storage_path": None},
    ]
    db.tables["chunks"] = [
        {"book_id": "pdf", "chunk_index": 2, "content": "Chapter 2 Noise\nLine 1 of page 5: the lamp threw a small circle of light.",
         "blocks": [{"id": "2.0", "text": "Chapter 2 Noise"}, {"id": "2.1", "text": "Line 3 of page 5: the lamp threw a small circle of light."}]},
        {"book_id": "epub", "chunk_index": 0, "content": f"Chapter 2\n\n{LAMP}", "blocks": None},
        {"book_id": "device", "chunk_index": 0, "content": "x", "blocks": None},
    ]
    db.tables["reading_progress"] = [
        {"id": "p1", "user_id": "u", "book_id": "pdf", "position": {"chunk_index": 2, "block_id": "2.1", "char_offset": 0}},
        {"id": "p2", "user_id": "u", "book_id": "epub", "position": {"chunk_index": 0, "block_id": "0.0", "char_offset": 0}},
        {"id": "p3", "user_id": "u", "book_id": "device", "position": {"chunk_index": 0, "block_id": "0.0", "char_offset": 0}},
        {"id": "p4", "user_id": "u", "book_id": "pdf", "position": None},
        {"id": "p5", "user_id": "u", "book_id": "pdf", "position": {"chunk_index": 2, "anchor": {"kind": "pdf", "page": 1}}},
    ]
    db.files.update({"u/pdf.pdf": PDF, "u/epub.epub": EPUB})
    return db


def handle(db, dry_run=False):
    files = {}
    rows = backfill.pending_rows(db)
    outcomes = {row["id"]: backfill.backfill_row(row, db, book_ingestor.download, files, dry_run) for row in rows}
    return outcomes


def position(db, row_id):
    return next(row for row in db.tables["reading_progress"] if row["id"] == row_id)["position"]


def test_pending_places_are_c12_places_with_no_anchor(db):
    assert [row["id"] for row in backfill.pending_rows(db)] == ["p1", "p2", "p3"]


def test_a_pdf_place_gets_a_point_on_the_page_holding_its_text_and_keeps_its_c12_keys(db):
    outcomes = handle(db)
    assert outcomes["p1"] == "added page 5"
    assert position(db, "p1") == {"chunk_index": 2, "block_id": "2.1", "char_offset": 0,
                                  "anchor": {"kind": "pdf", "page": 5, "quads": [[0, 0, 0, 0]], "text": ""}}


def test_an_epub_place_gets_a_collapsed_cfi_at_its_first_character(db):
    handle(db)
    anchor = position(db, "p2")["anchor"]
    # Spine: cover, ch1, ch2, ch3; "Chapter 2" is ch2's <h1>, the body's first element (/4/2), its text (/1).
    assert anchor == {"kind": "epub", "cfi": "epubcfi(/6/6!/4/2/1:0)", "text": ""}


def test_the_cfi_steps_count_elements_and_text_chunks():
    doc = b'<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>One <b>two</b> three</p><p>Four five</p></body></html>'
    assert backfill.epub_cfi_in(doc, 1, ["three"]) == "epubcfi(/6/4!/4/2/3:1)"  # after <b>, past its space
    assert backfill.epub_cfi_in(doc, 1, ["two"]) == "epubcfi(/6/4!/4/2/2/1:0)"
    assert backfill.epub_cfi_in(doc, 0, ["five"]) == "epubcfi(/6/2!/4/4/1:5)"
    assert backfill.epub_cfi_in(doc, 0, ["absent"]) is None


def test_a_book_with_no_stored_file_or_no_match_is_left_alone(db):
    db.tables["chunks"][0]["blocks"][1]["text"] = "Nothing like this is in the PDF at all, not one line of it."
    db.tables["chunks"][0]["content"] = "Nor is this chunk's content anywhere in the PDF file."
    outcomes = handle(db)
    assert outcomes["p3"] == "skipped: the book has no stored file"
    assert outcomes["p1"] == "skipped: the text was not found in the file"
    assert "anchor" not in position(db, "p1") and "anchor" not in position(db, "p3")


def test_a_dry_run_writes_nothing_and_a_second_run_finds_nothing_to_do(db):
    before = [dict(row) for row in db.tables["reading_progress"]]
    assert handle(db, dry_run=True)["p1"] == "would add page 5"
    assert db.tables["reading_progress"] == before
    handle(db)
    assert [row["id"] for row in backfill.pending_rows(db)] == ["p3"]  # no file: stays pending, nothing else
