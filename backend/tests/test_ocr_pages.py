"""Scanned PDF pages and their OCR text (C19.4): flagged at ingestion, cleaned, stored, read back, and re-ingested."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import ocr, sessions
from backend.services import book_ingestor, ocr_pages, pdf_text
from backend.services import processing_jobs as jobs
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
W, H = 612.0, 792.0


def word(t, x, y, c=95.0, p=0, line=0, w=40.0):
    return {"t": t, "b": [x, y, x + w, y + 12], "c": c, "p": p, "l": line}


# --- pure: cleaning a page's words ---------------------------------------------------------------

def test_clean_page_keeps_sure_words_in_lines_and_paragraphs():
    words = [word("The", 72, 72), word("lamp", 116, 72), word("glowed.", 160, 72),
             word("It", 72, 90, line=1), word("was", 90, 90, line=1), word("late.", 130, 90, line=1),
             word("Next", 72, 140, p=1, line=2), word("day.", 120, 140, p=1, line=2)]
    out = ocr_pages.clean_page(words, W, H, [])
    assert out["text"] == "The lamp glowed.\nIt was late.\n\nNext day."
    assert [p["bbox"] for p in out["paragraphs"]] == [[72, 72, 200, 102], [72, 140, 160, 152]]
    assert len(out["words"]) == 8 and out["dropped"] == 0


def test_clean_page_drops_unsure_long_offpage_and_skipped_words():
    words = [word("kept", 72, 72), word("blur", 120, 72, c=30), word("x" * 60, 170, 72),
             word("outside", 700, 72), word("E=mc2", 300, 400)]
    out = ocr_pages.clean_page(words, W, H, [[280, 380, 420, 430]])
    assert out["text"] == "kept" and out["dropped"] == 4


def test_clean_page_drops_garbled_lines():
    words = [word("(cid:12)(cid:13)(cid:14)", 72, 72, w=120), word("Clean", 72, 90, line=1), word("prose.", 120, 90, line=1)]
    out = ocr_pages.clean_page(words, W, H, [])
    assert out["text"] == "Clean prose." and out["dropped"] == 1


def test_the_scan_itself_is_not_a_figure_to_skip():
    regions = [{"kind": "figure", "bbox": [0, 0, W, H]}, {"kind": "math", "bbox": [10, 10, 50, 30]},
               {"kind": "figure", "bbox": [100, 100, 200, 200]}, {"kind": "block", "bbox": [0, 0, 10, 10]}]
    assert ocr_pages.skip_boxes(regions, W, H) == [[10, 10, 50, 30], [100, 100, 200, 200]]


@pytest.mark.parametrize("book, done, expected", [
    ({"scanned_pages": [1, 2], "status": "ready", "total_chunks": 0}, [1, 2], True),
    ({"scanned_pages": [1, 2], "status": "ready", "total_chunks": 0}, [1], False),
    ({"scanned_pages": [1, 2], "status": "ready", "total_chunks": 7}, [1, 2], False),  # chunks stay as they are
    ({"scanned_pages": [1], "status": "ready", "total_chunks": 0, "storage_mode": "device"}, [1], False),
    ({"scanned_pages": [], "status": "ready", "total_chunks": 0}, [], False),
])
def test_only_a_fully_scanned_cloud_book_is_read_again(book, done, expected):
    assert ocr_pages.ready_to_reingest(book, done) is expected


# --- ingestion: flagging and OCR text standing in ------------------------------------------------

def test_ingestion_flags_pages_without_text_and_keeps_a_mixed_books_own_text(monkeypatch):
    monkeypatch.setattr(pdf_text, "page_texts", lambda data: ["A full page of real text here.", "", " 12 ", "More text on the fourth page."])
    scanned, asked = [], []
    assert book_ingestor.extract_text_from_pdf(b"%PDF", lambda: asked.append(1) or {2: "Read by OCR."}, scanned) == [
        "A full page of real text here.", " 12 ", "More text on the fourth page."]
    assert scanned == [2, 3] and asked == []  # a book with text of its own never asks for OCR text


def test_a_fully_scanned_book_takes_its_ocr_text_and_drops_stray_marks(monkeypatch):
    monkeypatch.setattr(pdf_text, "page_texts", lambda data: ["", " 12 ", "Digitized"])
    scanned = []
    assert book_ingestor.extract_text_from_pdf(b"%PDF", lambda: {1: "Page one.", 3: "Page three."}, scanned) == [
        "Page one.", "Page three."]
    assert scanned == [1, 2, 3]
    assert book_ingestor.extract_text_from_pdf(b"%PDF", dict) == []  # before any OCR: no chunks, pages-only


# --- the endpoints ---------------------------------------------------------------------------------

@pytest.fixture
def api(monkeypatch):
    db = MemoryDb()
    for module in (ocr, ocr_pages, jobs, sessions):
        monkeypatch.setattr(module, "supabase", db)
    db.tables["books"] = [{"id": "b1", "user_id": USER, "file_type": "pdf", "status": "ready", "total_chunks": 0,
                           "storage_mode": "cloud", "scanned_pages": [1, 2], "title": "Scans", "author": "A"},
                          {"id": "b2", "user_id": USER, "file_type": "pdf", "status": "ready", "total_chunks": 4,
                           "storage_mode": "cloud", "scanned_pages": [3], "title": "Mixed", "author": "B"}]
    db.tables["page_regions"] = [{"id": "r1", "book_id": "b1", "page": 1, "kind": "unreadable", "bbox": [0, 0, W, H],
                                  "order_in_page": 0}]
    runs = []

    async def fake_run(job, file_bytes=None):
        runs.append(job["book_id"])

    monkeypatch.setattr(book_ingestor, "run_job", fake_run)
    app.dependency_overrides[get_current_user] = lambda: USER
    yield SimpleNamespace(client=TestClient(app), db=db, runs=runs)
    app.dependency_overrides.clear()


def page_body(page, words=None):
    return {"page": page, "width": W, "height": H, "engine": "tesseract.js 7.0.0 eng",
            "words": words if words is not None else [word("The", 72, 72), word("lamp.", 116, 72)]}


def test_a_page_is_stored_with_its_regions_and_read_back(api):
    resp = api.client.post("/books/b1/ocr", json=page_body(1))
    assert resp.status_code == 200 and resp.json() == {
        "page": 1, "words": 2, "dropped": 0, "done": 1, "scanned": 2, "reingest": False}
    [row] = api.db.tables["page_ocr"]
    assert (row["page"], row["text"], row["user_id"]) == (1, "The lamp.", USER)
    regions = [r for r in api.db.tables["page_regions"] if r["book_id"] == "b1" and r["page"] == 1]
    assert [(r["kind"], r["text"], r["meta"]) for r in regions] == [("block", "The lamp.", {"source": "ocr"})]
    got = api.client.get("/books/b1/ocr?first=1&last=2").json()
    assert got["scanned_pages"] == [1, 2] and got["done"] == [1]
    assert got["pages"] == [{"page": 1, "words": row["words"]}]


def test_posting_a_page_again_replaces_it(api):
    api.client.post("/books/b1/ocr", json=page_body(1))
    api.client.post("/books/b1/ocr", json=page_body(1, [word("Again.", 72, 72)]))
    assert [r["text"] for r in api.db.tables["page_ocr"]] == ["Again."]
    assert [r["text"] for r in api.db.tables["page_regions"] if r["page"] == 1] == ["Again."]


def test_the_last_scanned_page_starts_ingestion_again(api):
    api.client.post("/books/b1/ocr", json=page_body(1))
    resp = api.client.post("/books/b1/ocr", json=page_body(2))
    assert resp.json()["reingest"] is True
    assert api.runs == ["b1"]
    book = next(b for b in api.db.tables["books"] if b["id"] == "b1")
    assert book["status"] == "processing"
    job = jobs.get("b1")
    assert (job["status"], job["cursor"]) == ("running", 0)


def test_a_book_with_chunks_keeps_them(api):
    resp = api.client.post("/books/b2/ocr", json=page_body(3))
    assert resp.json()["reingest"] is False and api.runs == []


@pytest.mark.parametrize("path, body, code", [
    ("/books/b1/ocr", page_body(5), 409),  # not a scanned page
    ("/books/nope/ocr", page_body(1), 404),
    ("/books/b1/ocr", {**page_body(1), "width": 0}, 422),
])
def test_bad_posts_are_refused(api, path, body, code):
    assert api.client.post(path, json=body).status_code == code
    assert "page_ocr" not in api.db.tables or api.db.tables["page_ocr"] == []


def test_another_readers_book_is_not_found(api):
    api.db.tables["books"][0]["user_id"] = OTHER
    assert api.client.post("/books/b1/ocr", json=page_body(1)).status_code == 404
    assert api.client.get("/books/b1/ocr").status_code == 404


def test_a_fully_scanned_book_opens_pages_only(api, monkeypatch):
    async def no_chunks(user_id, book_id):
        return SimpleNamespace(chunk_indices=[]), {}

    monkeypatch.setattr(sessions, "run_start", no_chunks)
    monkeypatch.setattr(sessions, "owns_book", lambda user_id, book_id: True)
    monkeypatch.setattr(sessions, "read_book", lambda user_id, book_id, first: ({"title": "Scans", "format": "pdf"}, None))
    data = api.client.post("/sessions/start", json={"book_id": "b1"}).json()
    assert data["pages_only"] is True and data["session_id"] is None and data["scanned_pages"] == [1, 2]
    assert data["book"]["title"] == "Scans"
    # A book with chunks but nothing left to read is still the old 400.
    assert api.client.post("/sessions/start", json={"book_id": "b2"}).status_code == 400


def ingest(monkeypatch, texts: list[str], ocr: dict[int, str]):
    """Run the ingest job on a PDF whose pypdf page texts are `texts`, with `ocr` stored; (db, region job calls)."""
    db = MemoryDb()
    for module in (book_ingestor, ocr_pages, jobs):
        monkeypatch.setattr(module, "supabase", db)
    db.tables["books"] = [{"id": "b1", "user_id": USER, "file_type": "pdf", "status": "processing",
                           "storage_path": "u/b1.pdf", "title": "t", "author": "a"}]
    db.tables["page_ocr"] = [{"book_id": "b1", "page": page, "text": text} for page, text in ocr.items()]
    monkeypatch.setattr(pdf_text, "page_texts", lambda data: list(texts))
    monkeypatch.setattr(book_ingestor, "chunk_text", lambda pages, target_words=600: [p for p in pages if p.strip()])
    monkeypatch.setattr(book_ingestor.book_structure, "build_with_paths", lambda *a: (None, None, None))
    monkeypatch.setattr(book_ingestor.embedder, "embed", lambda texts: [[0.0] * 3 for _ in texts])

    async def no_questions(book_id, rows):
        return None
    monkeypatch.setattr(book_ingestor, "generate_questions", no_questions)
    monkeypatch.setattr(book_ingestor, "look_up_cover", lambda book, data: None)
    regions = []

    async def after_ingest(book, data=None):
        regions.append(book["id"])
    monkeypatch.setattr(book_ingestor.region_job, "after_ingest", after_ingest)
    job = jobs.claim(jobs.create("b1", USER), manual=True)
    asyncio.run(book_ingestor.run_job(job, b"%PDF"))
    return db, regions


def contents(db) -> list[str]:
    return [c["content"] for c in sorted(db.tables.get("chunks", []), key=lambda c: c["chunk_index"])]


def test_a_fully_scanned_book_is_read_from_its_ocr_text(monkeypatch):
    db, regions = ingest(monkeypatch, ["", " 3 "], {1: "Read by OCR on page one.", 2: "And on page two."})
    assert db.tables["books"][0]["scanned_pages"] == [1, 2]
    assert contents(db) == ["Read by OCR on page one.", "And on page two."]
    assert regions == []  # the OCR'd book's regions came from the OCR


def test_a_book_with_its_own_text_never_takes_ocr_text_into_chunks(monkeypatch):
    # C18: stored chunk text never changes once questions quote it. A resumed job (the startup sweep) on a
    # mixed book whose scanned page was OCR'd meanwhile must cut the same chunks as its first run did.
    db, regions = ingest(monkeypatch, ["Some text on the first page.", ""], {2: "Read by OCR on page two."})
    assert db.tables["books"][0]["scanned_pages"] == [2]
    assert contents(db) == ["Some text on the first page."]
    assert regions == ["b1"]  # its region map is built as for any PDF
