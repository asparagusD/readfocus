import hashlib
import io
import re
import uuid
from datetime import UTC, datetime
from typing import Any, Literal, cast
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field
from pypdf import PdfReader
from backend.agents import policy
from backend.convert.epub_builder import build_epub
from backend.convert.sources import FORMATS as CONVERTED, convert_upload
from backend.services import body_start, book_purge, direct_upload, ingestion_worker
from backend.services.book_purge import live
from backend.services.book_ingestor import BROWSER_TEXT, extract_metadata
from backend.services import processing_jobs as jobs
from backend.services.supabase_client import supabase
from backend.dependencies import get_current_user

router = APIRouter()

def megabytes(size: int) -> str:
    return f"{size / (1024 * 1024):.0f} MB"


async def read_capped(file: UploadFile, limit: int) -> tuple[bytes, str]:
    """The upload's bytes and hex SHA-256, read 1 MB at a time; 413 as soon as it passes `limit`."""
    digest, parts, size = hashlib.sha256(), [], 0
    while part := await file.read(1024 * 1024):
        size += len(part)
        if size > limit:
            raise HTTPException(status_code=413, detail=f"This file is over {megabytes(limit)}, the most one book can be.")
        digest.update(part)
        parts.append(part)
    return b"".join(parts), digest.hexdigest()


def shelf_bytes(user_id: str) -> int:
    """Bytes of the reader's originals kept on our server (device-only books do not count)."""
    rows = supabase.table("books").select("file_bytes, status").eq("user_id", user_id).eq("storage_mode", "cloud").execute().data
    return sum(int(row.get("file_bytes") or 0) for row in live(rows))


def pdf_page_count(ext: str, file_bytes: bytes) -> int | None:
    if ext != "pdf":
        return None
    try:
        return len(PdfReader(io.BytesIO(file_bytes)).pages)
    except Exception:  # noqa: BLE001 - any pypdf failure: ingestion reports unreadable files
        return None  # the count is optional


AUTHOR_MAX = 300  # as /books/device (C26.7)


def file_author(ext: str, file_bytes: bytes) -> str | None:
    """The author the file names (PDF info Author, EPUB dc:creator), whitespace tidied; None if it names none (C30.1)."""
    author = " ".join((extract_metadata(ext, file_bytes)[1] or "").split())[:AUTHOR_MAX]
    return author or None


def record_source_format(book_id: str, source_format: str) -> None:
    """books.source_format (migration 021); a project without the column keeps the book, untagged."""
    try:
        supabase.table("books").update({"source_format": source_format}).eq("id", book_id).execute()
    except Exception as e:  # noqa: BLE001 - only the label is lost; the book and its EPUB are stored
        print(f"source_format not recorded for book {book_id}: {e}")


async def convert_source(filename: str, data: bytes, title: str, author: str) -> tuple[bytes, str, list[str]]:
    """A Markdown, .zip or notebook upload as EPUB bytes, its source format and notes for the reader (C19.2c)."""
    try:
        source_format, converted = await run_in_threadpool(convert_upload, filename, data)
        epub = await run_in_threadpool(build_epub, title, author, converted.chapters, converted.images)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"We couldn't convert this file: {e}") from e
    return epub, source_format, converted.notes


