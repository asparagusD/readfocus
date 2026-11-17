"""OCR text for scanned PDF pages (C19.4): the reader's browser posts each page's words once; any caller reads them.

POST /books/{id}/ocr  one scanned page's words from tesseract.js (owner only, a flagged page only),
                      cleaned by backend/services/ocr_pages.py and stored; when it completes a fully
                      scanned book, the book is ingested again from its OCR text (chunks, questions).
GET  /books/{id}/ocr  the book's scanned pages and the ones with text, and with first..last (at most
                      20 pages) each page's words and boxes for the reader's text layer. Read-only.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.services import book_ingestor, ocr_pages
from backend.services import processing_jobs as jobs
from backend.services.supabase_client import supabase

router = APIRouter()
BOOK_FIELDS = "id, user_id, file_type, status, total_chunks, storage_mode, scanned_pages"
MAX_PAGES = 20
MAX_POINTS = 14400  # PDF's largest page side


class OcrWord(BaseModel):
    t: str = Field(max_length=200)
    b: list[float] = Field(min_length=4, max_length=4)
    c: float = Field(default=0, ge=0, le=100)
    p: int = Field(default=0, ge=0)  # paragraph number on the page
    l: int = Field(default=0, ge=0)  # line number within the page, as the browser sends it


class OcrPage(BaseModel):
    page: int = Field(ge=1)
    width: float = Field(gt=0, le=MAX_POINTS)  # the page's size in points, as the reader's PDF.js reports it
    height: float = Field(gt=0, le=MAX_POINTS)
    engine: str = Field(default="tesseract.js", max_length=60)
    words: list[OcrWord] = Field(max_length=policy.OCR_MAX_WORDS_PER_PAGE)


def own_book(book_id: str, user_id: str) -> dict:
    rows = supabase.table("books").select(BOOK_FIELDS).eq("id", book_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")
    return rows[0]


def save(book: dict, body: OcrPage) -> dict:
    regions = supabase.table("page_regions").select("kind, bbox").eq("book_id", book["id"]).eq(
        "page", body.page).execute().data or []
    cleaned = ocr_pages.clean_page([w.model_dump() for w in body.words], body.width, body.height,
                                   ocr_pages.skip_boxes(regions, body.width, body.height))
    ocr_pages.store_page(book, body.page, cleaned, body.engine)
    return cleaned


@router.post("/{book_id}/ocr")
async def post_ocr(book_id: str, body: OcrPage, background_tasks: BackgroundTasks,
                   user_id: str = Depends(get_current_user)):
    book = await run_in_threadpool(own_book, book_id, user_id)
    scanned = book.get("scanned_pages") or []
    if (book.get("file_type") or "").lower() != "pdf" or body.page not in scanned:
        raise HTTPException(status_code=409, detail="This page has its own text, so it is not read by OCR.")
    cleaned = await run_in_threadpool(save, book, body)
    done = await run_in_threadpool(ocr_pages.done_pages, book_id)
    reingest = ocr_pages.ready_to_reingest(book, done)
    if reingest:  # every scanned page of a book with no chunks has text: read the book again (C19.4)
        supabase.table("books").update({"status": "processing"}).eq("id", book_id).execute()
        job = jobs.claim(jobs.requeue(book_id, user_id) or {}, manual=True)
        if job:
            background_tasks.add_task(book_ingestor.run_job, job)
    return {"page": body.page, "words": len(cleaned["words"]), "dropped": cleaned["dropped"],
            "done": len(done), "scanned": len(scanned), "reingest": reingest}


@router.get("/{book_id}/ocr")
async def get_ocr(book_id: str, first: int | None = Query(default=None, ge=1), last: int | None = Query(default=None, ge=1),
                  user_id: str = Depends(get_current_user)):
    book = await run_in_threadpool(own_book, book_id, user_id)
    out = {"scanned_pages": book.get("scanned_pages") or [], "done": await run_in_threadpool(ocr_pages.done_pages, book_id)}
    if first is not None and last is not None:
        if last < first or last - first + 1 > MAX_PAGES:
            raise HTTPException(status_code=422, detail=f"Ask for 1 to {MAX_PAGES} pages, first to last.")
        rows = (supabase.table(ocr_pages.TABLE).select("page, words").eq("book_id", book_id)
                .gte("page", first).lte("page", last).execute().data or [])
        out["pages"] = sorted(({"page": r["page"], "words": r.get("words") or []} for r in rows), key=lambda r: r["page"])
    return out
