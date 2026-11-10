"""ingest_book embeds locally, in batches, and never touches the Google client.

The database is the shared fake from conftest.py and the embedder is
replaced, so no model and no network are needed.
"""

import asyncio
import inspect

import numpy as np
import pytest

from backend.nlp import embedder
from backend.services import book_ingestor


@pytest.fixture
def ingest(fake_supabase, monkeypatch):
    """Run ingest_book on `count` fake chunks; returns (result, chunk inserts, book updates, embed calls)."""
    embed_calls = []

    def fake_embed(texts):
        embed_calls.append(list(texts))
        return np.full((len(texts), embedder.EMBEDDING_DIM), 0.05, dtype=np.float32)

    monkeypatch.setattr(embedder, "embed", fake_embed)
    monkeypatch.setattr(book_ingestor, "extract_text_from_pdf", lambda data: ["unused"])
    monkeypatch.setattr(book_ingestor.question_agent, "run", lambda book_id, chunk_ids: None)

    def run(count):
        chunks = [f"chunk number {i} " + "word " * i for i in range(count)]
        monkeypatch.setattr(book_ingestor, "chunk_text", lambda pages, target_words=600: chunks)
        result = asyncio.run(book_ingestor.ingest_book(b"%PDF", "pdf", "book-1", "user-1"))
        inserts, updates = [], []
        for call in fake_supabase.mock_calls:
            name, args = call[0], call[1]
            if name == "table().insert":
                inserts.append(args[0])
            if name == "table().update":
                updates.append(args[0])
        return result, inserts, updates, embed_calls

    return run


def test_every_chunk_is_stored_once_in_order_with_a_local_embedding(ingest):
    result, inserts, _, _ = ingest(12)
    rows = [row for batch in inserts for row in batch]
    assert [row["chunk_index"] for row in rows] == list(range(12))
    assert all(row["book_id"] == "book-1" and row["user_id"] == "user-1" for row in rows)
    assert all(len(row["embedding_local"]) == embedder.EMBEDDING_DIM for row in rows)
    assert all(isinstance(row["embedding_local"][0], float) for row in rows)
    assert all("embedding" not in row for row in rows)
    assert rows[3]["content"].startswith("chunk number 3") and rows[3]["word_count"] == 6
    assert result == {"total_chunks": 12, "total_words": sum(r["word_count"] for r in rows), "status": "ready"}


def test_chunks_are_embedded_and_inserted_in_batches(ingest):
    _, inserts, _, embed_calls = ingest(5 + book_ingestor.EMBED_BATCH + 2)
    assert [len(batch) for batch in inserts] == [5, book_ingestor.EMBED_BATCH, 2]
    assert [len(call) for call in embed_calls] == [5, book_ingestor.EMBED_BATCH, 2]


def test_the_book_is_ready_after_the_first_five_chunks(ingest, fake_supabase):
    _, _, updates, _ = ingest(12)
    assert [u["status"] for u in updates] == ["ready"]
    assert updates[0]["total_chunks"] == 12
    names = [call[0] for call in fake_supabase.mock_calls if call[0] in ("table().insert", "table().update")]
    assert names == ["table().insert", "table().update", "table().insert"]


def test_a_short_book_is_ready_once(ingest):
    result, inserts, updates, _ = ingest(3)
    assert [len(batch) for batch in inserts] == [3]
    assert updates == [{"total_chunks": 3, "total_words": updates[0]["total_words"], "status": "ready"}]
    assert result["status"] == "ready"


def test_a_failing_embedder_marks_the_book_as_error(ingest, monkeypatch):
    def broken(texts):
        raise RuntimeError("model missing")

    ingest(0)  # installs the fakes
    monkeypatch.setattr(embedder, "embed", broken)
    monkeypatch.setattr(book_ingestor, "chunk_text", lambda pages, target_words=600: ["one", "two"])
    result = asyncio.run(book_ingestor.ingest_book(b"%PDF", "pdf", "book-1", "user-1"))
    assert result["status"] == "error" and "model missing" in result["error"]


def test_ingestion_does_not_import_the_google_embedding_client():
    source = inspect.getsource(book_ingestor)
    assert "services.embeddings" not in source
    assert "generate_embedding" not in source


@pytest.fixture
def ingest_with_questions(ingest, fake_supabase, monkeypatch):
    """Like `ingest`, but inserts return chunk ids and the question agent is a recording stub."""
    events = []
    table = fake_supabase.table.return_value

    def insert(rows):
        events.append("insert")
        result = type("Result", (), {"data": [{"id": f"chunk-{row['chunk_index']}"} for row in rows]})
        return type("Query", (), {"execute": lambda self: result})()

    def update(values):
        events.append(f"update:{values['status']}")
        return table.update.return_value

    table.insert.side_effect = insert
    table.update.side_effect = update
    yield ingest, events
    table.insert.side_effect = table.update.side_effect = None


def test_questions_are_generated_for_each_batch_after_it_is_stored(ingest_with_questions, monkeypatch):
    ingest, events = ingest_with_questions
    ingest(0)  # installs the fakes; a book with no chunks asks for no questions
    events.clear()
    monkeypatch.setattr(
        book_ingestor.question_agent, "run",
        lambda book_id, chunk_ids: events.append(("questions", book_id, list(chunk_ids))),
    )
    result, _, _, _ = ingest(7)
    assert result["status"] == "ready"
    assert events == [
        "insert", "update:ready",  # the book unlocks before any question work
        ("questions", "book-1", [f"chunk-{i}" for i in range(5)]),
        "insert",
        ("questions", "book-1", ["chunk-5", "chunk-6"]),
    ]


def test_a_failing_question_agent_does_not_fail_the_book(ingest_with_questions, monkeypatch):
    ingest, events = ingest_with_questions
    ingest(0)
    events.clear()

    def broken(book_id, chunk_ids):
        raise RuntimeError("question bank unavailable")

    monkeypatch.setattr(book_ingestor.question_agent, "run", broken)
    result, inserts, _, _ = ingest(7)
    assert result["status"] == "ready" and "error" not in result
    assert [len(batch) for batch in inserts] == [5, 2]  # every chunk is still stored
    assert events == ["insert", "update:ready", "insert"]
