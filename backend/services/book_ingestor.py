import asyncio
import hashlib
import io
import os
import re
import tempfile
import zipfile
from collections.abc import Callable
from xml.etree import ElementTree
from pypdf import PdfReader
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from backend.agents import policy
from backend.nlp import embedder
from backend.regions.prose import pdf_page_anchors
from backend.services import (book_structure, covers, make_way, ocr_pages, pdf_text, processing_jobs,
                              reader_questions, region_job)
from backend.services.book_purge import DELETING
from backend.services.supabase_client import supabase

# Chunks embedded and stored together; the job's cursor is saved after each batch. The first batch is smaller
# so the book unlocks as soon as five chunks are stored. C36.1 (issue 27): ingestion makes no questions; they
# follow the reader (services/reader_questions.py).
BROWSER_TEXT = "browser-text"  # C26.7: books.source_format of a book whose text came from the reader's browser
FIRST_BATCH = 5
INGEST_BATCH = 16
TARGET_WORDS = 600

def extract_text_from_pdf(file_bytes: bytes, ocr: Callable[[], dict[int, str]] | None = None,
                          scanned: list[int] | None = None, every_page: list[str] | None = None) -> list[str]:
    """Extract text from a PDF file, returning a list of page strings (pages with no text left out).
    A few pages per reader since C18.G (pdf_text.page_texts): the same text at a quarter of the memory.
    C19.4: `scanned`, when given, collects the numbers of the pages whose text layer has fewer than
    OCR_MIN_PAGE_CHARS visible characters. When every page is such a page (a fully scanned book), its
    stray marks (page numbers, a scanner's stamp) are not its text: `ocr()` ({page: text}) is, and is
    asked for only then. A book with text of its own never takes OCR text, so its chunks are the same
    on every run (C18; DEBUG_LOG 2026-11-13 C19.4). C26.2: `every_page`, when given, collects every
    page's text, empty ones included, for the outline (book_structure.pdf_contents), so the book is
    read once."""
    texts = [text.replace('\x00', '') for text in pdf_text.page_texts(file_bytes)]
    if every_page is not None:
        every_page.extend(texts)
    marks = [n for n, text in enumerate(texts, start=1) if len("".join(text.split())) < policy.OCR_MIN_PAGE_CHARS]
    if scanned is not None:
        scanned.extend(marks)
    if ocr is not None and texts and len(marks) == len(texts):
        found = ocr()
        return [found[n] for n in range(1, len(texts) + 1) if found.get(n)]
    return [text for text in texts if text]

def extract_text_from_epub(file_bytes: bytes) -> list[str]:
    """Extract text from an EPUB file, returning a list of chapter strings."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".epub") as temp_file:
        temp_file.write(file_bytes)
        temp_file_path = temp_file.name

    try:
        book = epub.read_epub(temp_file_path)
        chapters = []
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_DOCUMENT:
                soup = BeautifulSoup(item.get_body_content(), 'html.parser')
                text = soup.get_text(separator='\n\n', strip=True)
                if text:
                    text = text.replace('\x00', '')
                    chapters.append(text)
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    return chapters

def chunk_text(pages: list[str], target_words: int = 600) -> list[str]:
    """
    Take a flat list of strings, split on paragraph boundaries, and accumulate 
    until target_words is reached to create chunks (typically 400-900 words).
    """
    full_text = "\n\n".join(pages)
    
    # Split on paragraph boundaries (double newlines)
    paragraphs = re.split(r'\n\s*\n', full_text)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    chunks = []
    current_chunk_paragraphs = []
    current_word_count = 0

    def word_count(text: str) -> int:
        return len(text.split())

    def split_long_paragraph(paragraph: str) -> list[str]:
        # Split at sentence boundaries
        sentences = re.split(r'(?<=[.!?])\s+', paragraph)
        sub_chunks = []
        current_sub_chunk = []
        current_sub_words = 0
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            words = word_count(sentence)
            if current_sub_words + words > target_words and current_sub_chunk:
                sub_chunks.append(" ".join(current_sub_chunk))
                current_sub_chunk = [sentence]
                current_sub_words = words
            else:
                current_sub_chunk.append(sentence)
                current_sub_words += words
                
        if current_sub_chunk:
            sub_chunks.append(" ".join(current_sub_chunk))
        return sub_chunks

    for p in paragraphs:
        p_words = word_count(p)
        
        # If a single paragraph exceeds 900 words, split it
        if p_words > 900:
            if current_chunk_paragraphs:
                chunks.append("\n\n".join(current_chunk_paragraphs))
                current_chunk_paragraphs = []
                current_word_count = 0
                
            sub_chunks = split_long_paragraph(p)
            chunks.extend(sub_chunks[:-1])
            if sub_chunks:
                current_chunk_paragraphs = [sub_chunks[-1]]
                current_word_count = word_count(sub_chunks[-1])
            continue
            
        # Accumulate until target_words or if adding exceeds 900 words
        if current_word_count >= target_words or (current_word_count + p_words > 900 and current_word_count > 0):
            chunks.append("\n\n".join(current_chunk_paragraphs))
            current_chunk_paragraphs = [p]
            current_word_count = p_words
        else:
            current_chunk_paragraphs.append(p)
            current_word_count += p_words

    if current_chunk_paragraphs:
        chunks.append("\n\n".join(current_chunk_paragraphs))

    return chunks

def batches(total: int, cursor: int = 0):
    """(start, end) chunk ranges from the cursor: five first, then INGEST_BATCH at a time."""
    start = cursor
    while start < total:
        end = min(start + (FIRST_BATCH if start == 0 else INGEST_BATCH), total)
        yield start, end
        start = end


def _epub_metadata(file_bytes: bytes) -> tuple[str | None, str | None]:
    """dc:title and the first dc:creator from the EPUB's OPF package file."""
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
        container = ElementTree.fromstring(archive.read("META-INF/container.xml"))
        rootfile = container.find(".//{*}rootfile")
        package = ElementTree.fromstring(archive.read(rootfile.get("full-path")))
    title = package.find(".//{http://purl.org/dc/elements/1.1/}title")
    creator = package.find(".//{http://purl.org/dc/elements/1.1/}creator")
    return (title.text if title is not None else None), (creator.text if creator is not None else None)


