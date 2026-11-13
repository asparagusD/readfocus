"""Storing prose-only text after the regions job (C18.6b): backend/services/prose_job.py and the evaluator's passage."""

import asyncio

import numpy as np
import pytest

from backend.agents import evaluator_agent
from backend.nlp import embedder
from backend.services import prose_job
from backend.tests.memory_db import MemoryDb

USER, BOOK = "user-1", "book-1"
PAGES = ["Ohm's law is simple.\nE = I R (2.1)\nIt holds for metals.", "", "A plain page of words only."]


@pytest.fixture
def db(monkeypatch):
    fake = MemoryDb()
    monkeypatch.setattr(prose_job, "supabase", fake)
    monkeypatch.setattr(evaluator_agent, "supabase", fake)
    monkeypatch.setattr(prose_job, "pdf_page_texts", lambda data: PAGES)
    monkeypatch.setattr(embedder, "embed", lambda texts: np.ones((len(texts), embedder.EMBEDDING_DIM)))
    fake.generated = []
    monkeypatch.setattr(prose_job.question_agent, "run", lambda book_id, ids: fake.generated.append(sorted(ids)))
    fake.tables["books"] = [{"id": BOOK, "user_id": USER, "file_type": "pdf", "storage_path": "u/b.pdf"}]
    fake.tables["chunks"] = [
        {"id": "c0", "book_id": BOOK, "user_id": USER, "chunk_index": 0,
         "content": "Ohm's law is simple.\nE = I R (2.1)\nIt holds for metals."},
        {"id": "c1", "book_id": BOOK, "user_id": USER, "chunk_index": 1, "content": "A plain page of words only."},
    ]
    fake.tables["page_regions"] = [
        {"book_id": BOOK, "page": 1, "kind": "block", "text": "Ohm's law is simple.", "order_in_page": 0, "meta": {}},
        {"book_id": BOOK, "page": 1, "kind": "math", "text": "E = IR (2.1)", "order_in_page": 1,
         "meta": {"equation_number": "2.1"}},
        {"book_id": BOOK, "page": 1, "kind": "block", "text": "It holds for metals.", "order_in_page": 2, "meta": {}},
    ]
    fake.tables["question_bank"] = [
        {"id": "q-old", "chunk_id": "c0", "book_id": BOOK, "times_used": 0, "prompt": "E = ___"},
        {"id": "q-used", "chunk_id": "c0", "book_id": BOOK, "times_used": 2, "prompt": "Used once"},
        {"id": "q-c1", "chunk_id": "c1", "book_id": BOOK, "times_used": 0, "prompt": "Plain"},
    ]
    return fake


def rebuild(db):
    return prose_job.rebuild(db.tables["books"][0], b"%PDF")


def test_rebuild_stores_prose_anchors_and_garbled_counts(db):
    report = rebuild(db)
    first, second = db.tables["chunks"]
    assert first["prose"] == "Ohm's law is simple.\n[Equation 2.1, p. 1]\nIt holds for metals."
    assert first["anchors"]["pages"] == [1, 1] and first["anchors"]["placeholders"][0]["kind"] == "math"
    assert first["garbled_sentences"] == 0
    assert second["prose"] == second["content"] and second["anchors"]["pages"] == [3, 3]
    assert report == {"chunks": 2, "stored": 2, "requestioned": 1, "garbled": 0, "placeholders": 1}


def test_only_chunks_whose_text_changed_are_embedded_again_and_requestioned(db):
    rebuild(db)
    assert db.generated == [["c0"]]
    assert "embedding_local" in db.tables["chunks"][0] and "embedding_local" not in db.tables["chunks"][1]
    ids = {row["id"] for row in db.tables["question_bank"]}
    assert ids == {"q-used", "q-c1"}  # c0's unused question went; a used one and other chunks' stay


def test_rebuild_is_idempotent(db):
    rebuild(db)
    calls = len(db.calls)
    assert rebuild(db)["stored"] == 0
    assert db.generated == [["c0"]]
    assert not [c for c in db.calls[calls:] if c[1] in ("update", "delete")]


def test_a_book_without_regions_is_left_alone(db):
    db.tables["page_regions"] = []
    assert rebuild(db) == {"chunks": 2, "stored": 0, "requestioned": 0, "garbled": 0, "placeholders": 0}
    assert "prose" not in db.tables["chunks"][0]


def test_after_regions_never_raises(db):
    db.broken.add("chunks")
    asyncio.run(prose_job.after_regions(db.tables["books"][0], b"%PDF"))


# --- the evaluator's passage ---------------------------------------------------------------------

def test_the_passage_reads_prose_when_a_chunk_has_it(db):
    rebuild(db)
    passage = evaluator_agent.load_passage(BOOK, [0, 1])
    assert "[Equation 2.1, p. 1]" in passage and "E = I R" not in passage


def test_reference_from_passage_leaves_out_garbled_and_placeholder_sentences():
    passage = ("Resistance opposes the flow of current in a wire. The law is [Equation 2.1, p. 1] for metals. "
               "Th voltage rises when the resistance grows in the circuit.")
    reference = evaluator_agent.reference_from_passage(passage)
    assert "Resistance opposes" in reference
    assert "[" not in reference and "" not in reference
