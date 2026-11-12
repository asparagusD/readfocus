"""backend.nlp.concepts: phrase normalisation, near-duplicate merging, stable keys.

No test loads the embedding model: merging by embedding is tested with
hand-made vectors, and extract_concepts runs with use_embeddings=False or
with a fake embed function.
"""

import numpy as np
import pytest

from backend.nlp import concepts

PASSAGE = (
    "Photosynthesis is the process by which green plants convert light energy into chemical energy. "
    "Chlorophyll molecules inside the chloroplasts absorb light energy from the sun. "
    "The chloroplast uses that energy to turn carbon dioxide and water into glucose. "
    "Photosynthesis releases oxygen, and the glucose feeds the plant. "
    "Without chlorophyll, plants could not capture light energy at all."
)


@pytest.mark.parametrize("word,expected", [
    ("networks", "network"), ("studies", "study"), ("classes", "class"), ("boxes", "box"),
    ("branches", "branch"), ("analysis", "analysis"), ("class", "class"), ("virus", "virus"),
    ("series", "series"), ("gas", "gas"), ("energy", "energy"), ("plants", "plant"),
    ("sizes", "size"), ("phases", "phase"),
])
def test_lemma_is_light_and_safe(word, expected):
    assert concepts.lemma(word) == expected


@pytest.mark.parametrize("phrase,expected", [
    ("The Neural Networks", "neural network"),
    ("a learning rate", "learning rate"),
    ("these chemical reactions", "chemical reaction"),
    ("Light Energy", "light energy"),
    ("the", ""),
    ("of the", ""),
])
def test_normalize_phrase(phrase, expected):
    assert concepts.normalize_phrase(phrase) == expected


def test_concept_key_is_a_stable_slug():
    assert concepts.concept_key("neural network") == "neural-network"
    assert concepts.concept_key("Carbon  dioxide (CO2)") == "carbon-dioxide-co2"
    assert concepts.concept_key(concepts.normalize_phrase("The Neural Networks")) == "neural-network"


def test_merge_joins_identical_phrases_after_normalising():
    merged = concepts.merge([("neural network", 0.9), ("neural network", 0.4)])
    assert [(c.label, c.weight) for c in merged] == [("neural network", 0.9)]


def test_merge_joins_fuzzy_near_duplicates_and_keeps_the_stronger_label():
    merged = concepts.merge([("optimization algorithm", 0.8), ("optimisation algorithm", 0.6), ("gradient", 0.5)])
    assert [c.label for c in merged] == ["optimization algorithm", "gradient"]
    assert merged[0].aliases == ["optimisation algorithm"]
    assert merged[0].weight == 0.8


def test_merge_keeps_phrases_that_only_share_a_word():
    merged = concepts.merge([("neural network", 0.9), ("social network", 0.8), ("network", 0.7)])
    assert [c.label for c in merged] == ["neural network", "social network", "network"]


def test_merge_joins_overlapping_ngrams_under_the_shortest_phrase():
    merged = concepts.merge([
        ("convert light energy", 1.0), ("light energy", 0.9), ("convert light", 0.8),
        ("absorb light energy", 0.7), ("chemical energy", 0.6), ("energy", 0.5),
    ])
    assert [(c.key, c.weight) for c in merged] == [
        ("light-energy", 1.0), ("chemical-energy", 0.6), ("energy", 0.5),
    ]
    assert merged[0].aliases == ["convert light energy", "convert light", "absorb light energy"]


def test_merge_joins_phrases_whose_embeddings_are_close():
    vectors = np.array([[1.0, 0.0], [0.9, 0.436], [0.0, 1.0]])  # cosine 0.90 and 0.0 with the first
    merged = concepts.merge([("car", 0.9), ("automobile", 0.7), ("river", 0.5)], vectors)
    assert [c.label for c in merged] == ["car", "river"]
    assert merged[0].aliases == ["automobile"]


def test_merge_does_not_join_below_the_cosine_threshold():
    vectors = np.array([[1.0, 0.0], [0.8, 0.6]])  # cosine 0.80
    merged = concepts.merge([("car", 0.9), ("bicycle", 0.7)], vectors)
    assert [c.label for c in merged] == ["car", "bicycle"]


def test_extract_concepts_finds_the_topic_without_duplicates():
    found = concepts.extract_concepts(PASSAGE, top_k=8, use_embeddings=False)
    keys = [c.key for c in found]
    assert len(keys) == len(set(keys))
    assert "light-energy" in keys
    assert {"photosynthesis", "chlorophyll"} & set(keys)
    assert "chloroplast" not in keys or "chloroplasts" not in keys
    assert all(0.0 < c.weight <= 1.0 for c in found)
    assert [c.weight for c in found] == sorted((c.weight for c in found), reverse=True)
    assert found[0].weight == 1.0


def test_extract_concepts_respects_top_k_and_is_deterministic():
    first = concepts.extract_concepts(PASSAGE, top_k=3, use_embeddings=False)
    assert len(first) == 3
    assert first == concepts.extract_concepts(PASSAGE, top_k=3, use_embeddings=False)


def test_extract_concepts_of_nothing_is_empty():
    assert concepts.extract_concepts("", use_embeddings=False) == []
    assert concepts.extract_concepts("   \n", use_embeddings=False) == []


def test_extract_concepts_uses_the_embedder_when_asked(monkeypatch):
    seen = []

    def fake_embed(texts):
        seen.append(list(texts))
        return np.eye(len(texts), dtype=np.float32)  # nothing is close to anything

    monkeypatch.setattr(concepts.embedder, "embed", fake_embed)
    found = concepts.extract_concepts(PASSAGE, top_k=5)
    assert len(seen) == 1 and len(seen[0]) >= len(found)
    assert len(found) == 5