def extract_metadata(file_type: str, file_bytes: bytes) -> tuple[str | None, str | None]:
    """The title and author the file itself carries (PDF info, EPUB OPF), or None; never raises."""
    try:
        if file_type.lower() == "pdf":
            info = PdfReader(io.BytesIO(file_bytes)).metadata
            return (info.title or None, info.author or None) if info else (None, None)
        if file_type.lower() == "epub":
            return _epub_metadata(file_bytes)
    except Exception as e:  # noqa: BLE001 - metadata only feeds the optional cover lookup
        print(f"No metadata read from the {file_type} file: {e}")
    return None, None


def look_up_cover(book: dict, file_bytes: bytes) -> None:
    """Find the book's cover once it is ingested (C11.2); a failure never touches the job."""
    if book.get("cover_source"):  # already looked up (a resumed job, or the backfill)
        return
    try:
        meta = extract_metadata(book["file_type"], file_bytes) if file_bytes else (None, None)  # C26.7: no file
        title, author = covers.lookup_terms(*meta,
                                            book.get("title"), book.get("author"))
        covers.ensure_cover(book["id"], title, author)
    except Exception as e:  # noqa: BLE001
        print(f"Cover lookup for book {book['id']} failed: {e}")


def extract(file_type: str, file_bytes: bytes) -> list[str]:
    if file_type.lower() == "pdf":
        return extract_text_from_pdf(file_bytes)
    if file_type.lower() == "epub":
        return extract_text_from_epub(file_bytes)
    raise ValueError("Unsupported file type. Must be 'pdf' or 'epub'.")


def mark_ready(book_id: str, total: int, words: int, toc: list | None = None) -> None:
    values = {"total_chunks": total, "total_words": words, "status": "ready"}
    if toc is not None:  # the contents are known before the first batch, so the reader has them at once
        values["toc"] = toc
    # C35.2b: never over a book being deleted, which the purge would then keep (book_purge.purge checks the status)
    supabase.table("books").update(values).eq("id", book_id).neq("status", DELETING).execute()


def download(storage_path: str) -> bytes:
    return supabase.storage.from_("books").download(storage_path)


def _load_book(book_id: str) -> dict:
    return supabase.table("books").select(
        "id, file_type, storage_path, status, title, author, cover_source, source_format, file_sha256").eq(
        "id", book_id).execute().data[0]


AUTHOR_MAX = 300  # as POST /books/upload (C30.1)


