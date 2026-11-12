import asyncio
import io
import os
import re
import tempfile
import zipfile
from xml.etree import ElementTree
from pypdf import PdfReader
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.nlp import embedder
from backend.services import book_structure, covers, processing_jobs
from backend.services.supabase_client import supabase

question_agent = QuestionGenerationAgent()

# Chunks embedded, stored and questioned together; the job's cursor is saved
# after each batch. The first batch is smaller so the book unlocks as soon
# as five chunks and their questions are stored.
FIRST_BATCH = 5
INGEST_BATCH = 16
TARGET_WORDS = 600

def extract_text_from_pdf(file_bytes: bytes) -> list[str]:
    """Extract text from a PDF file, returning a list of page strings."""
    reader = PdfReader(io.BytesIO(file_bytes))
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            text = text.replace('\x00', '')
            pages.append(text)
    return pages

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

async def generate_questions(book_id: str, stored_chunks) -> None:
    """Fill the question bank for chunks that were just stored, off the event loop.

    A failure here is logged and nothing more: the chunks are stored and the
    book stays readable; its questions can be generated again later.
    """
    try:
        chunk_ids = [row["id"] for row in stored_chunks or []]
        if chunk_ids:
            await asyncio.to_thread(question_agent.run, book_id, chunk_ids)
    except Exception as e:  # noqa: BLE001 - whatever goes wrong here must not fail the ingestion
        print(f"Question generation failed for book {book_id}: {e}")


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
        title, author = covers.lookup_terms(*extract_metadata(book["file_type"], file_bytes),
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
    supabase.table("books").update(values).eq("id", book_id).execute()


def download(storage_path: str) -> bytes:
    return supabase.storage.from_("books").download(storage_path)


async def run_job(job: dict, file_bytes: bytes | None = None) -> dict:
    """Ingest a claimed job's book from its cursor, saving the cursor after every batch.

    Safe to run again: chunks are upserted on (book_id, chunk_index) and
    questions on their own unique key, so a batch that ran before the
    process stopped is rewritten, not duplicated. Without `file_bytes` the
    file is read from Storage. Extraction and chunking are deterministic,
    so the chunk at an index is the same on every run.
    """
    book_id, user_id = job["book_id"], job["user_id"]
    book = supabase.table("books").select(
        "id, file_type, storage_path, status, title, author, cover_source").eq("id", book_id).execute().data[0]
    ready = book.get("status") == "ready"
    try:
        if file_bytes is None:
            file_bytes = await asyncio.to_thread(download, book["storage_path"])
        chunks = chunk_text(extract(book["file_type"], file_bytes), TARGET_WORDS)
        total, words = len(chunks), sum(len(c.split()) for c in chunks)
        # Reader structure beside the unchanged content (C12.1); (None, None) if it cannot be built.
        # C17.6: each EPUB block's spine index and element path, and the book's own contents.
        blocks, toc, paths = await asyncio.to_thread(book_structure.build_with_paths, book["file_type"], file_bytes, chunks)
        for start, end in batches(total, job["cursor"]):
            batch = chunks[start:end]
            vectors = await asyncio.to_thread(embedder.embed, batch)
            stored = supabase.table("chunks").upsert([
                {"book_id": book_id, "user_id": user_id, "chunk_index": start + offset,
                 "word_count": len(chunk.split()), "content": chunk,
                 "blocks": blocks[start + offset] if blocks else None,
                 "block_paths": paths[start + offset] if paths else None,
                 "embedding_local": [float(value) for value in vectors[offset]]}
                for offset, chunk in enumerate(batch)
            ], on_conflict="book_id,chunk_index").execute()
            await generate_questions(book_id, stored.data)  # questions and concepts of the batch
            if not ready:  # the first batch is stored with its questions: the first session can start
                mark_ready(book_id, total, words, toc)
                ready = True
            processing_jobs.advance(job["id"], end, total)
        if not ready:  # a book with no text at all is still ready, as before
            mark_ready(book_id, total, words, toc)
        elif toc is not None and book.get("status") == "ready":  # resumed after the book was ready
            supabase.table("books").update({"toc": toc}).eq("id", book_id).execute()
        processing_jobs.finish(job["id"], total)
        # The book is readable and its job done; the cover (at most two 3 s requests) comes last.
        await asyncio.to_thread(look_up_cover, book, file_bytes)
        return {"total_chunks": total, "total_words": words, "status": "ready"}
    except Exception as e:  # noqa: BLE001 - recorded on the job, which can be resumed
        print(f"Ingestion of book {book_id} stopped: {e}")
        processing_jobs.fail(job["id"], str(e))
        if not ready:  # a book with readable chunks stays readable
            supabase.table("books").update({"status": "error"}).eq("id", book_id).execute()
        return {"status": "error", "error": str(e)}
