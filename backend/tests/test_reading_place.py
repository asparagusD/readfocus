"""C32.1 (issue 4): a saved place's chunk, and progress that follows reading. In-memory database, no network."""

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import reading
from backend.services import reading_place
from backend.tests.memory_db import MemoryDb
from backend.xp import badge_award

USER, BOOK = "user-1", "book-1"


def pdf(page):
    return {"kind": "pdf", "page": page, "quads": [[0, 0, 10, 10]], "text": ""}


def epub(cfi):
    return {"kind": "epub", "cfi": cfi, "text": ""}


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    fake.tables["books"] = [{"id": BOOK, "user_id": USER, "title": "T", "author": None, "file_type": "pdf",
                             "file_format": "pdf", "storage_mode": "cloud", "status": "ready", "total_chunks": 3,
                             "page_count": 9, "toc": [], "scanned_pages": None}]
    fake.tables["chunks"] = [{"id": f"c{i}", "book_id": BOOK, "chunk_index": i, "word_count": 100 * (i + 1),
                              "anchors": {"kind": "pdf", "pages": [3 * i + 1, 3 * i + 3]}} for i in range(3)]
    monkeypatch.setattr(reading, "supabase", fake)
    monkeypatch.setattr(reading_place, "supabase", fake)
    monkeypatch.setattr(badge_award, "check_quietly", lambda *a, **k: [])
    reading_place._cache.clear()
    yield fake
    reading_place._cache.clear()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def book(db):
    return db.tables["books"][0]


@pytest.mark.parametrize("page,chunk", [(1, 0), (3, 0), (4, 1), (6, 1), (8, 2), (40, 2)])
def test_a_pdf_page_is_in_the_chunk_whose_pages_hold_it(db, page, chunk):
    assert reading_place.chunk_at(book(db), pdf(page)) == chunk


def test_without_anchored_pages_the_contents_then_the_pages_share_place_it(db):
    for c in db.tables["chunks"]:
        c["anchors"] = None
    book(db)["toc"] = [{"title": "1", "page": 1, "chunk_index": 0}, {"title": "2", "page": 5, "chunk_index": 2}]
    assert reading_place.chunk_at(book(db), pdf(6)) == 2
    book(db)["toc"] = []
    assert reading_place.chunk_at(book(db), pdf(4)) == 1  # page 4 of 9, 3 chunks: (4 - 1) * 3 // 9
    book(db)["page_count"] = None
    assert reading_place.chunk_at(book(db), pdf(4)) is None


def test_an_epub_place_is_in_the_chunk_whose_block_paths_hold_it(db):
    book(db)["file_type"] = "epub"
    for i, c in enumerate(db.tables["chunks"]):
        c["block_paths"] = [{"spine_index": i, "path": "/4/2", "block_id": f"b{i}"}]
    assert reading_place.chunk_at(book(db), epub("epubcfi(/6/4!/4/2/1:0)")) == 1  # spine item 1
    assert reading_place.chunk_at(book(db), epub("epubcfi(/6/6!/4/2/1:0)")) == 2


def test_a_book_with_no_chunks_has_no_place(db):
    book(db)["total_chunks"] = 0
    assert reading_place.chunk_at(book(db), pdf(1)) is None


def test_a_map_found_empty_is_read_again_once_the_anchors_exist(db):
    anchors = [c.pop("anchors") for c in db.tables["chunks"]]
    assert reading_place.chunk_at(book(db), pdf(8)) == 2  # by the pages' share: (8 - 1) * 3 // 9
    for c, a in zip(db.tables["chunks"], anchors):
        c["anchors"] = a
    db.tables["chunks"][2]["anchors"] = {"kind": "pdf", "pages": [9, 9]}  # chunk 1 now runs to page 8
    assert reading_place.chunk_at(book(db), pdf(8)) == 1  # the anchors, now there, are used


def test_saving_a_place_moves_progress_to_its_chunk_and_never_back(client, db):
    assert client.put(f"/books/{BOOK}/position", json={"anchor": pdf(5)}).status_code == 200
    assert db.tables["reading_progress"][0]["chunks_completed"] == 2  # chunk 1 reached
    client.put(f"/books/{BOOK}/position", json={"anchor": pdf(9)})
    assert db.tables["reading_progress"][0]["chunks_completed"] == 3
    client.put(f"/books/{BOOK}/position", json={"anchor": pdf(1)})  # turning back keeps the furthest point
    row = db.tables["reading_progress"][0]
    assert row["chunks_completed"] == 3 and row["position"] == {"anchor": pdf(1)}


def test_a_chunk_index_sent_with_the_place_is_used(client, db):
    client.put(f"/books/{BOOK}/position", json={"anchor": pdf(1), "chunk_index": 2})
    assert db.tables["reading_progress"][0]["chunks_completed"] == 3


def test_a_book_still_being_read_saves_its_place_without_progress(client, db):
    book(db)["total_chunks"] = None
    assert client.put(f"/books/{BOOK}/position", json={"anchor": pdf(5)}).status_code == 200
    assert db.tables["reading_progress"][0]["chunks_completed"] == 0


# --- C32.2: words read per day ---------------------------------------------------------------------------------

def test_moving_forward_records_the_words_reached_on_the_readers_own_day(client, db, monkeypatch):
    class Late(reading_place.datetime):
        @classmethod
        def now(cls, tz=None):  # 20:30 UTC is 02:30 the next day in Dhaka (UTC+6)
            return reading_place.datetime(2026, 11, 18, 20, 30, tzinfo=reading_place.UTC)
    monkeypatch.setattr(reading_place, "datetime", Late)
    db.tables["user_progress"] = [{"user_id": USER, "timezone": "Asia/Dhaka"}]
    client.put(f"/books/{BOOK}/position", json={"anchor": pdf(1)})  # chunk 0 reached: 100 words
    client.put(f"/books/{BOOK}/position", json={"anchor": pdf(4)})  # chunk 1: 200 more
    client.put(f"/books/{BOOK}/position", json={"anchor": pdf(2)})  # back: nothing new
    assert [(r["day"], r["words"]) for r in db.tables["reading_days"]] == [("2026-11-19", 300)]


def test_a_jump_moves_the_place_but_counts_no_words(client, db):
    book(db)["total_chunks"] = 6
    db.tables["chunks"] += [{"id": f"c{i}", "book_id": BOOK, "chunk_index": i, "word_count": 100,
                             "anchors": {"kind": "pdf", "pages": [3 * i + 1, 3 * i + 3]}} for i in range(3, 6)]
    client.put(f"/books/{BOOK}/position", json={"anchor": pdf(16)})  # chunk 5 straight away: the contents
    assert db.tables["reading_progress"][0]["chunks_completed"] == 6
    assert not db.tables.get("reading_days")


def test_a_failing_words_table_never_fails_the_save(client, db, monkeypatch):
    table = db.table

    def no_reading_days(name):
        if name == "reading_days":
            raise RuntimeError("relation reading_days does not exist")
        return table(name)
    monkeypatch.setattr(db, "table", no_reading_days)
    assert client.put(f"/books/{BOOK}/position", json={"anchor": pdf(4)}).status_code == 200
    assert db.tables["reading_progress"][0]["chunks_completed"] == 2