def file_facts(book: dict, file_bytes: bytes) -> dict:
    """C35.3a (issue 16): a book sent straight to Storage arrives with no hash, page count or author; they are
    worked out here, off the request. The author only when the reader typed none (C30.1)."""
    facts: dict = {"file_sha256": hashlib.sha256(file_bytes).hexdigest()}
    if book.get("file_type") == "pdf":
        try:
            facts["page_count"] = len(PdfReader(io.BytesIO(file_bytes)).pages)
        except Exception as error:  # noqa: BLE001 - optional; the parse below reports an unreadable file
            print(f"Page count of book {book.get('id')} not read: {error}")
    if not book.get("author"):
        author = " ".join((extract_metadata(book.get("file_type") or "", file_bytes)[1] or "").split())[:AUTHOR_MAX]
        if author:
            facts["author"] = author
    return facts


def record_file_facts(book: dict, file_bytes: bytes) -> dict:
    facts = file_facts(book, file_bytes)
    supabase.table("books").update(facts).eq("id", book["id"]).neq("status", DELETING).execute()
    return {**book, **facts}


def numbered(texts: dict[int, str], count: int = 0) -> list[str]:
    """Pages 1..N as a list, a page with no text as "" (N: the last page with text, or `count` if larger)."""
    return [texts.get(n, "") for n in range(1, max([count, *texts]) + 1)] if texts or count else []


def read_pages(book: dict, file_bytes: bytes, browser: bool) -> tuple[list[str], dict[int, str], list[str] | None]:
    """The book's page (or chapter) texts, the OCR texts it was read from ({} unless fully scanned) and, for a PDF,
    every page's text for the outline (C26.2). Blocking: run_job calls it in a thread (C29.1). C36.G: a browser-text
    book's ocr is its pages' texts by number, so its chunks get their pages too (page_anchors)."""
    book_id, ocr = book["id"], {}
    if browser:  # the pages in order; an empty page is left out, as pypdf's are
        texts = ocr_pages.load_texts(book_id)
        return [texts[n] for n in sorted(texts)], texts, None
    if book["file_type"].lower() != "pdf":
        return extract(book["file_type"], file_bytes), ocr, None
    scanned: list[int] = []  # C19.4: scanned pages flagged; a fully scanned book read from OCR

    def load_ocr() -> dict[int, str]:
        ocr.update(ocr_pages.load_texts(book_id))
        return ocr
    every_page: list[str] = []
    pages = extract_text_from_pdf(file_bytes, load_ocr, scanned, every_page)
    if scanned:
        ocr_pages.record_scanned(book_id, scanned)
    return pages, ocr, every_page


def store_batch(book_id: str, user_id: str, start: int, batch: list[str], vectors, blocks, paths,
                anchors: list[dict] | None = None) -> list[dict]:
    """Upsert one batch of chunks with their vectors, blocks, paths and (C36.1, a PDF) page anchors; the rows."""
    rows = [{"book_id": book_id, "user_id": user_id, "chunk_index": start + offset,
             "word_count": len(chunk.split()), "content": chunk,
             "blocks": blocks[start + offset] if blocks else None,
             "block_paths": paths[start + offset] if paths else None,
             "embedding_local": [float(value) for value in vectors[offset]]}
            for offset, chunk in enumerate(batch)]
    if anchors:  # the prose job replaces them once the region map is built (C18.6b)
        for offset, row in enumerate(rows):
            row["anchors"] = anchors[start + offset]
    return supabase.table("chunks").upsert(rows, on_conflict="book_id,chunk_index").execute().data


def page_anchors(book: dict, chunks: list[str], every_page: list[str] | None, ocr: dict) -> list[dict] | None:
    """C36.1 (issue 27): a PDF's chunk pages from the page texts its chunks were cut from, so a page maps to its
    chunk (quiz ranges, the reader's place, Steve) before (or without) a region map: pypdf's pages, or (C36.G) the
    OCR or browser texts by page number when the book was read from those. None for an EPUB."""
    if (book.get("file_type") or "").lower() != "pdf":
        return None
    pages = numbered(ocr, len(every_page or [])) if ocr else every_page
    return pdf_page_anchors(chunks, pages) if pages else None


def toc_with_pages(toc: list | None, anchors: list[dict] | None) -> list | None:
    """C36.G: contents entries with a chunk but no page (a browser-text or OCR-read book's text structure) get the
    first page of their chunk, so Quiz me's chapter and the reader's place can use them."""
    if not toc or not anchors:
        return toc
    out = []
    for entry in toc:
        index = entry.get("chunk_index")
        pages = (anchors[index] or {}).get("pages") if isinstance(index, int) and 0 <= index < len(anchors) else None
        out.append({**entry, "page": pages[0]} if entry.get("page") is None and pages else entry)
    return out


