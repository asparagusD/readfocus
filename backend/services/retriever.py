from langchain_community.vectorstores import SupabaseVectorStore
from backend.services.embeddings import embeddings_client, generate_embedding
from backend.services.supabase_client import supabase

def get_user_retriever(user_id: str, book_id: str):
    """
    Returns a LangChain retriever using SupabaseVectorStore.
    Filters by book_id to only match chunks from the current book.
    """
    vector_store = SupabaseVectorStore(
        client=supabase,
        embedding=embeddings_client,
        table_name="chunks",
        query_name="match_chunks",
    )
    return vector_store.as_retriever(search_kwargs={"k": 3, "filter": {"book_id": book_id}})

async def get_similar_chunks(query_text: str, book_id: str, k: int = 3) -> list[str]:
    """
    Fallback raw RPC call to fetch similar chunks using embeddings.
    """
    query_embedding = await generate_embedding(query_text)
    
    # We must await the RPC execution if using async client, 
    # but the supabase python client is synchronous for RPCs unless using the async version.
    # The existing codebase uses synchronous execution for supabase calls (e.g. .execute())
    # So we execute it synchronously.
    result = supabase.rpc(
        "match_chunks",
        {
            "query_embedding": query_embedding,
            "match_book_id": book_id,
            "match_count": k,
        }
    ).execute()
    
    if result.data:
        return [row["content"] for row in result.data]
    return []
