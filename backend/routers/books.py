import uuid
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.services.book_ingestor import ingest_book
from backend.services.supabase_client import supabase

router = APIRouter()
security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Extracts the user_id from the Supabase JWT Bearer token.
    """
    token = credentials.credentials
    
    # --- Local Dev Bypass for easy testing ---
    # If you pass a raw UUID instead of a JWT token, we'll accept it as the user_id.
    # This saves you from having to manually generate JWTs while testing the API!
    if len(token) == 36 and token.count("-") == 4:
        return token
    # -----------------------------------------
    
    try:
        user_resp = supabase.auth.get_user(token)
        if user_resp and user_resp.user:
            return user_resp.user.id
        else:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication error: {str(e)}")

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
        
    # 5. Launch ingest_book as BackgroundTask
    background_tasks.add_task(
        ingest_book,
        file_bytes=file_bytes,
        file_type=ext,
        book_id=book_id,
        user_id=user_id,
        target_words=600
    )
    
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
        
    book = book_resp.data[0]
    
    progress_resp = supabase.table("reading_progress").select("*").eq("book_id", book_id).eq("user_id", user_id).execute()
    
    book["reading_progress"] = progress_resp.data[0] if progress_resp.data else None
    
    return book

@router.get("/{book_id}/status")
async def get_book_status(book_id: str, user_id: str = Depends(get_current_user)):
    resp = supabase.table("books").select("status, total_chunks").eq("id", book_id).eq("user_id", user_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Book not found")
        
    return resp.data[0]
