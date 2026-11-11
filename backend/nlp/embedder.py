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
# Set once the model is loaded (by the startup preload or by a first use).
# Requests that need the model wait on it; /health reports it.
_ready = threading.Event()
_preload_thread = None
_load_error = None


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
                _ready.set()
    return _model


def preload_enabled() -> bool:
    """Load the model at startup unless EMBED_PRELOAD=0 (the test suite sets it)."""
    return os.getenv("EMBED_PRELOAD", "1") != "0"


def _warm() -> None:
    global _load_error
    try:
        get_model()
        embed(["warm up"])  # the first call also initialises the ONNX session
    except Exception as error:  # noqa: BLE001 - grading falls back without the model; requests get a 503
        _load_error = f"{type(error).__name__}: {error}"
        print(f"Embedding model preload failed: {_load_error}")


def preload() -> threading.Thread:
    """Load and warm the model on a daemon thread, once; returns that thread."""
    global _preload_thread
    with _lock:
        if _preload_thread is None:
            _preload_thread = threading.Thread(target=_warm, name="embedder-preload", daemon=True)
            _preload_thread.start()
    return _preload_thread


def ensure_loading() -> None:
    """Start a background load if the model is neither loaded nor loading."""
    if not _ready.is_set():
        preload()


def is_ready() -> bool:
    return _ready.is_set()


def wait_ready(timeout: float) -> bool:
    """Block up to `timeout` seconds for the model; True if it is loaded."""
    return _ready.wait(timeout)


def load_error() -> str | None:
    return _load_error


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
