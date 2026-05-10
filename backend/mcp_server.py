import os
import json
from mcp.server.fastmcp import FastMCP
from supabase import create_client, Client
from dotenv import load_dotenv

# Load env since this runs as a subprocess via stdio
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
if not SUPABASE_SERVICE_KEY:
    SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

mcp = FastMCP("ReadFocus Context MCP")

@mcp.tool()
def get_reading_history(user_id: str, book_id: str, n: int) -> str:
    """Returns the last n reading sessions with scores, chunk indices, and focus duration for this user + book."""
    try:
        resp = supabase.table("test_results").select("session_id, chunk_index, total_score, max_score, time_taken_seconds").eq("user_id", user_id).order("created_at", desc=True).limit(n).execute()
        return json.dumps(resp.data or [])
    except Exception as e:
        return json.dumps({"error": str(e)})

@mcp.tool()
def get_comprehension_trend(user_id: str, book_id: str) -> str:
    """Returns average score per session over time as a list, plus a trend label: 'improving', 'stable', 'declining'."""
    try:
        resp = supabase.table("test_results").select("total_score, max_score").eq("user_id", user_id).order("created_at", desc=False).execute()
        data = resp.data or []
        if not data:
            return json.dumps({"scores": [], "trend": "stable"})
            
        percentages = [(r["total_score"] / r["max_score"])*100 if r["max_score"] else 0 for r in data]
        
        if len(percentages) >= 2:
            first_half = sum(percentages[:len(percentages)//2]) / len(percentages[:len(percentages)//2])
            second_half = sum(percentages[len(percentages)//2:]) / len(percentages[len(percentages)//2:])
            if second_half > first_half + 5:
                trend = "improving"
            elif second_half < first_half - 5:
                trend = "declining"
            else:
                trend = "stable"
        else:
            trend = "stable"
            
        return json.dumps({"scores": percentages, "trend": trend})
    except Exception as e:
        return json.dumps({"error": str(e)})

@mcp.tool()
def get_chunk_context(book_id: str, chunk_index: int, window: int = 2) -> str:
    """Returns the text of chunk_index plus window chunks before and after it, for context around a re-read chunk."""
    try:
        start_idx = max(0, chunk_index - window)
        end_idx = chunk_index + window
        
        resp = supabase.table("chunks").select("chunk_index, content").eq("book_id", book_id).gte("chunk_index", start_idx).lte("chunk_index", end_idx).execute()
        chunks = sorted(resp.data or [], key=lambda x: x["chunk_index"])
        
        context = ""
        for c in chunks:
            prefix = ">> TARGET CHUNK <<" if c['chunk_index'] == chunk_index else ""
            context += f"--- Chunk {c['chunk_index']} {prefix} ---\n{c['content']}\n\n"
            
        return context
    except Exception as e:
        return f"Error: {str(e)}"

if __name__ == "__main__":
    mcp.run()
