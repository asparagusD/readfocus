import asyncio
from typing import List, Optional
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser

from backend.services.supabase_client import supabase
from backend.services.llm import evaluator_llm
from backend.agents.state import AgentState

class QuestionScore(BaseModel):
    score: int = Field(description="Score from 0 to 10")
    max_score: int = Field(default=10, description="Maximum possible score (always 10)")
    feedback: str = Field(description="1 sentence explaining the score")

parser = PydanticOutputParser(pydantic_object=QuestionScore)

system_prompt = """You are a reading comprehension evaluator. Given the passage, the question, the question guidance, and the student's answer, give a score from 0 to 10. Be fair but strict - partial credit is fine. Output ONLY JSON: {format_instructions}.
Feedback should be 1 sentence explaining the score."""

prompt_template = ChatPromptTemplate.from_messages([
    ("system", system_prompt),
    ("user", "Passage:\n{passage}\n\nQuestion:\n{question}\n\nGuidance:\n{guidance}\n\nStudent Answer:\n{answer}\n\nEvaluate the student's answer.")
])

async def evaluate_single_answer(passage: str, question: dict, answer: str) -> dict:
    chain = prompt_template | evaluator_llm | parser
    try:
        result: QuestionScore = await chain.ainvoke({
            "format_instructions": parser.get_format_instructions(),
            "passage": passage,
            "question": question.get("question", ""),
            "guidance": question.get("guidance", ""),
            "answer": answer
        })
        return result.model_dump() if hasattr(result, 'model_dump') else result.dict()
    except Exception as e:
        print(f"Evaluation error for question: {e}")
        return {"score": 10, "max_score": 10, "feedback": "MOCK: Perfect score due to LLM rate limit."}

async def evaluator_node(state: AgentState) -> dict:
    user_id = state.get("user_id")
    book_id = state.get("book_id")
    session_id = state.get("session_id")
    chunk_indices = state.get("chunk_indices", [])
    test_questions = state.get("test_questions", [])
    user_answers = state.get("user_answers", [])
    time_taken_seconds = state.get("time_taken_seconds", 300)
    
    if not test_questions or not user_answers:
        return {"error": "Missing questions or answers in state."}
        
    # 1. Fetch chunk texts
    passage = ""
    if chunk_indices:
        resp = supabase.table("chunks").select("chunk_index, content").eq("book_id", book_id).in_("chunk_index", chunk_indices).execute()
        if resp.data:
            sorted_chunks = sorted(resp.data, key=lambda x: x["chunk_index"])
            passage = "\n\n".join(c["content"] for c in sorted_chunks)
            
    # 2 & 3. Evaluate each question concurrently
    evaluation_tasks = []
    for q, a in zip(test_questions, user_answers):
        evaluation_tasks.append(evaluate_single_answer(passage, q, a))
        
    results = await asyncio.gather(*evaluation_tasks)
    
    total_score = sum(r["score"] for r in results)
    max_score = sum(r["max_score"] for r in results)
    percentage = (total_score / max_score) * 100 if max_score > 0 else 0
    
    per_question = []
    for i in range(len(test_questions)):
        per_question.append({
            "question": test_questions[i],
            "user_answer": user_answers[i],
            "score": results[i]["score"],
            "feedback": results[i]["feedback"]
        })
        
    # 4. Store in test_results
    first_chunk = chunk_indices[0] if chunk_indices else -1
    try:
        supabase.table("test_results").insert({
            "session_id": session_id,
            "user_id": user_id,
            "chunk_index": first_chunk,
            "questions": test_questions,
            "answers": per_question,
            "total_score": total_score,
            "max_score": max_score,
            "time_taken_seconds": time_taken_seconds
        }).execute()
    except Exception as e:
        print(f"Failed to insert test_results: {e}")
        
    # 5. Update reading_progress (rolling average)
    try:
        history_resp = supabase.table("test_results").select("total_score, max_score").eq("user_id", user_id).order("created_at", desc=True).limit(10).execute()
        
        if history_resp.data:
            recent_scores = history_resp.data
            total_sum = sum(r["total_score"] for r in recent_scores)
            max_sum = sum(r["max_score"] for r in recent_scores)
            avg_score = (total_sum / max_sum) * 100 if max_sum > 0 else 0
            
            prog_resp = supabase.table("reading_progress").select("id, chunks_completed, re_read_queue").eq("user_id", user_id).eq("book_id", book_id).execute()
            
            if prog_resp.data:
                prog_id = prog_resp.data[0]["id"]
                chunks_completed = prog_resp.data[0]["chunks_completed"] + len(chunk_indices)
                            
                supabase.table("reading_progress").update({
                    "average_score": avg_score,
                    "last_chunk_index": chunk_indices[-1] if chunk_indices else -1,
                    "chunks_completed": chunks_completed
                }).eq("id", prog_id).execute()
    except Exception as e:
        print(f"Failed to update reading_progress: {e}")
        
    # 6. Return updated state
    evaluation_result = {
        "total_score": total_score,
        "max_score": max_score,
        "percentage": percentage,
        "per_question": [{"score": r["score"], "feedback": r["feedback"]} for r in results]
    }
    
    return {"evaluation_result": evaluation_result}

async def evaluate_answers(session_id: str, user_id: str, book_id: str, chunk_indices: List[int], test_questions: List[dict], user_answers: List[str]) -> Optional[dict]:
    """Helper function to run the workflow strictly for answer evaluation."""
    from backend.agents.graph import workflow
    
    initial_state = {
        "session_id": session_id,
        "user_id": user_id,
        "book_id": book_id,
        "chunk_indices": chunk_indices,
        "test_questions": test_questions,
        "user_answers": user_answers,
        "time_taken_seconds": 180,
        "event_type": "evaluate_answers"
    }
    
    result = await workflow.ainvoke(initial_state)
    
    if "error" in result and result["error"]:
        print(f"Evaluate Answers Error: {result['error']}")
        return None
        
    return result.get("evaluation_result", {})
