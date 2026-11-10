"""Local text embeddings with fastembed. No API calls, $0.

One sentence-transformers/all-MiniLM-L6-v2 model (ONNX, 384 dimensions) per
process, loaded on first use and never per request. The model files live in
the directory named by FASTEMBED_CACHE, so a Docker image can ship them and
start without a download. Chosen over BAAI/bge-small-en-v1.5 at Gate G2
(docs/BENCHMARKS.md): five times faster on chunk-sized texts.

Texts longer than the model's 256-token window (about 190 words) are
truncated by the model, so a 600-word chunk is represented by its opening.
`embed` runs the model on the calling thread; call it through
`asyncio.to_thread` from async code.
"""

import os
import threading

import numpy as np

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384
# Measured in C4.1 (docs/BENCHMARKS.md, on bge-small). Texts per model call:
# 32 chunk-sized texts in one call needed about 1.2 GB; 4 kept the process
# near 350 MB and were faster. Threads: on a 0.1-CPU container one thread is ten times
# faster than the runtime's default of one per core.
BATCH_SIZE = 4
DEFAULT_THREADS = 1
DEFAULT_CACHE = ".cache/fastembed"

_model = None
_lock = threading.Lock()


def cache_dir() -> str:
    """Where the model files are kept: FASTEMBED_CACHE, or the repo default."""
    return os.getenv("FASTEMBED_CACHE") or DEFAULT_CACHE


def thread_count() -> int:
    """ONNX Runtime threads: EMBED_THREADS, or one."""
    return int(os.getenv("EMBED_THREADS") or DEFAULT_THREADS)


def _load():
    # Imported here so that importing this module stays cheap: fastembed and
    # onnxruntime are only paid for by a process that embeds.
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=MODEL_NAME, cache_dir=cache_dir(), threads=thread_count())


def get_model():
    """The process-wide model, built once even when threads race for it."""
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _model = _load()
    return _model


def embed(texts: list[str]) -> np.ndarray:
    """Embed texts in batches: float32 array (len(texts), 384), unit-length rows."""
    if not texts:
        return np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
    rows = list(get_model().embed(texts, batch_size=BATCH_SIZE))
    vectors = np.asarray(rows, dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norms == 0, 1.0, norms)


def embed_one(text: str) -> np.ndarray:
    """Embed one text: float32 array (384,), unit length."""
    return embed([text])[0]
