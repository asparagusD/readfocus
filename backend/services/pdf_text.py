"""A PDF's page text with bounded memory, and freed memory handed back (C18.G).

pypdf keeps every object it has parsed for as long as its reader lives: one
reader over all 769 pages of a 52 MB book grows by about 200 MB in the
512 MB container, and the pipeline used to parse the whole file three times.
page_texts opens a fresh reader every PAGES_PER_READER pages instead: the
same text for every page (checked on the shelf), at about a quarter of the
memory (docs/DEBUG_LOG.md, C18.G).

release_memory: on Linux glibc keeps freed memory in the process, so each
phase of a job started from the last one's peak; a garbage collection and
malloc_trim(0) after a heavy phase return it. Elsewhere it only collects.
"""

import ctypes
import ctypes.util
import gc
import io

PAGES_PER_READER = 50


def page_texts(file_bytes: bytes, per_reader: int = PAGES_PER_READER) -> list[str]:
    """pypdf's text of every page, in order, "" for a page with none (NUL characters kept, as pypdf gives them)."""
    from pypdf import PdfReader

    total = len(PdfReader(io.BytesIO(file_bytes)).pages)
    texts: list[str] = []
    for first in range(0, total, per_reader):
        reader = PdfReader(io.BytesIO(file_bytes))
        texts += [(reader.pages[n].extract_text() or "") for n in range(first, min(first + per_reader, total))]
        del reader
    return texts


def release_memory() -> None:
    """Collect garbage and hand freed heap back to the system where the C library allows it. Never raises."""
    gc.collect()
    try:
        name = ctypes.util.find_library("c")
        libc = ctypes.CDLL(name) if name else None
        if libc is not None and hasattr(libc, "malloc_trim"):
            libc.malloc_trim(0)
    except Exception:  # noqa: BLE001, S110 - only an optimisation
        pass