@router.post("/upload")
async def upload_book(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    author: str = Form(""),  # C30.1: optional; left blank, the file's own author is used
    storage_mode: Literal["cloud", "device"] = Form("cloud"),
    user_id: str = Depends(get_current_user)
):
    # 1. Validate file type
    filename = file.filename or ""
    ext = filename.split(".")[-1].lower()

    if ext not in ['pdf', 'epub', *CONVERTED]:
        raise HTTPException(status_code=400, detail="Only .pdf, .epub, .md, .zip (Markdown with its images) and .ipynb files are supported.")
    if ext in CONVERTED and storage_mode == "device":
        raise HTTPException(status_code=400, detail=(
            "A Markdown or notebook book is converted and kept on our server so it can open as a book; "
            "untick \"keep on this device\" to add it."))

    mime_type = file.content_type

    # Read bytes, hash them, and stop at the per-file limit (C17.1)
    file_bytes, sha256 = await read_capped(file, policy.MAX_BOOK_FILE_BYTES)
    # Markdown, a Markdown .zip or a notebook becomes the book's EPUB (C19.2c): that is the file kept and read.
    source_format, notes = None, []
    if ext in CONVERTED:
        file_bytes, source_format, notes = await convert_source(filename, file_bytes, title, author)
        if len(file_bytes) > policy.MAX_BOOK_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"Converted, this book is over {megabytes(policy.MAX_BOOK_FILE_BYTES)}.")
        sha256, ext, mime_type = hashlib.sha256(file_bytes).hexdigest(), "epub", "application/epub+zip"
    # C30.1: nobody should have to type an author: a blank one comes from the file itself, else stays empty.
    author = " ".join(author.split())[:AUTHOR_MAX] or None
    if author is None and source_format is None:
        author = await run_in_threadpool(file_author, ext, file_bytes)
    if storage_mode == "cloud":
        used = await run_in_threadpool(shelf_bytes, user_id)
        if used + len(file_bytes) > policy.MAX_SHELF_BYTES_PER_USER:
            raise HTTPException(status_code=413, detail=(
                f"Your shelf is full: {megabytes(used)} of {megabytes(policy.MAX_SHELF_BYTES_PER_USER)} kept on our "
                "server. Remove a book, or keep this one on this device only."))

    # 2. Generate UUID for the book
    book_id = str(uuid.uuid4())

    # 3. Upload to Supabase Storage, unless the original stays on the reader's device
    storage_path = f"{user_id}/{book_id}.{ext}" if storage_mode == "cloud" else None
    # C29.1: the upload, the row (with its page count) and the job are written in a thread, not on the event loop:
    # sending a 50 MB file there kept the server from answering /health at Render's 0.1 CPU.
    if storage_path:
        try:
            await run_in_threadpool(
                supabase.storage.from_("books").upload,
                file=file_bytes,
                path=storage_path,
                file_options={"content-type": mime_type or "application/octet-stream"}
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Storage upload failed: {str(e)}")

    # 4. Insert row into books table
    try:
        page_count = await run_in_threadpool(pdf_page_count, ext, file_bytes)
        await run_in_threadpool(supabase.table("books").insert({
            "id": book_id,
            "user_id": user_id,
            "title": title,
            "author": author,
            "file_type": ext,
            "storage_path": storage_path,
            "status": "processing",
            "file_sha256": sha256,
            "file_bytes": len(file_bytes),
            "file_format": ext,
            "storage_mode": storage_mode,
            "page_count": page_count,
        }).execute)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database insert failed: {str(e)}")
    if source_format:
        await run_in_threadpool(record_source_format, book_id, source_format)
        
    # 5. Record a durable job, then ingest after the response. If the process
    # stops, the job row keeps the cursor and the sweep or /resume picks it up.
    job = await run_in_threadpool(lambda: jobs.claim(jobs.create(book_id, user_id)))
    if job:
        background_tasks.add_task(ingestion_worker.run, job, file_bytes)
    
    # 6. Return immediately
    return {"book_id": book_id, "status": "processing", "source_format": source_format, "notes": notes,
            "author": author}

def shelf_full(used: int) -> HTTPException:
    return HTTPException(status_code=413, detail=(
        f"Your shelf is full: {megabytes(used)} of {megabytes(policy.MAX_SHELF_BYTES_PER_USER)} kept on our "
        "server. Remove a book, or keep this one on this device only."))


class UploadUrlRequest(BaseModel):
    """C35.3a (issue 16): a PDF or EPUB the browser will send straight to Storage, with its size in bytes."""
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=1024)
    size: int = Field(ge=1)


