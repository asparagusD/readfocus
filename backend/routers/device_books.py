"""Books over 50 MB, kept on the reader's device (C26.7): the server never holds the file.

POST /books/device makes the book (PDF or EPUB, over MAX_BOOK_FILE_BYTES and at most
MAX_DEVICE_BOOK_FILE_BYTES), marked source_format 'browser-text', with no file and no region map. The
browser reads each page's text (pdf.js; an EPUB's spine documents) and sends it in batches to
POST /books/{id}/pages, stored in page_ocr (engine 'browser'); the last batch queues ingestion, which chunks,
embeds and builds questions from that text (book_ingestor.run_job). Owner only.
"""

import uuid
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.services import ingestion_worker
from backend.services import processing_jobs as jobs
from backend.services.book_ingestor import BROWSER_TEXT
from backend.services.book_purge import live
from backend.services.supabase_client import supabase

router = APIRouter()


class DeviceBook(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="", max_length=300)
    file_type: Literal["pdf", "epub"]
    file_bytes: int = Field(gt=policy.MAX_BOOK_FILE_BYTES, le=policy.MAX_DEVICE_BOOK_FILE_BYTES)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    page_count: int | None = Field(default=None, ge=1, le=policy.BROWSER_TEXT_MAX_PAGES)


class PageBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first: int = Field(ge=1, le=policy.BROWSER_TEXT_MAX_PAGES)
    texts: list[Annotated[str, Field(max_length=policy.BROWSER_TEXT_MAX_PAGE_CHARS)]] = Field(
        min_length=1, max_length=policy.BROWSER_TEXT_PAGES_PER_BATCH)
    last: bool = False


def create(user_id: str, req: DeviceBook) -> dict:
    book_id = str(uuid.uuid4())
    supabase.table("books").insert({
        "id": book_id, "user_id": user_id, "title": req.title, "author": req.author, "file_type": req.file_type,
        "file_format": req.file_type, "storage_path": None, "storage_mode": "device", "status": "processing",
        "file_sha256": req.sha256, "file_bytes": req.file_bytes, "page_count": req.page_count,
        "source_format": BROWSER_TEXT,
    }).execute()
    return {"book_id": book_id, "status": "processing", "pages_per_batch": policy.BROWSER_TEXT_PAGES_PER_BATCH}


@router.post("/device")
async def create_device_book(req: DeviceBook, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(create, user_id, req)


def store(user_id: str, book_id: str, req: PageBatch) -> dict | None:
    """Keep the batch's page texts; the claimed ingestion job after the last batch, else None."""
    rows = live(supabase.table("books").select("id, user_id, status, source_format").eq("id", book_id).eq(
        "user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")
    book = cast(dict[str, Any], rows[0])
    if book.get("source_format") != BROWSER_TEXT:
        raise HTTPException(status_code=409, detail="This book's text is read on our server.")
    if book.get("status") != "processing":
        raise HTTPException(status_code=409, detail="This book's text has already been read.")
    through = req.first + len(req.texts) - 1
    if through > policy.BROWSER_TEXT_MAX_PAGES:
        raise HTTPException(status_code=422, detail=f"A book can have at most {policy.BROWSER_TEXT_MAX_PAGES} pages.")
    supabase.table("page_ocr").upsert([
        {"book_id": book_id, "user_id": user_id, "page": req.first + n, "text": text.replace("\x00", ""),
         "words": [], "engine": "browser"}
        for n, text in enumerate(req.texts)], on_conflict="book_id,page").execute()
    return jobs.claim(jobs.create(book_id, user_id)) if req.last else None


@router.post("/{book_id}/pages")
async def post_pages(book_id: str, req: PageBatch, background_tasks: BackgroundTasks,
                     user_id: str = Depends(get_current_user)):
    job = await run_in_threadpool(store, user_id, book_id, req)
    if job:
        background_tasks.add_task(ingestion_worker.run, job)  # one at a time, after any job queued before (C26.1)
    return {"received": len(req.texts), "through": req.first + len(req.texts) - 1, "ingesting": job is not None}
