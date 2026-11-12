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


# --- C9.3: preload at startup, a ready event, and waiting on it ---------------------------------

@pytest.fixture
def fresh(monkeypatch):
    """An embedder with no model, not ready and no preload thread."""
    monkeypatch.setattr(embedder, "_model", None)
    monkeypatch.setattr(embedder, "_ready", threading.Event())
    monkeypatch.setattr(embedder, "_preload_thread", None)
    monkeypatch.setattr(embedder, "_load_error", None)


def test_preload_loads_and_warms_the_model_once_in_the_background(fresh, monkeypatch):
    gate, built = threading.Event(), []

    def slow_load():
        gate.wait(5)
        built.append(FakeModel())
        return built[-1]

    monkeypatch.setattr(embedder, "_load", slow_load)
    first, second = embedder.preload(), embedder.preload()
    assert first is second and first.daemon
    assert embedder.is_ready() is False
    assert embedder.wait_ready(0.05) is False  # the caller is not blocked past its timeout
    gate.set()
    assert embedder.wait_ready(5) is True
    assert len(built) == 1 and len(built[0].calls) == 1  # one warm-up embed


def test_a_failed_preload_is_recorded_and_the_model_stays_not_ready(fresh, monkeypatch):
    def broken():
        raise RuntimeError("model files missing")

    monkeypatch.setattr(embedder, "_load", broken)
    embedder.preload().join(5)
    assert embedder.is_ready() is False
    assert "model files missing" in embedder.load_error()


def test_a_lazy_first_use_also_marks_the_model_ready(fresh, monkeypatch):
    monkeypatch.setattr(embedder, "_load", FakeModel)
    embedder.embed(["one"])
    assert embedder.is_ready() is True


def test_preload_is_on_unless_embed_preload_is_0(monkeypatch):
    monkeypatch.delenv("EMBED_PRELOAD", raising=False)
    assert embedder.preload_enabled() is True
    monkeypatch.setenv("EMBED_PRELOAD", "0")
    assert embedder.preload_enabled() is False


def test_ensure_loading_does_not_wait_for_a_load_in_progress(fresh, monkeypatch):
    """Regression (DEBUG_LOG C9.3): a grade during the startup load must not block on the load's lock."""
    import time

    gate = threading.Event()

    def slow_load():
        gate.wait(5)
        return FakeModel()

    monkeypatch.setattr(embedder, "_load", slow_load)
    embedder.preload()
    time.sleep(0.05)  # the preload thread now holds the load
    began = time.perf_counter()
    embedder.ensure_loading()
    waited = time.perf_counter() - began
    gate.set()
    assert waited < 0.5
    assert embedder.wait_ready(5)


def test_ensure_loading_retries_after_a_failed_preload(fresh, monkeypatch):
    """Regression (DEBUG_LOG C9.3): a failed preload left the model unloaded until a restart."""
    attempts = []

    def flaky_load():
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("download interrupted")
        return FakeModel()

    monkeypatch.setattr(embedder, "_load", flaky_load)
    embedder.preload().join(5)
    assert not embedder.is_ready() and "download interrupted" in embedder.load_error()
    embedder.ensure_loading()
    assert embedder.wait_ready(5) and len(attempts) == 2
