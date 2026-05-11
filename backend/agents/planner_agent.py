import json
import uuid
from typing import List, Optional
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser

from backend.services.supabase_client import supabase
from backend.services.llm import planner_llm
from backend.agents.state import AgentState

class SessionPlan(BaseModel):
    chunk_indices: List[int] = Field(description="List of chunk indices assigned for this session")
    assigned_words: int = Field(description="Total word count assigned")
    focus_duration_minutes: int = Field(description="Recommended focus duration in minutes (15-60)")
    reason: str = Field(description="Brief reason for this plan based on user history")

parser = PydanticOutputParser(pydantic_object=SessionPlan)

system_prompt = """You are a reading session planner. Given the user's reading history and comprehension scores, decide how many chunks to assign for this session and how many minutes to allocate. Output only JSON: {format_instructions}.
Rules: new users start at 1 chunk / 20 minutes. Increase chunks if avg score > 80%. Reduce if avg score < 50%. Max 3 chunks per session. Min 15 minutes, max 60 minutes."""

prompt_template = ChatPromptTemplate.from_messages([
    ("system", system_prompt),
    ("user", "Reading History: {history}\n\nLast Chunk Index: {last_chunk_index}\nAvailable Next Chunk Word Counts: {next_chunks_words}\nPlan the next session.")
])

async def planner_node(state: AgentState) -> dict:
    user_id = state.get("user_id")
    book_id = state.get("book_id")
    
    # 1. Fetch reading_progress
    progress_resp = supabase.table("reading_progress").select("*").eq("user_id", user_id).eq("book_id", book_id).execute()
    if progress_resp.data:
        progress = progress_resp.data[0]
    else:
        # Defaults for new progress
        progress = {
            "last_chunk_index": -1,
            "chunks_completed": 0,
            "average_score": 0.0,
            "re_read_queue": []
        }
        
    re_read_queue = progress.get("re_read_queue") or []
    
    # 2. Re-read mode
    if re_read_queue:
        chunk_idx = re_read_queue.pop(0)
        # Update queue if progress row exists
        if "id" in progress:
            supabase.table("reading_progress").update({"re_read_queue": re_read_queue}).eq("id", progress["id"]).execute()
        
        # Fetch chunk details
        chunk_resp = supabase.table("chunks").select("word_count, content").eq("book_id", book_id).eq("chunk_index", chunk_idx).execute()
        if not chunk_resp.data:
            return {"error": "Chunk not found in re-read queue"}
            
        chunk_info = chunk_resp.data[0]
        
        plan = SessionPlan(
            chunk_indices=[chunk_idx],
            assigned_words=chunk_info["word_count"],
            focus_duration_minutes=20, # Default for re-read
            reason="Re-reading chunk based on previous poor comprehension performance."
        )
        
        return {
            "session_plan": plan.dict(),
            "chunk_indices": [chunk_idx],
            "chunk_texts": [chunk_info["content"]]
        }

    # 3. Fetch next chunks info (up to 3 chunks max)
    last_chunk_index = progress.get("last_chunk_index", -1)
    
    next_chunks_resp = supabase.table("chunks").select("chunk_index, word_count, content").eq("book_id", book_id).gte("chunk_index", last_chunk_index + 1).order("chunk_index").limit(3).execute()
    
    if not next_chunks_resp.data:
        return {"error": "No more chunks available. Book finished!"}
        
    next_chunks = next_chunks_resp.data
    next_chunks_words = {str(c["chunk_index"]): c["word_count"] for c in next_chunks}
    
    # Fetch recent session context for the planner
    recent_sessions = (
        supabase
        .table("sessions")
        .select("chunk_start_index, chunk_end_index, focus_duration_minutes, actual_duration_minutes")
        .eq("user_id", user_id)
        .eq("book_id", book_id)
        .eq("status", "completed")
        .order("completed_at", desc=True)
        .limit(5)
        .execute()
        .data
    )

    recent_scores = (
        supabase
        .table("test_results")
        .select("total_score, max_score, chunk_index, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
    )
    
    history_string = f"## Recent reading history\nSessions: {json.dumps(recent_sessions)}\nScores: {json.dumps(recent_scores)}"
    
    # 5. Invoke Planner LLM
    chain = prompt_template | planner_llm | parser
    
    plan: SessionPlan = await chain.ainvoke({
        "format_instructions": parser.get_format_instructions(),
        "history": history_string,
        "last_chunk_index": last_chunk_index,
        "next_chunks_words": json.dumps(next_chunks_words)
    })
    
    # Ensure chunk_indices are valid and available
    valid_indices = [idx for idx in plan.chunk_indices if str(idx) in next_chunks_words]
    if not valid_indices:
        valid_indices = [next_chunks[0]["chunk_index"]]
        
    chunk_texts = [c["content"] for c in next_chunks if c["chunk_index"] in valid_indices]
    
    # Update assigned_words to match actual
    actual_assigned_words = sum(next_chunks_words[str(idx)] for idx in valid_indices)
    plan.assigned_words = actual_assigned_words
    plan.chunk_indices = valid_indices
    
    return {
        "session_plan": plan.model_dump() if hasattr(plan, 'model_dump') else plan.dict(),
        "chunk_indices": valid_indices,
        "chunk_texts": chunk_texts
    }

async def plan_session(user_id: str, book_id: str) -> Optional[SessionPlan]:
    from backend.agents.graph import orchestrator_node
    
    initial_state = {
        "user_id": user_id,
        "book_id": book_id,
        "session_id": str(uuid.uuid4()),
        "event_type": "plan_session"
    }
    
    state = initial_state
    try:
        orchestrator_update = await orchestrator_node(state)
        state.update(orchestrator_update)
        
        planner_update = await planner_node(state)
        state.update(planner_update)
        
        plan_dict = state.get("session_plan")
        return SessionPlan(**plan_dict) if plan_dict else None
    except Exception as e:
        print(f"LLM/Orchestrator failed: {e}. Falling back to mock session.")
        
        # Fallback to mock session
        progress_resp = supabase.table("reading_progress").select("*").eq("user_id", user_id).eq("book_id", book_id).execute()
        progress = progress_resp.data[0] if progress_resp.data else {}
        last_chunk_index = progress.get("last_chunk_index", -1)
        
        next_chunks_resp = supabase.table("chunks").select("chunk_index, word_count").eq("book_id", book_id).gte("chunk_index", last_chunk_index + 1).order("chunk_index").limit(1).execute()
        
        if not next_chunks_resp.data:
            return None # Book finished
            
        chunk = next_chunks_resp.data[0]
        
        mock_plan = SessionPlan(
            chunk_indices=[chunk["chunk_index"]],
            assigned_words=chunk["word_count"],
            focus_duration_minutes=20,
            reason="MOCK LLM: LLM rate limit exceeded. Generating default 20-minute session."
        )
        return mock_plan
