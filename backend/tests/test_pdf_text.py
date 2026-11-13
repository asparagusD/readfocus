"""PDF text read a few pages per reader, and memory handed back (C18.G memory fix). No network."""

import io
from pathlib import Path

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


def test_release_memory_never_raises():
    pdf_text.release_memory()
