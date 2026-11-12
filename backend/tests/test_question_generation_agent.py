"""QuestionGenerationAgent on an in-memory database and a fake embedder. No model, no network."""

import hashlib
import inspect

import numpy as np
import pytest

from backend.agents import policy
from backend.agents.question_generation import agent as agent_module
from backend.agents.question_generation.agent import (
    GenerationReport,
    QuestionGenerationAgent,
)
from backend.nlp import embedder

BODY_A = (
    "Photosynthesis is the process by which green plants turn sunlight into chemical energy. "
    "Plants absorb light energy through a pigment known as chlorophyll, which gives leaves their colour. "
    "Leaves look green because chlorophyll reflects the green part of the visible light. "
    "The chemical energy is stored as sugar and later released when the plant needs to grow."
)
BODY_B = (
    "Academic Editor: Jane Doe Received: 28 May 2025 Accepted: 19 June 2025 Published: 20 June 2025\n\n"
    "Cellular respiration releases the chemical energy that plants stored in sugar during the day. "
    "Respiration happens in the mitochondria of every living cell, both in daylight and at night. "
    "Oxygen is consumed during respiration, and as a result carbon dioxide leaves the cell."
)
REFERENCES = (
    "Kingma, D.P.; Ba, J. Adam: A method for stochastic optimization. arXiv 2014, arXiv:1412.6980.\n\n"
    "Balanis, C.A. Antenna Theory: Analysis and Design, 4th ed.; John Wiley and Sons: Hoboken, 2016."
)
CHUNKS = [
    {"id": "c0", "book_id": "book-1", "user_id": "user-1", "chunk_index": 0, "content": BODY_A},
    {"id": "c1", "book_id": "book-1", "user_id": "user-1", "chunk_index": 1, "content": BODY_B},
    {"id": "c2", "book_id": "book-1", "user_id": "user-1", "chunk_index": 2, "content": REFERENCES},
    {"id": "x0", "book_id": "book-2", "user_id": "user-2", "chunk_index": 0, "content": BODY_A},
]


class Result:
    def __init__(self, data):
        self.data = data


class FakeDb:
    """The two tables the agent touches, with the bank's unique rule."""

    def __init__(self, chunks):
        self.chunks, self.bank, self.upserts = chunks, [], []

    def table(self, name):
        self._table, self._filters = name, []
        return self

    def select(self, columns):
        return self

    def eq(self, column, value):
        self._filters.append(lambda row: row[column] == value)
        return self

    def in_(self, column, values):
        self._filters.append(lambda row: row[column] in values)
        return self

    def upsert(self, rows, on_conflict="", ignore_duplicates=False):
        assert self._table == "question_bank"
        self.upserts.append({"rows": len(rows), "on_conflict": on_conflict, "ignore_duplicates": ignore_duplicates})
        taken = {self._key(row) for row in self.bank}
        self._new = [row for row in rows if self._key(row) not in taken]
        self.bank.extend(self._new)
        return self

    @staticmethod
    def _key(row):
        return row["chunk_id"], row["strategy"], row["prompt_hash"]

    def execute(self):
        if self._table == "chunks":
            return Result([row for row in self.chunks if all(f(row) for f in self._filters)])
        return Result(self._new)


def fake_embed(texts):
    """A fixed pseudo-random unit vector per text: unrelated texts are nearly orthogonal."""
    rows = []
    for item in texts:
        seed = int.from_bytes(hashlib.sha256(item.encode()).digest()[:4], "big")
        vector = np.random.default_rng(seed).normal(size=embedder.EMBEDDING_DIM)
        rows.append(vector / np.linalg.norm(vector))
    return np.array(rows, dtype=np.float32).reshape(len(texts), embedder.EMBEDDING_DIM)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb([dict(row) for row in CHUNKS])
    monkeypatch.setattr(agent_module, "supabase", fake)
    monkeypatch.setattr(embedder, "embed", fake_embed)
    fake.concepts = []  # what the agent hands to the concept store, one list per run
    monkeypatch.setattr(agent_module.concept_store, "save", fake.concepts.append)
    return fake


def test_run_hands_each_chunks_concepts_to_the_concept_store(db):
    QuestionGenerationAgent().run("book-1", ["c0", "c1"])
    (saved,) = db.concepts
    assert [(chunk["id"], chunk["user_id"], chunk["chunk_index"]) for chunk, _ in saved] == [
        ("c0", "user-1", 0), ("c1", "user-1", 1),
    ]
    keys = [{concept.key for concept in concepts} for _, concepts in saved]
    assert "photosynthesis" in keys[0] and "respiration" in keys[1]
    # A cloze question's key term is a stored concept's label.
    labels = {concept.label for _, concepts in saved for concept in concepts}
    assert {row["key_terms"][0] for row in db.bank if row["strategy"] == "cloze"} <= labels


