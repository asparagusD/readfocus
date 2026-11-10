"""backend.nlp.embedder: lazy singleton, batching, unit-length vectors.

The unit tests swap the fastembed model for a fake, so they need neither
the model files nor the network. The last test uses the real model and is
skipped when it is not in the local cache (it never downloads: the offline
guard in conftest.py blocks that).
"""

import threading
from pathlib import Path

import numpy as np
import pytest

from backend.nlp import embedder

REAL_CACHE = Path(__file__).resolve().parents[2] / ".cache" / "fastembed"


class FakeModel:
    """Returns un-normalised vectors that depend only on the text length."""

    def __init__(self):
        self.calls = []

    def embed(self, documents, batch_size=256, **kwargs):
        self.calls.append((list(documents), batch_size))
        for text in documents:
            yield np.full(embedder.EMBEDDING_DIM, float(len(text) + 1), dtype=np.float64)


@pytest.fixture
def fake_model(monkeypatch):
    """Make the embedder build a FakeModel; yields the list of built models."""
    built = []

    def load():
        built.append(FakeModel())
        return built[-1]

    monkeypatch.setattr(embedder, "_model", None)
    monkeypatch.setattr(embedder, "_load", load)
    return built


def test_embed_returns_one_unit_row_per_text(fake_model):
    vectors = embedder.embed(["one", "two words", "three more words"])
    assert vectors.shape == (3, embedder.EMBEDDING_DIM)
    assert vectors.dtype == np.float32
    assert np.allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=1e-5)


def test_embed_passes_the_texts_in_order_with_the_batch_size(fake_model):
    embedder.embed(["a", "b", "c"])
    assert fake_model[0].calls == [(["a", "b", "c"], embedder.BATCH_SIZE)]


def test_embed_of_nothing_is_empty_and_does_not_load_the_model(fake_model):
    vectors = embedder.embed([])
    assert vectors.shape == (0, embedder.EMBEDDING_DIM)
    assert fake_model == []


def test_embed_one_returns_a_single_unit_vector(fake_model):
    vector = embedder.embed_one("hello")
    assert vector.shape == (embedder.EMBEDDING_DIM,)
    assert np.isclose(np.linalg.norm(vector), 1.0, atol=1e-5)


def test_a_zero_vector_stays_zero_instead_of_becoming_nan(fake_model, monkeypatch):
    embedder.get_model()
    monkeypatch.setattr(
        fake_model[0], "embed", lambda docs, **kw: iter([np.zeros(embedder.EMBEDDING_DIM)])
    )
    assert not np.isnan(embedder.embed_one("x")).any()


def test_the_model_is_built_once_across_threads(fake_model):
    barrier = threading.Barrier(8)

    def work():
        barrier.wait()
        embedder.embed(["x"])

    threads = [threading.Thread(target=work) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(fake_model) == 1


def test_importing_the_module_does_not_load_the_model():
    import importlib

    module = importlib.reload(embedder)
    assert module._model is None


def test_cache_dir_and_threads_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("FASTEMBED_CACHE", "/models/fastembed")
    monkeypatch.setenv("EMBED_THREADS", "2")
    assert embedder.cache_dir() == "/models/fastembed"
    assert embedder.thread_count() == 2
    monkeypatch.delenv("FASTEMBED_CACHE")
    monkeypatch.delenv("EMBED_THREADS")
    assert embedder.cache_dir() == embedder.DEFAULT_CACHE
    assert embedder.thread_count() == 1


@pytest.mark.skipif(
    not any(REAL_CACHE.glob("*all-MiniLM-L6-v2*/**/*.onnx")),
    reason="all-MiniLM-L6-v2 is not in .cache/fastembed",
)
def test_similar_sentences_score_higher_than_unrelated_ones(monkeypatch):
    monkeypatch.setenv("FASTEMBED_CACHE", str(REAL_CACHE))
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setattr(embedder, "_model", None)
    cat, kitten, tax = embedder.embed([
        "The cat slept on the warm windowsill all afternoon.",
        "A kitten was napping in the sunny window for hours.",
        "Corporate tax returns are due at the end of the fiscal quarter.",
    ])
    assert cat.shape == (embedder.EMBEDDING_DIM,)
    assert np.isclose(np.linalg.norm(cat), 1.0, atol=1e-4)
    assert float(cat @ kitten) > float(cat @ tax) + 0.1
