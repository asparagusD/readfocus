from backend.services.book_ingestor import ingest_book
from backend.services.supabase_client import supabase
import uuid

# 1. Read your test file as bytes
with open("sample.pdf", "rb") as f:
    file_bytes = f.read()

try:
    # 2. Setup Database references 
    print("Setting up dummy user and book in Supabase...")
    
    # Create a dummy user via the Admin Auth API (this fires our profile trigger)
    dummy_email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    user_resp = supabase.auth.admin.create_user({
        "email": dummy_email,
        "password": "password123",
        "email_confirm": True
    })
    user_id = user_resp.user.id
    print(f" -> Created User: {user_id}")
    
    # Create a dummy book entry that we can attach the chunks to
    book_resp = supabase.table("books").insert({
        "user_id": user_id,
        "title": "Sample PDF Test",
        "author": "System",
        "file_type": "pdf",
        "status": "processing"
    }).execute()
    book_id = book_resp.data[0]['id']
    print(f" -> Created Book: {book_id}")

    # 3. Call the ingestor with our valid UUIDs
    print("Starting ingestion... (This may take a minute if the book is large)")
    result = ingest_book(
        file_bytes=file_bytes,
        file_type="pdf",
        book_id=book_id, 
        user_id=user_id,
        target_words=600
    )
    
    print("\nSuccess!")
    print(result)
    
except Exception as e:
    print(f"\nError during ingestion: {e}")