def test_questions_are_stored_even_if_storing_concepts_fails(db, monkeypatch):
    def broken(extracted):
        raise RuntimeError("concepts table is down")

    monkeypatch.setattr(agent_module.concept_store, "save", broken)
    assert QuestionGenerationAgent().run("book-1", ["c0", "c1"]).stored == len(db.bank) > 0


def test_run_stores_grounded_rows_for_the_chunks_asked_for(db):
    report = QuestionGenerationAgent().run("book-1", ["c0", "c1", "c2"])
    assert isinstance(report, GenerationReport)
    content = {row["id"]: row for row in CHUNKS}
    assert {row["chunk_id"] for row in db.bank} == {"c0", "c1"}  # the reference list gives nothing
    for row in db.bank:
        chunk = content[row["chunk_id"]]
        assert (row["book_id"], row["user_id"], row["chunk_index"]) == ("book-1", "user-1", chunk["chunk_index"])
        assert row["type"] in {"factual", "inference", "summary"} and row["strategy"] and row["prompt"]
        assert row["evidence"] and all(
            piece in chunk["content"] for piece in row["evidence"].split(agent_module.EVIDENCE_SEPARATOR)
        )
        assert isinstance(row["key_terms"], list) and isinstance(row["distractors"], list)
        assert 0.0 <= row["quality"] <= 1.0 and 0.0 <= row["difficulty"] <= 1.0
        assert len(row["prompt_hash"]) == 32
        assert "Academic Editor" not in row["evidence"]
        assert set(row) == {
            "user_id", "book_id", "chunk_id", "chunk_index", "type", "prompt", "answer", "evidence",
            "key_terms", "distractors", "difficulty", "strategy", "quality", "prompt_hash",
        }
    strategies_used = {row["strategy"] for row in db.bank}
    assert {"cloze", "definition", "why_how", "main_idea"} <= strategies_used
    # Each body chunk has its summary question, built from body sentences only.
    assert sorted(row["chunk_id"] for row in db.bank if row["strategy"] == "main_idea") == ["c0", "c1"]


def test_report_counts_match_what_was_stored(db):
    report = QuestionGenerationAgent().run("book-1", ["c0", "c1", "c2"])
    assert (report.book_id, report.chunks) == ("book-1", 3)
    assert report.accepted == report.stored == len(db.bank) > 0
    assert report.generated == report.accepted + sum(report.rejected.values())
    assert sum(report.by_type.values()) == sum(report.by_strategy.values()) == report.accepted
    assert report.by_type["summary"] == 2
    assert report.average_quality == pytest.approx(sum(r["quality"] for r in db.bank) / len(db.bank), abs=1e-3)


def test_run_is_idempotent(db):
    first = QuestionGenerationAgent().run("book-1", ["c0", "c1"])
    rows = len(db.bank)
    second = QuestionGenerationAgent().run("book-1", ["c0", "c1"])
    assert len(db.bank) == rows
    assert (second.accepted, second.stored) == (first.accepted, 0)
    assert db.upserts == [
        {"rows": rows, "on_conflict": "chunk_id,strategy,prompt_hash", "ignore_duplicates": True},
    ] * 2


def test_only_the_books_own_chunks_are_processed(db):
    report = QuestionGenerationAgent().run("book-1", ["c0", "x0"])
    assert report.chunks == 1 and {row["chunk_id"] for row in db.bank} == {"c0"}
    empty = QuestionGenerationAgent().run("book-1", [])
    assert (empty.chunks, empty.generated, empty.stored, empty.average_quality) == (0, 0, 0, None)
    nothing = QuestionGenerationAgent().run("book-1", ["c2"])
    assert nothing.stored == 0 and nothing.average_quality is None and len(db.upserts) == 1


def test_questions_per_chunk_are_capped(db, monkeypatch):
    monkeypatch.setattr(policy, "MAX_QUESTIONS_PER_CHUNK", 2)
    report = QuestionGenerationAgent().run("book-1", ["c0", "c1"])
    assert [sum(row["chunk_id"] == chunk for row in db.bank) for chunk in ("c0", "c1")] == [2, 2]
    assert report.rejected["over_cap"] > 0


def test_prompt_hash_ignores_case_and_spacing_only():
    assert agent_module.prompt_hash("What is  chlorophyll?") == agent_module.prompt_hash("what is chlorophyll?")
    assert agent_module.prompt_hash("What is chlorophyll?") != agent_module.prompt_hash("What is chloroplast?")


def test_body_sentences_drop_boilerplate_and_renumber():
    sentences = agent_module.body_sentences(BODY_B)
    assert [s.index for s in sentences] == [0, 1, 2]
    assert sentences[0].text.startswith("Cellular respiration")
    # Only a fragment of an author's name survives; it is too short to be evidence.
    assert [s.text for s in agent_module.body_sentences(REFERENCES)] == ["Balanis, C.A."]


def test_the_agent_uses_no_llm():
    source = inspect.getsource(agent_module)
    assert "llm" not in source and "langchain" not in source
