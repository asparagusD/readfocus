"""scripts/backfill_block_paths.py on the in-memory database (C23.G, DEBUG_LOG): EPUB block paths stored one step
too deep (a <body> with attributes counted as a step) are rebuilt from the book's file; nothing else is written.
No network."""

import io
import zipfile

import pytest

from backend.services import book_ingestor, book_structure
from backend.tests.memory_db import MemoryDb
from backend.tests.test_book_structure import make_book_epub
from scripts import backfill_block_paths as backfill

DOCS = [("<h1>Chapter I</h1><p>Alice was beginning to get very tired of sitting by her sister on the bank.</p>"
         "<p>So she was considering in her own mind whether the pleasure of making a daisy-chain would be worth it.</p>"),
        "<h1>Chapter II</h1><p>Curiouser and curiouser, cried Alice, for the moment she quite forgot how to speak.</p>"]


def with_body_attributes(data: bytes) -> bytes:
    """The same EPUB with `<body epub:type="bodymatter">`, as Standard Ebooks write it (ebooklib keeps that tag)."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            content = src.read(item.filename)
            if item.filename.endswith(".xhtml"):
                content = content.replace(b'<html xmlns="http://www.w3.org/1999/xhtml">',
                                          b'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">')
                content = content.replace(b"<body>", b'<body epub:type="bodymatter">')
            dst.writestr(item, content)
    return out.getvalue()


def deeper(paths):
    """The paths as ingestion stored them before the fix: one /2 step after the body's."""
    return [[{**p, "path": "/4/2" + p["path"][2:]} for p in chunk] for chunk in paths]


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    monkeypatch.setattr(book_ingestor, "supabase", db)
    attributed, bare = with_body_attributes(make_book_epub(DOCS)), make_book_epub(DOCS)
    contents = book_ingestor.chunk_text(book_ingestor.extract_text_from_epub(attributed), 20)
    blocks, _toc, right = book_structure.build_with_paths("epub", attributed, contents)
    db.tables["books"] = [
        {"id": "b2", "status": "ready", "file_type": "epub", "storage_path": "u/b2.epub", "title": "Bare body"},
        {"id": "b1", "status": "ready", "file_type": "epub", "storage_path": "u/b1.epub", "title": "Attributed"},
        {"id": "b3", "status": "ready", "file_type": "pdf", "storage_path": "u/b3.pdf", "title": "A PDF"},
        {"id": "b4", "status": "ready", "file_type": "epub", "storage_path": None, "title": "On a device"},
        {"id": "b5", "status": "processing", "file_type": "epub", "storage_path": "u/b5.epub", "title": "Not ready"},
        {"id": "b6", "status": "ready", "file_type": "epub", "storage_path": "u/b6.epub", "title": "Edited text"},
    ]
    db.files["u/b1.epub"], db.files["u/b2.epub"], db.files["u/b6.epub"] = attributed, bare, attributed
    rows = []
    for book, paths in (("b1", deeper(right)), ("b2", right), ("b6", deeper(right))):
        for i, content in enumerate(contents):
            stored_blocks = [dict(b) for b in blocks[i]]
            if book == "b6" and i == 0:
                stored_blocks[0]["text"] = "Not what the file says."
            rows.append({"id": f"{book}-{i}", "book_id": book, "chunk_index": i, "content": content,
                         "blocks": stored_blocks, "block_paths": paths[i]})
    db.tables["chunks"] = rows
    db.right = right  # the paths the fixed code builds
    return db


def chunk_rows(db, book_id):
    return sorted((c for c in db.tables["chunks"] if c["book_id"] == book_id), key=lambda c: c["chunk_index"])


def fix(db, row, write=False):
    return backfill.fix_book(row, db, book_ingestor, book_structure, write)


def test_candidates_are_ready_epubs_with_a_stored_file_in_id_order(db):
    assert [r["id"] for r in backfill.candidate_rows(db)] == ["b1", "b2", "b6"]
    assert [r["id"] for r in backfill.candidate_rows(db, book_id="b2")] == ["b2"]
    assert [r["id"] for r in backfill.candidate_rows(db, limit=1)] == ["b1"]


def test_a_dry_run_reports_the_chunks_that_would_change_and_writes_nothing(db):
    before = [dict(c) for c in db.tables["chunks"]]
    outcome = fix(db, backfill.candidate_rows(db, book_id="b1")[0])
    n = len(chunk_rows(db, "b1"))
    assert outcome == f"would rewrite {n} of {n} chunks"
    assert db.tables["chunks"] == before


def test_a_write_rewrites_only_block_paths_and_a_second_run_changes_nothing(db):
    row = backfill.candidate_rows(db, book_id="b1")[0]
    before = {c["chunk_index"]: (c["content"], c["blocks"]) for c in chunk_rows(db, "b1")}
    assert fix(db, row, write=True).startswith("rewrote ")
    after = chunk_rows(db, "b1")
    assert [c["block_paths"] for c in after] == db.right
    assert {c["chunk_index"]: (c["content"], c["blocks"]) for c in after} == before  # text and blocks untouched
    assert fix(db, row, write=True) == "unchanged"
    paths = [c["block_paths"] for c in after]
    first_p = next(p for chunk in paths for p in chunk if p["block_id"].endswith(".1"))
    assert first_p["path"] == "/4/4"  # <body>, its second child <p>: no step for the <body> tag


def test_a_book_already_right_is_unchanged(db):
    assert fix(db, backfill.candidate_rows(db, book_id="b2")[0], write=True) == "unchanged"


def test_a_book_whose_stored_blocks_differ_from_its_file_is_skipped_untouched(db):
    before = [dict(c) for c in chunk_rows(db, "b6")]
    outcome = fix(db, backfill.candidate_rows(db, book_id="b6")[0], write=True)
    assert outcome.startswith("skipped: stored blocks differ from the file")
    assert chunk_rows(db, "b6") == before


def test_one_failing_book_is_reported_and_the_run_goes_on(db):
    seen = []
    rows = backfill.candidate_rows(db)
    db.files.pop("u/b1.epub")
    backfill.run(rows, lambda row: fix(db, row), report=lambda row, outcome: seen.append((row["id"], outcome)))
    assert [r for r, _ in seen] == ["b1", "b2", "b6"]
    assert seen[0][1].startswith("error:") and seen[1][1] == "unchanged"


def test_it_refuses_to_write_outside_development_without_the_flag(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    with pytest.raises(SystemExit):
        backfill.check_environment(allow_non_dev=False)
    backfill.check_environment(allow_non_dev=True)
