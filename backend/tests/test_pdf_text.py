"""PDF text read a few pages per reader, and memory handed back (C18.G memory fix). No network."""

import gc
import io
from pathlib import Path

import pytest
from pypdf import PdfReader

from backend.services import book_ingestor, book_structure, pdf_text

SAMPLE = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures" / "books" / "sample.pdf"


def one_reader(data: bytes) -> list[str]:
    return [(page.extract_text() or "") for page in PdfReader(io.BytesIO(data)).pages]


def test_batched_text_equals_one_reader_for_every_page():
    data = SAMPLE.read_bytes()
    assert pdf_text.page_texts(data, per_reader=2) == one_reader(data)
    assert pdf_text.page_texts(data) == one_reader(data)


def test_ingestion_text_is_unchanged():
    data = SAMPLE.read_bytes()
    expected = [text.replace("\x00", "") for text in one_reader(data) if text]
    assert book_ingestor.extract_text_from_pdf(data) == expected


def test_structure_reads_page_starts_through_the_batched_reader(monkeypatch):
    data = SAMPLE.read_bytes()
    chunks = book_ingestor.chunk_text(book_ingestor.extract_text_from_pdf(data), 600)
    expected = book_structure.build_with_paths("pdf", data, chunks)
    calls = []
    real = pdf_text.page_texts
    monkeypatch.setattr(pdf_text, "page_texts", lambda data, **kw: calls.append(1) or real(data, **kw))
    assert book_structure.build_with_paths("pdf", data, chunks) == expected
    assert calls == [1]


FIXTURES = [SAMPLE, SAMPLE.with_name("scanned.pdf"), Path(__file__).resolve().parent / "fixtures" / "code_sample.pdf"]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_one_text_pass_builds_the_same_structure_as_two(path, monkeypatch):
    """C26.2: the page texts ingestion read give the same blocks, contents and paths as a second pass."""
    data = path.read_bytes()
    every_page: list[str] = []
    chunks = book_ingestor.chunk_text(book_ingestor.extract_text_from_pdf(data, every_page=every_page), 600)
    two_passes = book_structure.build_with_paths("pdf", data, chunks)

    def no_second_pass(*args, **kwargs):
        raise AssertionError("the pages were read again")
    monkeypatch.setattr(pdf_text, "page_texts", no_second_pass)
    assert book_structure.build_with_paths("pdf", data, chunks, every_page) == two_passes
    if path == SAMPLE:  # its outline is the part that used the page texts
        assert len(two_passes[1]) == 2 and all("page" in entry for entry in two_passes[1])


def test_every_page_keeps_the_empty_pages_the_chunks_leave_out():
    data = SAMPLE.read_bytes()
    every_page: list[str] = []
    kept = book_ingestor.extract_text_from_pdf(data, every_page=every_page)
    assert every_page == [text.replace("\x00", "") for text in one_reader(data)]
    assert kept == [text for text in every_page if text]


def test_release_memory_never_raises():
    pdf_text.release_memory()


def test_freeze_startup_heap_keeps_the_loaded_heap_out_of_collections():
    gc.unfreeze()
    heap = [[n] for n in range(100_000)]
    try:
        pdf_text.freeze_startup_heap()
        assert gc.get_freeze_count() >= len(heap)
        assert not any(o is heap for o in gc.get_objects())  # a full collection no longer walks it
    finally:
        gc.unfreeze()
