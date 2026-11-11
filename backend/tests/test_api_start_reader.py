"""What /sessions/start sends the paginated reader (C12.3b): blocks per chunk, the book's title, the chapter in effect."""

import pytest

from backend.tests.test_api_sessions import BOOK, USER, api  # noqa: F401 - api is a fixture

TOC = [{"title": "Chapter I: Economy", "chunk_index": 0, "block_id": "0.0"},
       {"title": "Chapter II: Where I Lived", "chunk_index": 2, "block_id": "2.0"}]


@pytest.fixture
def book(api):  # noqa: F811
    row = {"id": BOOK, "user_id": USER, "title": "Walden", "author": "Henry David Thoreau", "toc": TOC}
    api.db.tables["books"] = [row]
    for chunk in api.db.tables["chunks"]:
        chunk["blocks"] = [{"id": f"{chunk['chunk_index']}.0", "type": "paragraph", "text": chunk["content"], "marks": []}]
    return row


def start(api, chunks):  # noqa: F811
    api.plan.chunk_indices = chunks
    return api.client.post("/sessions/start", json={"book_id": BOOK}).json()


def test_each_chunk_comes_with_its_blocks(api, book):  # noqa: F811
    body = start(api, [0, 1])
    assert [c["blocks"][0]["id"] for c in body["chunks"]] == ["0.0", "1.0"]
    assert {"chunk_index", "content", "word_count", "blocks"} <= set(body["chunks"][0])


def test_the_book_title_author_and_contents_come_with_the_session(api, book):  # noqa: F811
    assert start(api, [0])["book"] == {"title": "Walden", "author": "Henry David Thoreau", "toc": TOC}


@pytest.mark.parametrize("chunks, chapter", [
    ([0], None),                                # the session opens the first chapter itself
    ([1], "Chapter I: Economy"),                # mid-chapter: the chapter that began earlier
    ([2], "Chapter I: Economy"),                # chapter II starts inside the session: the reader finds it
])
def test_the_chapter_in_effect_before_the_first_chunk(api, book, chunks, chapter):  # noqa: F811
    assert start(api, chunks)["chapter_before"] == chapter


def test_a_book_without_a_toc_or_blocks_still_starts(api, book):  # noqa: F811
    book["toc"] = None
    for chunk in api.db.tables["chunks"]:
        chunk.pop("blocks")
    body = start(api, [1])
    assert body["chapter_before"] is None and body["chunks"][0].get("blocks") is None
    assert body["book"]["toc"] == []  # contents drawer: an empty list, not null


def test_a_failed_book_read_never_fails_the_start(api, book):  # noqa: F811
    api.db.broken.add("books")
    response = api.client.post("/sessions/start", json={"book_id": BOOK})
    assert response.status_code == 200
    assert response.json()["book"] is None and response.json()["chapter_before"] is None