@router.post("/upload-url")
def create_upload_url(req: UploadUrlRequest, user_id: str = Depends(get_current_user)):
    """Check the book fits (its type, its size, the shelf), then a signed upload URL for the reader's own path.
    Markdown, a .zip and notebooks are converted, and device-only books stay on the device: both use /upload."""
    file_type = req.filename.rsplit(".", 1)[-1].lower()
    if file_type not in direct_upload.KINDS:
        raise HTTPException(status_code=400, detail="Only a .pdf or .epub is sent this way.")
    if req.size > policy.MAX_BOOK_FILE_BYTES:
        raise HTTPException(status_code=413, detail=(
            f"This file is over {megabytes(policy.MAX_BOOK_FILE_BYTES)}, the most one book can be."))
    used = shelf_bytes(user_id)
    if used + req.size > policy.MAX_SHELF_BYTES_PER_USER:
        raise shelf_full(used)
    book_id = str(uuid.uuid4())
    signed = direct_upload.signed_upload(direct_upload.object_path(user_id, book_id, file_type))
    return {"book_id": book_id, "file_type": file_type, "upload_url": signed["signed_url"], "token": signed["token"],
            "max_bytes": policy.MAX_BOOK_FILE_BYTES}


class RegisterRequest(BaseModel):
    """The book whose file has reached Storage through /upload-url."""
    model_config = ConfigDict(extra="forbid")
    book_id: uuid.UUID
    file_type: Literal["pdf", "epub"]
    title: str = Field(min_length=1, max_length=1024)
    author: str = Field(default="", max_length=1024)


@router.post("/register")
def register_upload(req: RegisterRequest, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Check what arrived at the reader's own path (it exists, its size, its first bytes, the shelf; a refused
    file is removed), then the row and the ingestion job, which reads the file from Storage and works out its
    hash, page count and, when none was typed, its author (C35.3a)."""
    book_id = str(req.book_id)
    path = direct_upload.object_path(user_id, book_id, req.file_type)
    if supabase.table("books").select("id").eq("id", book_id).execute().data:
        raise HTTPException(status_code=409, detail="This book is already on a shelf.")
    size, refused = direct_upload.check(path, req.file_type)
    if refused:
        raise HTTPException(status_code=refused[0], detail=refused[1])
    used = shelf_bytes(user_id)
    if used + size > policy.MAX_SHELF_BYTES_PER_USER:
        direct_upload.remove(path)
        raise shelf_full(used)
    author = " ".join(req.author.split())[:AUTHOR_MAX] or None
    supabase.table("books").insert({
        "id": book_id, "user_id": user_id, "title": req.title, "author": author, "file_type": req.file_type,
        "storage_path": path, "status": "processing", "file_sha256": None, "file_bytes": size,
        "file_format": req.file_type, "storage_mode": "cloud", "page_count": None,
    }).execute()
    job = jobs.claim(jobs.create(book_id, user_id))
    if job:
        background_tasks.add_task(ingestion_worker.run, job)
    return {"book_id": book_id, "status": "processing", "source_format": None, "notes": [], "author": author}


BOOK_LIST_FIELDS = "id, status, title, author, total_chunks, total_words, created_at, cover_url, storage_mode"
PROGRESS_FIELDS = ("chunks_completed", "last_chunk_index", "updated_at")


@router.get("")
def get_books(user_id: str = Depends(get_current_user)):
    """The caller's books for the shelf, each with its cover and reading progress (null before a first session)."""
    books = live(supabase.table("books").select(BOOK_LIST_FIELDS).eq("user_id", user_id).execute().data)
    rows = supabase.table("reading_progress").select(
        "book_id, " + ", ".join(PROGRESS_FIELDS)).eq("user_id", user_id).execute().data or []
    progress = {row["book_id"]: {key: row.get(key) for key in PROGRESS_FIELDS} for row in cast(list[dict[str, Any]], rows)}
    return [{**book, "progress": progress.get(book["id"])} for book in cast(list[dict[str, Any]], books)]

