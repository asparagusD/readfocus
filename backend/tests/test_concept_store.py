"""concept_store on an in-memory concepts table: merging, upserting and linking key terms. No model, no network."""

from types import SimpleNamespace

import pytest

from backend.nlp.concepts import Concept
from backend.services import concept_store

USER, BOOK = "user-1", "book-1"


def chunk(index, book=BOOK):
    return {"id": f"c{index}", "user_id": USER, "book_id": book, "chunk_index": index}


def concept(label, weight=1.0):
    return Concept(key=label.replace(" ", "-"), label=label, weight=weight)


class FakeTable:
    """The concepts table with its unique (user_id, book_id, concept_key) rule."""

    def __init__(self):
        self.rows, self.upserts, self.overlap = [], [], None

    def table(self, name):
        assert name == "concepts"
        self._filters, self._pending = [], None
        return self

    def select(self, columns):
        return self

    def eq(self, column, value):
        self._filters.append(lambda row: row[column] == value)
        return self

    def in_(self, column, values):
        self._filters.append(lambda row: row[column] in values)
        return self

    def overlaps(self, column, values):
        self.overlap = (column, list(values))
        self._filters.append(lambda row: set(row[column]) & set(values))
        return self

    def upsert(self, rows, on_conflict=""):
        self.upserts.append({"rows": len(rows), "on_conflict": on_conflict})
        self._pending = rows
        return self

    def execute(self):
        if self._pending is None:
            return SimpleNamespace(data=[dict(row) for row in self.rows if all(f(row) for f in self._filters)])
        for new in self._pending:
            same = [r for r in self.rows if all(r[k] == new[k] for k in ("user_id", "book_id", "concept_key"))]
            same[0].update(new) if same else self.rows.append(dict(new))
        return SimpleNamespace(data=self._pending)


@pytest.fixture
def db(monkeypatch):
    fake = FakeTable()
    monkeypatch.setattr(concept_store, "supabase", fake)
    return fake


def by_key(db):
    return {row["concept_key"]: row for row in db.rows}


def test_save_stores_one_row_per_concept_of_the_book(db):
    stored = concept_store.save([
        (chunk(0), [concept("light energy", 1.0), concept("chlorophyll", 0.6)]),
        (chunk(1), [concept("chlorophyll", 0.9), concept("sugar", 0.4)]),
    ])
    assert stored == 3 and len(db.rows) == 3
    assert by_key(db)["chlorophyll"] == {
        "user_id": USER, "book_id": BOOK, "concept_key": "chlorophyll", "label": "chlorophyll",
        "chunk_indices": [0, 1], "weight": 0.9,
    }
    assert by_key(db)["light-energy"]["chunk_indices"] == [0] and by_key(db)["sugar"]["chunk_indices"] == [1]
    assert db.upserts == [{"rows": 3, "on_conflict": "user_id,book_id,concept_key"}]


def test_a_later_batch_adds_its_chunks_and_keeps_the_first_label(db):
    concept_store.save([(chunk(0), [concept("light energy", 0.5)])])
    relabelled = Concept(key="light-energy", label="energy of light", weight=0.8)
    assert concept_store.save([(chunk(7), [relabelled]), (chunk(3), [concept("sugar")])]) == 2
    row = by_key(db)["light-energy"]
    assert (row["label"], row["chunk_indices"], row["weight"]) == ("light energy", [0, 7], 0.8)
    assert len(db.rows) == 2


def test_saving_the_same_chunks_again_writes_nothing(db):
    batch = [(chunk(0), [concept("light energy"), concept("sugar", 0.3)])]
    concept_store.save(batch)
    assert concept_store.save(batch) == 0
    assert len(db.upserts) == 1 and len(db.rows) == 2


def test_chunks_without_concepts_and_empty_keys_write_nothing(db):
    assert concept_store.save([]) == 0
    assert concept_store.save([(chunk(0), []), (chunk(1), [Concept(key="", label="?", weight=1.0)])]) == 0
    assert db.rows == [] and db.upserts == []


def test_another_books_concepts_are_left_alone(db):
    concept_store.save([(chunk(0, "book-2"), [concept("sugar", 0.2)])])
    concept_store.save([(chunk(4), [concept("sugar", 0.7)])])
    assert sorted((r["book_id"], r["chunk_indices"], r["weight"]) for r in db.rows) == [
        ("book-1", [4], 0.7), ("book-2", [0], 0.2),
    ]


def test_concepts_for_chunks_reads_the_readers_concepts_that_mention_them(db):
    concept_store.save([(chunk(0), [concept("sugar", 0.2)]), (chunk(5), [concept("light energy")])])
    found = concept_store.concepts_for_chunks(USER, BOOK, [5, 6])
    assert [row["concept_key"] for row in found] == ["light-energy"]
    assert db.overlap == ("chunk_indices", [5, 6])
    assert concept_store.concepts_for_chunks(USER, BOOK, []) == []


CONCEPTS = [
    {"concept_key": "light-energy", "label": "light energy", "weight": 1.0},
    {"concept_key": "chlorophyll", "label": "chlorophyll", "weight": 0.8},
    {"concept_key": "chemical-energy", "label": "chemical energy", "weight": 0.5},
    {"concept_key": "deep-foundation", "label": "deep foundation", "weight": 0.4},
]


@pytest.mark.parametrize(("key_terms", "expected"), [
    (["chlorophyll"], ["chlorophyll"]),                        # the label itself
    (["Light Energy"], ["light-energy"]),                      # case
    (["the deep foundations"], ["deep-foundation"]),           # determiner and plural
    (["energy"], ["light-energy", "chemical-energy"]),         # a word of the label, strongest first
    (["energies", "chlorophyll"], ["light-energy", "chlorophyll", "chemical-energy"]),
    (["chlorophyll", "chlorophyll"], ["chlorophyll"]),         # no key twice
    (["gravel"], []),                                          # no such concept
    (["light"], ["light-energy"]),
    (["lighting energy"], []),                                 # every word must be in the label
    ([], []), (["the"], []), (["?"], []),
])
def test_link_key_terms(key_terms, expected):
    assert concept_store.link_key_terms(key_terms, CONCEPTS) == expected


def test_link_key_terms_keeps_the_order_of_the_concepts_given():
    assert concept_store.link_key_terms(["energy"], CONCEPTS[::-1]) == ["chemical-energy", "light-energy"]
