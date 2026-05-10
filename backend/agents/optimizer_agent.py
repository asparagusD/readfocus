import json
from typing import List, Optional
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser

from backend.services.supabase_client import supabase
from backend.services.llm import optimizer_llm
from backend.agents.state import AgentState

class PaceRecommendation(BaseModel):
    focus_duration_minutes: int = Field(description="Recommended focus duration in minutes (15-60)")
    reason: str = Field(description="Reason for the recommendation")

parser = PydanticOutputParser(pydantic_object=PaceRecommendation)

system_prompt = """You are a reading pace optimizer. Given this user's recent reading scores and the chunk multiplier, recommend the focus duration for the next session in minutes (15-60 range). Output ONLY JSON: {format_instructions}.
Be encouraging in your reason."""

prompt_template = ChatPromptTemplate.from_messages([
    ("system", system_prompt),
    ("user", "Recent Test Results:\n{history}\n\nDetermined Chunk Multiplier: {multiplier}\n\nRecommend next focus duration.")
])

async def optimizer_node(state: AgentState) -> dict:
    user_id = state.get("user_id")
    book_id = state.get("book_id")
    chunk_indices = state.get("chunk_indices", [])
    evaluation_result = state.get("evaluation_result", {})
    
    # 1. Fetch last 5 test_results
    history_resp = supabase.table("test_results").select("total_score, max_score, created_at").eq("user_id", user_id).order("created_at", desc=True).limit(5).execute()
    history = history_resp.data or []
    
    # 2. Deterministic rules
    total_score = evaluation_result.get("total_score", 0)
    
    next_chunk_multiplier = 1.0
    re_read_mode = False
    
    prog_resp = supabase.table("reading_progress").select("id, re_read_queue").eq("user_id", user_id).eq("book_id", book_id).execute()
    re_read_queue = prog_resp.data[0]["re_read_queue"] or [] if prog_resp.data else []
    
    if total_score >= 40:
        next_chunk_multiplier = 1.15 # grow
    elif 25 <= total_score <= 39:
        next_chunk_multiplier = 1.0  # stable
    elif 10 <= total_score <= 24:
        next_chunk_multiplier = 0.80 # reduce and re-read
        for idx in chunk_indices:
            if idx not in re_read_queue:
                re_read_queue.append(idx)
    else: # < 10
        next_chunk_multiplier = 0.50 # dramatically reduce and force priority re-read
        for idx in reversed(chunk_indices):
            if idx in re_read_queue:
                re_read_queue.remove(idx)
            # Insert at front of queue to prioritize immediately
            re_read_queue.insert(0, idx)
        re_read_mode = True
        
    # 3. Call Optimizer LLM
    chain = prompt_template | optimizer_llm | parser
    
    try:
        rec: PaceRecommendation = await chain.ainvoke({
            "format_instructions": parser.get_format_instructions(),
            "history": json.dumps(history),
            "multiplier": next_chunk_multiplier
        })
        focus_duration = rec.focus_duration_minutes
        reason = rec.reason
    except Exception as e:
        print(f"Optimizer LLM error: {e}")
        focus_duration = 20
        reason = "Fallback duration."
        
    pace_recommendation_json = {
        "next_chunk_multiplier": next_chunk_multiplier,
        "focus_duration_minutes": focus_duration,
        "reason": reason,
        "re_read_mode": re_read_mode
    }
        
    # 4 & 5. Update reading_progress
    if prog_resp.data:
        prog_id = prog_resp.data[0]["id"]
        
        try:
            supabase.table("reading_progress").update({
                "re_read_queue": re_read_queue,
                "pace_recommendation": pace_recommendation_json
            }).eq("id", prog_id).execute()
        except Exception as db_err:
            print(f"Could not save pace_recommendation. Did you apply the migration? Error: {db_err}")
        
    return {
        "pace_recommendation": pace_recommendation_json
    }

async def optimize_pace(session_id: str, user_id: str, book_id: str, chunk_indices: List[int], evaluation_result: dict) -> Optional[dict]:
    from backend.agents.graph import workflow
    
    initial_state = {
        "session_id": session_id,
        "user_id": user_id,
        "book_id": book_id,
        "chunk_indices": chunk_indices,
        "evaluation_result": evaluation_result,
        "event_type": "optimize_pace"
    }
    
    result = await workflow.ainvoke(initial_state)
    
    if "error" in result and result["error"]:
        print(f"Optimizer Error: {result['error']}")
        return None
        
    return result.get("pace_recommendation")
