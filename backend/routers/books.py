import uuid
from datetime import UTC, datetime
from typing import Any, cast
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, Depends, HTTPException
from backend.services import book_ingestor
from backend.services import processing_jobs as jobs
from backend.services.supabase_client import supabase
from backend.dependencies import get_current_user

router = APIRouter()

@router.post("/upload")
async def upload_book(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    author: str = Form(...),
    user_id: str = Depends(get_current_user)
):
    # 1. Validate file type
    filename = file.filename or ""
    ext = filename.split(".")[-1].lower()
    
    if ext not in ['pdf', 'epub']:
        raise HTTPException(status_code=400, detail="Only .pdf and .epub files are supported.")
        
    mime_type = file.content_type
    
    # Read bytes
    file_bytes = await file.read()
    
    # 2. Generate UUID for the book
    book_id = str(uuid.uuid4())
    
    # 3. Upload to Supabase Storage
    storage_path = f"{user_id}/{book_id}.{ext}"
    try:
        supabase.storage.from_("books").upload(
            file=file_bytes,
            path=storage_path,
            file_options={"content-type": mime_type or "application/octet-stream"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {str(e)}")
        
    # 4. Insert row into books table
    try:
        supabase.table("books").insert({
            "id": book_id,
            "user_id": user_id,
            "title": title,
            "author": author,
            "file_type": ext,
            "storage_path": storage_path,
            "status": "processing"
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database insert failed: {str(e)}")
        
    # 5. Record a durable job, then ingest after the response. If the process
    # stops, the job row keeps the cursor and the sweep or /resume picks it up.
    job = jobs.claim(jobs.create(book_id, user_id))
    if job:
        background_tasks.add_task(book_ingestor.run_job, job, file_bytes)
    
    # 6. Return immediately
    return {"book_id": book_id, "status": "processing"}

@router.get("")
async def get_books(user_id: str = Depends(get_current_user)):
    resp = supabase.table("books").select(
        "id, status, title, author, total_chunks, total_words, created_at"
    ).eq("user_id", user_id).execute()
    
    return resp.data

@router.get("/{book_id}")
async def get_book_details(book_id: str, user_id: str = Depends(get_current_user)):
    book_resp = supabase.table("books").select("*").eq("id", book_id).eq("user_id", user_id).execute()
    if not book_resp.data:
        raise HTTPException(status_code=404, detail="Book not found")
        
    book: dict[str, Any] = cast(dict[str, Any], book_resp.data[0])
    
    progress_resp = supabase.table("reading_progress").select("*").eq("book_id", book_id).eq("user_id", user_id).execute()
    
    book["reading_progress"] = progress_resp.data[0] if progress_resp.data else None
    
    return book

JOB_FIELDS = ("status", "progress", "cursor", "attempts", "error", "updated_at")


def public_job(job: dict | None) -> dict | None:
    return {key: job.get(key) for key in JOB_FIELDS} if job else None


@router.get("/{book_id}/status")
async def get_book_status(book_id: str, user_id: str = Depends(get_current_user)):
    resp = supabase.table("books").select("status, total_chunks").eq("id", book_id).eq("user_id", user_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Book not found")

    return {**resp.data[0], "ingestion": public_job(jobs.get(book_id))}


@router.post("/{book_id}/resume")
async def resume_book(book_id: str, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Run a book's ingestion again from its cursor: after a failure, or for a book left processing with no job."""
    rows = supabase.table("books").select("id, status").eq("id", book_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")
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
    background_tasks.add_task(book_ingestor.run_job, claimed)
    return {"book_id": book_id, "status": status, "ingestion": public_job(claimed)}

@router.delete("/{book_id}")
async def delete_book(book_id: str, user_id: str = Depends(get_current_user)):
    # 1. Fetch book to get storage path and verify ownership
    resp = supabase.table("books").select("storage_path").eq("id", book_id).eq("user_id", user_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Book not found")
        
    book: dict[str, Any] = cast(dict[str, Any], resp.data[0])
    storage_path = str(book.get("storage_path")) if book.get("storage_path") else None
    
    # 2. Delete from Storage if path exists
    if storage_path and storage_path != "None":
        try:
            supabase.storage.from_("books").remove([storage_path])
        except Exception as e:
            # We can log this, but we should still delete the db record
            print(f"Failed to delete storage object {storage_path}: {e}")
            
    # 3. Delete from DB (CASCADE will handle related records)
    try:
        supabase.table("books").delete().eq("id", book_id).eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete book record: {str(e)}")
        
    return {"status": "success", "message": "Book deleted successfully"}