def _save_toc(book_id: str, toc: list) -> None:
    supabase.table("books").update({"toc": toc}).eq("id", book_id).execute()


def _record_failure(job_id: str, book_id: str, error: str, ready: bool) -> None:
    processing_jobs.fail(job_id, error)
    if not ready:  # a book with readable chunks stays readable
        supabase.table("books").update({"status": "error"}).eq("id", book_id).neq("status", DELETING).execute()


async def run_job(job: dict, file_bytes: bytes | None = None) -> dict:
    """Ingest a claimed job's book from its cursor, saving the cursor after every batch.

    Safe to run again: chunks are upserted on (book_id, chunk_index) and
    (C36.1) no questions are made here, so a batch that ran before the
    process stopped is rewritten, not duplicated. Without `file_bytes` the
    file is read from Storage. Extraction and chunking are deterministic,
    so the chunk at an index is the same on every run.
    """
    book_id, user_id = job["book_id"], job["user_id"]
    # C29.1: every parse, chunking and database call below runs in a thread. On the event loop it kept the server
    # from answering anything, /health included, for tens of seconds at Render's 0.1 CPU, and Render restarted it.
    book = await asyncio.to_thread(_load_book, book_id)
    ready = book.get("status") == "ready"
    browser = book.get("source_format") == BROWSER_TEXT  # C26.7: the reader's browser sent the text; no file here
    try:
        if browser:
            file_bytes = b""
        elif file_bytes is None:
            file_bytes = await asyncio.to_thread(download, book["storage_path"])
        if not browser and file_bytes and "file_sha256" in book and book["file_sha256"] is None:  # C35.3a
            book = await asyncio.to_thread(record_file_facts, book, file_bytes)
        pages, ocr, every_page = await asyncio.to_thread(read_pages, book, file_bytes, browser)
        chunks = await asyncio.to_thread(chunk_text, pages, TARGET_WORDS)
        total, words = len(chunks), sum(len(c.split()) for c in chunks)
        # Reader structure beside the unchanged content (C12.1); (None, None) if it cannot be built.
        # C17.6: each EPUB block's spine index and element path, and the book's own contents.
        blocks, toc, paths = await asyncio.to_thread(
            book_structure.build_with_paths, "text" if browser else book["file_type"], file_bytes, chunks, every_page)
        anchors = await asyncio.to_thread(page_anchors, book, chunks, every_page, ocr)
        toc = toc_with_pages(toc, anchors)
        pdf_text.release_memory()  # C18.G: the parses are over; on Linux the freed memory goes back
        for start, end in batches(total, job["cursor"]):
            if start:  # C35.6: after the first batch (which makes the book readable), make way for requests
                await make_way.between_batches()
            batch = chunks[start:end]
            vectors = await asyncio.to_thread(embedder.embed, batch)
            await asyncio.to_thread(store_batch, book_id, user_id, start, batch, vectors, blocks, paths, anchors)
            if not ready:  # the first batch is stored: the book opens and its first pages can be questioned
                await asyncio.to_thread(mark_ready, book_id, total, words, toc)
                ready = True
            if reader_questions.pending():  # C36.2: a reader's questions are made now, not after this whole book
                await reader_questions.serve(ingesting=book_id)
            await asyncio.to_thread(processing_jobs.advance, job["id"], end, total)
            await asyncio.to_thread(pdf_text.release_memory)
        if not ready:  # a book with no text at all is still ready, as before
            await asyncio.to_thread(mark_ready, book_id, total, words, toc)
        elif toc is not None and book.get("status") == "ready":  # resumed after the book was ready
            await asyncio.to_thread(_save_toc, book_id, toc)
        await asyncio.to_thread(processing_jobs.finish, job["id"], total)
        # The book is readable and its job done; the cover (at most two 3 s requests) comes last.
        await asyncio.to_thread(look_up_cover, book, file_bytes)
        # Then the page-region map (C18.2b), its own job: the book is already readable. A book read from OCR
        # text has its pages' regions from the OCR already (C19.4); pdfplumber finds no text on them.
        if not ocr and not browser:  # a browser-text book has no file, so no region map (C26.7)
            await region_job.after_ingest({**book, "user_id": user_id}, file_bytes)
        return {"total_chunks": total, "total_words": words, "status": "ready"}
    except Exception as e:  # noqa: BLE001 - recorded on the job, which can be resumed
        print(f"Ingestion of book {book_id} stopped: {e}")
        await asyncio.to_thread(_record_failure, job["id"], book_id, str(e), ready)
        return {"status": "error", "error": str(e)}
