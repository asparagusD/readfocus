from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase
from backend.agents.planner_agent import plan_session
from backend.agents.test_generator_agent import generate_test
from backend.agents.evaluator_agent import evaluate_answers
from backend.agents.optimizer_agent import optimize_pace

router = APIRouter()

class StartSessionRequest(BaseModel):
    book_id: str

class FinishReadingRequest(BaseModel):
    actual_duration_minutes: int

class SubmitAnswersRequest(BaseModel):
    answers: List[str]
    time_taken_seconds: int

@router.post("/start")
async def start_session(req: StartSessionRequest, user_id: str = Depends(get_current_user)):
    # 1. Run planner agent
    plan = await plan_session(user_id, req.book_id)
    if not plan:
        raise HTTPException(status_code=500, detail="Planner failed to generate a session plan.")
        
    chunk_indices = plan.get("chunk_indices", [])
    if not chunk_indices:
        raise HTTPException(status_code=400, detail="No more chunks available to read.")
        
    # 2. Fetch chunk content
    resp = supabase.table("chunks").select("chunk_index, content, word_count").eq("book_id", req.book_id).in_("chunk_index", chunk_indices).execute()
    chunks_data = sorted(resp.data or [], key=lambda x: x["chunk_index"])
    
    # 3. Create session row
    session_resp = supabase.table("sessions").insert({
        "user_id": user_id,
        "book_id": req.book_id,
        "chunk_start_index": chunk_indices[0],
        "chunk_end_index": chunk_indices[-1],
        "assigned_words": plan.get("assigned_words", 0),
        "focus_duration_minutes": plan.get("focus_duration_minutes", 20),
        "status": "reading",
        "started_at": datetime.utcnow().isoformat()
    }).execute()
    
    if not session_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create session.")
        
    session_id = session_resp.data[0]["id"]
    
    return {
        "session_id": session_id,
        "chunk_indices": chunk_indices,
        "focus_duration_minutes": plan.get("focus_duration_minutes", 20),
        "reason": plan.get("reason", ""),
        "chunks": chunks_data
    }

@router.post("/{session_id}/finish-reading")
async def finish_reading(session_id: str, req: FinishReadingRequest, user_id: str = Depends(get_current_user)):
    # 1. Fetch session
    sess_resp = supabase.table("sessions").select("book_id, chunk_start_index, chunk_end_index").eq("id", session_id).eq("user_id", user_id).execute()
    if not sess_resp.data:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    book_id = sess_resp.data[0]["book_id"]
    start_idx = sess_resp.data[0]["chunk_start_index"]
    end_idx = sess_resp.data[0]["chunk_end_index"]
    chunk_indices = list(range(start_idx, end_idx + 1))
    
    # 2. Update session status
    supabase.table("sessions").update({
        "status": "testing",
        "actual_duration_minutes": req.actual_duration_minutes
    }).eq("id", session_id).execute()
    
    # 3. Call generate_test
    questions_pydantic = await generate_test(session_id, chunk_indices, book_id)
    if not questions_pydantic:
        raise HTTPException(status_code=500, detail="Failed to generate test.")
        
    test_questions = [q.model_dump() if hasattr(q, 'model_dump') else q.dict() for q in questions_pydantic]
    
    # Save test questions to DB so we can grade them later
    try:
        supabase.table("sessions").update({
            "test_questions": test_questions
        }).eq("id", session_id).execute()
    except Exception as e:
        print(f"Migration missing? Error: {e}")
    
    # 4. Filter guidance out for the frontend
    filtered_questions = [{"question": q["question"], "type": q["type"]} for q in test_questions]
    
    return {
        "test_id": session_id,
        "questions": filtered_questions
    }

@router.post("/{session_id}/submit-answers")
async def submit_answers(session_id: str, req: SubmitAnswersRequest, user_id: str = Depends(get_current_user)):
    # 1. Fetch session and questions
    sess_resp = supabase.table("sessions").select("book_id, chunk_start_index, chunk_end_index, test_questions").eq("id", session_id).eq("user_id", user_id).execute()
    if not sess_resp.data:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    book_id = sess_resp.data[0]["book_id"]
    start_idx = sess_resp.data[0]["chunk_start_index"]
    end_idx = sess_resp.data[0]["chunk_end_index"]
    chunk_indices = list(range(start_idx, end_idx + 1))
    test_questions = sess_resp.data[0].get("test_questions", [])
    
    if not test_questions:
        raise HTTPException(status_code=400, detail="No test questions found. Did you call finish-reading?")
        
    # 2. Call evaluator
    eval_result = await evaluate_answers(
        session_id=session_id,
        user_id=user_id,
        book_id=book_id,
        chunk_indices=chunk_indices,
        test_questions=test_questions,
        user_answers=req.answers
    )
    if not eval_result:
        raise HTTPException(status_code=500, detail="Failed to evaluate answers.")
        
    # 3. Call optimizer
    pace_rec = await optimize_pace(
        session_id=session_id,
        user_id=user_id,
        book_id=book_id,
        chunk_indices=chunk_indices,
        evaluation_result=eval_result
    )
    
    # 4. Update session
    supabase.table("sessions").update({
        "status": "completed",
        "completed_at": datetime.utcnow().isoformat()
    }).eq("id", session_id).execute()
    
    return {
        "total_score": eval_result.get("total_score"),
        "max_score": eval_result.get("max_score"),
        "percentage": eval_result.get("percentage"),
        "per_question": eval_result.get("per_question"),
        "pace_recommendation": pace_rec
    }

@router.post("/{session_id}/abandon")
async def abandon_session(session_id: str, user_id: str = Depends(get_current_user)):
    resp = supabase.table("sessions").update({
        "status": "abandoned",
        "completed_at": datetime.utcnow().isoformat()
    }).eq("id", session_id).eq("user_id", user_id).execute()
    
    if not resp.data:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"status": "abandoned"}

@router.get("/{session_id}")
async def get_session(session_id: str, user_id: str = Depends(get_current_user)):
    sess_resp = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).execute()
    if not sess_resp.data:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    session = sess_resp.data[0]
    
    if session["status"] == "completed":
        test_resp = supabase.table("test_results").select("*").eq("session_id", session_id).execute()
        if test_resp.data:
            session["test_results"] = test_resp.data[0]
            
    return session
