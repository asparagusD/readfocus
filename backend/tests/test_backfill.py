"""scripts/backfill_local_embeddings.py on a fake database. No model, no network."""

import numpy as np
import pytest

from backend.nlp import embedder
from scripts import backfill_local_embeddings as backfill


class FakeChunks:
    """Just enough of the Supabase query builder for the backfill."""

    def __init__(self, rows):
        self.rows = rows
        self.updates = []
        self.selects = 0

    def pending(self, after, limit, book_id=None):
        self.selects += 1
        rows = [r for r in self.rows if r["embedding_local"] is None and r["id"] > after]
        if book_id:
            rows = [r for r in rows if r["book_id"] == book_id]
        return sorted(rows, key=lambda r: r["id"])[:limit]

    def save(self, chunk_id, vector):
        self.updates.append(chunk_id)
        next(r for r in self.rows if r["id"] == chunk_id)["embedding_local"] = vector


@pytest.fixture
def chunks(monkeypatch):
    monkeypatch.setattr(
        embedder, "embed", lambda texts: np.full((len(texts), embedder.EMBEDDING_DIM), 0.05, dtype=np.float32)
    )
    rows = [
        {"id": f"id-{i:02d}", "book_id": "a" if i < 7 else "b", "content": f"text {i}",
         "embedding_local": [0.1] * 384 if i in (2, 5) else None}
        for i in range(10)
    ]
    return FakeChunks(rows)


def test_backfill_embeds_only_the_rows_that_have_no_local_embedding(chunks):
    done = backfill.run(chunks.pending, chunks.save, batch_size=3)
    assert done == 8
    assert chunks.updates == [f"id-{i:02d}" for i in (0, 1, 3, 4, 6, 7, 8, 9)]
    assert all(len(r["embedding_local"]) == embedder.EMBEDDING_DIM for r in chunks.rows)


def test_backfill_is_idempotent_and_resumable(chunks):
    assert backfill.run(chunks.pending, chunks.save, batch_size=3, limit=4) == 4
    assert backfill.run(chunks.pending, chunks.save, batch_size=3) == 4
    assert backfill.run(chunks.pending, chunks.save, batch_size=3) == 0
    assert len(chunks.updates) == len(set(chunks.updates)) == 8


def test_dry_run_counts_and_writes_nothing(chunks):
    assert backfill.run(chunks.pending, chunks.save, batch_size=3, dry_run=True) == 8
    assert chunks.updates == []
    assert sum(r["embedding_local"] is None for r in chunks.rows) == 8


def test_backfill_can_be_limited_to_one_book(chunks):
    assert backfill.run(chunks.pending, chunks.save, batch_size=3, book_id="b") == 3
    assert chunks.updates == ["id-07", "id-08", "id-09"]


def test_refuses_to_run_outside_development(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    with pytest.raises(SystemExit, match="development"):
        backfill.check_environment(allow_non_dev=False)
    backfill.check_environment(allow_non_dev=True)
    monkeypatch.setenv("ENV", "development")
    backfill.check_environment(allow_non_dev=False)
