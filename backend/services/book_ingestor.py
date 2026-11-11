import asyncio
import io
import os
import re
import tempfile
from pypdf import PdfReader
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.nlp import embedder
from backend.services import processing_jobs
from backend.services.supabase_client import supabase

question_agent = QuestionGenerationAgent()

# Chunks embedded, stored and questioned together; the job's cursor is saved
# after each batch. The first batch is smaller so the book unlocks for
# reading as soon as five chunks are stored.
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


def extract(file_type: str, file_bytes: bytes) -> list[str]:
    if file_type.lower() == "pdf":
        return extract_text_from_pdf(file_bytes)
    if file_type.lower() == "epub":
        return extract_text_from_epub(file_bytes)
    raise ValueError("Unsupported file type. Must be 'pdf' or 'epub'.")


def mark_ready(book_id: str, total: int, words: int) -> None:
    supabase.table("books").update({"total_chunks": total, "total_words": words, "status": "ready"}).eq(
        "id", book_id).execute()


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
    book = supabase.table("books").select("id, file_type, storage_path, status").eq("id", book_id).execute().data[0]
    ready = book.get("status") == "ready"
    try:
        if file_bytes is None:
            file_bytes = await asyncio.to_thread(download, book["storage_path"])
        chunks = chunk_text(extract(book["file_type"], file_bytes), TARGET_WORDS)
        total, words = len(chunks), sum(len(c.split()) for c in chunks)
        for start, end in batches(total, job["cursor"]):
            batch = chunks[start:end]
            vectors = await asyncio.to_thread(embedder.embed, batch)
            stored = supabase.table("chunks").upsert([
                {"book_id": book_id, "user_id": user_id, "chunk_index": start + offset,
                 "word_count": len(chunk.split()), "content": chunk,
                 "embedding_local": [float(value) for value in vectors[offset]]}
                for offset, chunk in enumerate(batch)
            ], on_conflict="book_id,chunk_index").execute()
            if not ready:  # the first stored batch unlocks the book for reading
                mark_ready(book_id, total, words)
                ready = True
            await generate_questions(book_id, stored.data)
            processing_jobs.advance(job["id"], end, total)
        if not ready:  # a book with no text at all is still ready, as before
            mark_ready(book_id, total, words)
        processing_jobs.finish(job["id"], total)
        return {"total_chunks": total, "total_words": words, "status": "ready"}
    except Exception as e:  # noqa: BLE001 - recorded on the job, which can be resumed
        print(f"Ingestion of book {book_id} stopped: {e}")
        processing_jobs.fail(job["id"], str(e))
        if not ready:  # a book with readable chunks stays readable
            supabase.table("books").update({"status": "error"}).eq("id", book_id).execute()
        return {"status": "error", "error": str(e)}
