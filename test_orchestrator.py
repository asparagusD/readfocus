import asyncio
import uuid
from backend.agents.graph import orchestrator_node

async def test():
    user_id = "dd305a06-2700-4bd1-92a8-001f2c760afe"
    book_id = "f450cf54-3be2-40f4-a977-c002f3e8f230"
    chunk_indices = [0]
    session_id = str(uuid.uuid4())
    
    # Simulate the initial state given to the orchestrator at the start of a session
    state = {
        "user_id": user_id,
        "book_id": book_id,
        "session_id": session_id,
        "chunk_indices": chunk_indices,
        "enriched_context": {}
    }
    
    print("Testing orchestrator_node() with MCP Server...")
    print("This will securely spawn the MCP server as a subprocess, load the custom Supabase tools, and let the LLM gather context.")
    print("Please wait ~10-20 seconds...\n")
    
    try:
        new_state = await orchestrator_node(state)
        print("\n--- Orchestrator Result ---")
        summary = new_state.get("enriched_context", {}).get("orchestrator_summary")
        if summary:
            # Safely print to avoid Windows terminal unicode errors with LLM special characters
            print(summary.encode("ascii", "ignore").decode())
        else:
            print("No summary returned.")
    except Exception as e:
        import traceback
        print(f"Error testing orchestrator:\n{traceback.format_exc()}")

if __name__ == "__main__":
    asyncio.run(test())