@router.get("/{book_id}/file")
def get_book_file(book_id: str, user_id: str = Depends(get_current_user)):
    """A short-lived signed URL for the owner's original file; 404 for other readers and device-only books."""
    rows = live(supabase.table("books").select("storage_path, storage_mode, file_sha256, status").eq(
        "id", book_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")
    book = cast(dict[str, Any], rows[0])
    if book.get("storage_mode") == "device" or not book.get("storage_path"):
        raise HTTPException(status_code=404, detail="This book is only on the device it was added from.")
    signed = supabase.storage.from_("books").create_signed_url(book["storage_path"], policy.BOOK_FILE_URL_SECONDS)
    return {"url": signed.get("signedURL") or signed.get("signedUrl"), "expires_in": policy.BOOK_FILE_URL_SECONDS,
            "sha256": book.get("file_sha256")}


@router.get("/{book_id}")
def get_book_details(book_id: str, user_id: str = Depends(get_current_user)):
    found = live(supabase.table("books").select("*").eq("id", book_id).eq("user_id", user_id).execute().data)
    if not found:
        raise HTTPException(status_code=404, detail="Book not found")

    book: dict[str, Any] = found[0]
    
    progress_resp = supabase.table("reading_progress").select("*").eq("book_id", book_id).eq("user_id", user_id).execute()
    
    book["reading_progress"] = progress_resp.data[0] if progress_resp.data else None
    
    return book

PAGES_MAX_CHUNKS = 4  # reading ahead is a few chunks at a time
PAGE_FIELDS = ("chunk_index", "content", "word_count", "blocks")


@router.get("/{book_id}/pages")
def get_pages(book_id: str, start: int = Query(ge=0), end: int | None = Query(default=None, ge=0),
                    user_id: str = Depends(get_current_user)):
    """Chunks start..end (inclusive, at most four) of the caller's book, for reading ahead (C12.4, C12.5b).

    Read-only: no session, timer, pacing or test is touched; the planner decides what a session reads.
    """
    end = start if end is None else end
    if end < start or end - start + 1 > PAGES_MAX_CHUNKS:
        raise HTTPException(status_code=422, detail=f"Ask for 1 to {PAGES_MAX_CHUNKS} chunks, start to end.")
    owned = live(supabase.table("books").select("id, status").eq("id", book_id).eq("user_id", user_id).execute().data)
    if not owned:
        raise HTTPException(status_code=404, detail="Book not found")
    rows = supabase.table("chunks").select(", ".join(PAGE_FIELDS)).eq("book_id", book_id).in_(
        "chunk_index", list(range(start, end + 1))).execute().data or []
    chunks = sorted((cast(dict[str, Any], row) for row in rows), key=lambda row: row["chunk_index"])
    return {"chunks": [{field: row.get(field) for field in PAGE_FIELDS} for row in chunks]}


REGIONS_MAX_PAGES = 20  # the regions job's batch: a reader asks for a spread's neighbourhood at a time
SKIPPED_KINDS = ("math", "code", "figure", "table")


@router.get("/{book_id}/regions")
def get_regions(book_id: str, first: int = Query(ge=1), last: int = Query(ge=1),
                      user_id: str = Depends(get_current_user)):
    """Boxes on PDF pages first..last that word lookup skips (C18.6d): math, code, figures, tables and
    inline math, as {page, kind, bbox} in points from the page's top-left (ANCHORS A1). Read-only."""
    if last < first or last - first + 1 > REGIONS_MAX_PAGES:
        raise HTTPException(status_code=422, detail=f"Ask for 1 to {REGIONS_MAX_PAGES} pages, first to last.")
    owned = live(supabase.table("books").select("id, status").eq("id", book_id).eq("user_id", user_id).execute().data)
    if not owned:
        raise HTTPException(status_code=404, detail="Book not found")
    rows = (supabase.table("page_regions").select("id, page, kind, bbox, order_in_page, meta").eq("book_id", book_id)
            .gte("page", first).lte("page", last).execute().data or [])
    out = []
    for row in sorted(rows, key=lambda r: (r["page"], r["order_in_page"])):
        meta = row.get("meta") or {}
        if row["kind"] in SKIPPED_KINDS and row.get("bbox"):
            out.append({"page": row["page"], "kind": row["kind"], "bbox": row["bbox"], "id": row.get("id"),
                        "inline": False})
        for box in [*(meta.get("inline_boxes") or []), *(meta.get("inline_drawn") or [])]:
            out.append({"page": row["page"], "kind": "math", "bbox": box, "id": row.get("id"), "inline": True})
    return {"regions": out}


REGION_FIELDS = "id, kind, page, spine_index, bbox, text, meta, anchor"
STEP_PATH = re.compile(r"^(/\d{1,4}){1,32}$")


def region_detail(row: dict) -> dict:
    """What the block actions need from one region (C20.8): exact code text, a figure's caption, label and alt,
    an EPUB equation's LaTeX or MathML, the equation number. Classification internals stay on the server."""
    meta = row.get("meta") or {}
    return {
        "id": row["id"], "kind": row["kind"], "page": row.get("page"), "spine_index": row.get("spine_index"),
        "bbox": row.get("bbox"), "text": row.get("text") or "", "language": meta.get("language_guess"),
        "caption": meta.get("caption"), "label": meta.get("label"), "alt": meta.get("alt"),
        "latex": meta.get("latex"), "mathml": meta.get("mathml"), "equation_number": meta.get("equation_number"),
    }


def _owned(book_id: str, user_id: str) -> None:
    owned = live(supabase.table("books").select("id, status").eq("id", book_id).eq("user_id", user_id).execute().data)
    if not owned:
        raise HTTPException(status_code=404, detail="Book not found")


@router.get("/{book_id}/regions/{region_id}")
def get_region(book_id: str, region_id: str, user_id: str = Depends(get_current_user)):
    """One region of the caller's book, for Copy code, Explain and Copy as LaTeX (C20.8). Read-only."""
    _owned(book_id, user_id)
    rows = supabase.table("page_regions").select(REGION_FIELDS).eq("id", region_id).eq("book_id", book_id).execute()
    if not rows.data:
        raise HTTPException(status_code=404, detail="Region not found")
    return region_detail(cast(dict[str, Any], rows.data[0]))


@router.get("/{book_id}/region-at")
def get_region_at(book_id: str, spine_index: int = Query(ge=0, le=100_000), path: str = Query(max_length=200),
                        user_id: str = Depends(get_current_user)):
    """The EPUB region whose element is at `path` (CFI steps from the document root, as page_regions.anchor and
    chunks.block_paths count them) in spine item `spine_index` (C20.8). Read-only."""
    if not STEP_PATH.match(path):
        raise HTTPException(status_code=422, detail="A path is CFI steps such as /4/6.")
    _owned(book_id, user_id)
    rows = (supabase.table("page_regions").select(REGION_FIELDS).eq("book_id", book_id).eq("spine_index", spine_index)
            .execute().data or [])
    found = next((r for r in rows if ((r.get("anchor") or {}).get("path")) == path), None)
    if found is None:
        raise HTTPException(status_code=404, detail="Region not found")
    return region_detail(cast(dict[str, Any], found))


BODY_START_FIELDS = "id, file_type, page_count, toc, body_start, body_start_source, status"


def _book_for_body_start(book_id: str, user_id: str) -> dict:
    rows = live(supabase.table("books").select(BODY_START_FIELDS).eq("id", book_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")
    return cast(dict[str, Any], rows[0])


@router.get("/{book_id}/body-start")
async def get_body_start(book_id: str, user_id: str = Depends(get_current_user)):
    """Where the caller's book's body (chapter 1) begins, for focus mode (C23.1, FOCUS_RULES F2): the stored one,
    else detected now and stored unless the reader chose one meanwhile. {source: None, body_start: None} when
    nothing points at it."""
    book = await run_in_threadpool(_book_for_body_start, book_id, user_id)
    if book.get("body_start"):
        return {"source": book.get("body_start_source"), "body_start": book["body_start"]}
    found = await run_in_threadpool(body_start.for_book, supabase, book)
    if not found:
        return {"source": None, "body_start": None}
    await run_in_threadpool(supabase.table("books").update({"body_start": found["body_start"], "body_start_source": found[
        "source"]}).eq("id", book_id).eq("user_id", user_id).is_("body_start", "null").execute)
    return found


class BodyStartRequest(BaseModel):
    """The reader's own body start ("The book starts here"): a PDF page or an EPUB spine index, and its title."""
    model_config = ConfigDict(extra="forbid")
    page: int | None = Field(default=None, ge=1, le=100_000)
    spine_index: int | None = Field(default=None, ge=0, le=100_000)
    title: str | None = Field(default=None, max_length=policy.BODY_START_TITLE_MAX)


@router.put("/{book_id}/body-start")
async def put_body_start(book_id: str, req: BodyStartRequest, user_id: str = Depends(get_current_user)):
    """Set the body start by hand (source user); detection never overwrites it."""
    book = await run_in_threadpool(_book_for_body_start, book_id, user_id)
    pdf = str(book.get("file_type") or "").lower() == "pdf"
    unit = req.page if pdf else req.spine_index
    if unit is None or (req.spine_index if pdf else req.page) is not None:
        raise HTTPException(status_code=422, detail="A PDF's start is a page; an EPUB's is a section (spine_index).")
    if pdf and book.get("page_count") and unit > book["page_count"]:
        raise HTTPException(status_code=422, detail="That page is not in this book.")
    found = {"source": "user", "body_start": body_start.place("pdf" if pdf else "epub", unit, req.title)}
    await run_in_threadpool(supabase.table("books").update({"body_start": found["body_start"], "body_start_source": "user"})
                            .eq("id", book_id).eq("user_id", user_id).execute)
    return found


JOB_FIELDS = ("status", "progress", "cursor", "attempts", "error", "updated_at")


def public_job(job: dict | None) -> dict | None:
    return {key: job.get(key) for key in JOB_FIELDS} if job else None


@router.get("/{book_id}/status")
def get_book_status(book_id: str, user_id: str = Depends(get_current_user)):
    rows = live(supabase.table("books").select("status, total_chunks").eq("id", book_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")

    return {**rows[0], "ingestion": public_job(jobs.get(book_id))}


@router.post("/{book_id}/resume")
def resume_book(book_id: str, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Run a book's ingestion again from its cursor: after a failure, or for a book left processing with no job."""
    rows = live(supabase.table("books").select("id, status, storage_path, source_format").eq("id", book_id).eq(
        "user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")
    # A device-only book: the server never kept its file. C26.7: a browser-text book kept its text, so it resumes.
    if not rows[0].get("storage_path") and rows[0].get("source_format") != BROWSER_TEXT:
        raise HTTPException(status_code=409, detail="This book's file is only on your device: add the file again.")
    job = jobs.get(book_id) or jobs.create(book_id, user_id)
    ok, reason = jobs.claimable(job, datetime.now(UTC), jobs.stale_minutes(), manual=True)
    if not ok:
        raise HTTPException(status_code=409, detail=f"Ingestion is already {reason}.")
    claimed = jobs.claim(job, manual=True)
    if not claimed:
        raise HTTPException(status_code=409, detail="Ingestion was resumed by another request.")
    status = rows[0]["status"]
    if status == "error":
        supabase.table("books").update({"status": "processing"}).eq("id", book_id).execute()
        status = "processing"
    background_tasks.add_task(ingestion_worker.run, claimed)
    return {"book_id": book_id, "status": status, "ingestion": public_job(claimed)}

@router.delete("/{book_id}", status_code=202)
def delete_book(book_id: str, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """C35.2 (issue 18): mark the book `deleting` and answer at once; the file, note pictures and rows go in the
    background (book_purge), and from now on no listing or lookup shows the book (C35.2b)."""
    if not book_purge.mark(book_id, user_id):
        raise HTTPException(status_code=404, detail="Book not found")
    background_tasks.add_task(book_purge.purge, book_id, user_id)
    return {"status": book_purge.DELETING, "book_id": book_id}
