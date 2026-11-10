import asyncio
import io
import os
import re
import tempfile
from pypdf import PdfReader
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from backend.nlp import embedder
from backend.services.supabase_client import supabase

# Chunks embedded and inserted together. The first batch is smaller so the
# book unlocks for reading as soon as five chunks are stored.
FIRST_BATCH = 5
EMBED_BATCH = 8

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

async def ingest_book(file_bytes: bytes, file_type: str, book_id: str, user_id: str, target_words: int = 600) -> dict:
    """
    Coordinates extraction, chunking, embedding generation, and database inserts.

    Chunks are embedded with the local model (backend/nlp/embedder.py) in
    batches, off the event loop, and stored in chunks.embedding_local. The
    1536-dimension `embedding` column is no longer written.
    """
    try:
        if file_type.lower() == 'pdf':
            pages = extract_text_from_pdf(file_bytes)
        elif file_type.lower() == 'epub':
            pages = extract_text_from_epub(file_bytes)
        else:
            raise ValueError("Unsupported file type. Must be 'pdf' or 'epub'.")

        chunks = chunk_text(pages, target_words)
        total_chunks = len(chunks)
        
        # Pre-calculate total words to update DB early
        total_words_estimated = sum(len(c.split()) for c in chunks)

        start = 0
        while start < total_chunks:
            batch = chunks[start:start + (FIRST_BATCH if start == 0 else EMBED_BATCH)]

            # 1) embed the batch locally, in a worker thread
            vectors = await asyncio.to_thread(embedder.embed, batch)

            # 2) insert the batch into the chunks table in one call
            supabase.table("chunks").insert([
                {
                    "book_id": book_id,
                    "user_id": user_id,
                    "chunk_index": start + offset,
                    "word_count": len(chunk.split()),
                    "content": chunk,
                    "embedding_local": [float(value) for value in vectors[offset]],
                }
                for offset, chunk in enumerate(batch)
            ]).execute()

            # 3) after the first batch (five chunks, or the whole of a
            # shorter book), unlock the book for reading
            if start == 0:
                supabase.table("books").update({
                    "total_chunks": total_chunks,
                    "total_words": total_words_estimated,
                    "status": "ready"
                }).eq("id", book_id).execute()
            start += len(batch)

        # A book with no text at all is still marked ready, as before
        if total_chunks == 0:
            supabase.table("books").update({
                "total_chunks": 0,
                "total_words": 0,
                "status": "ready"
            }).eq("id", book_id).execute()

        return {
            "total_chunks": total_chunks,
            "total_words": total_words_estimated,
            "status": "ready"
        }
    except Exception as e:
        # If any step fails, mark the book as failed so it doesn't stay 'processing' forever
        print(f"Failed to ingest book {book_id}: {e}")
        supabase.table("books").update({
            "status": "error"
        }).eq("id", book_id).execute()
        return {"status": "error", "error": str(e)}
