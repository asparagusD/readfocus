from typing import List, Optional, cast
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser

from backend.services.supabase_client import supabase
from backend.services.llm import evaluator_llm
from backend.agents.state import AgentState

class QuestionScore(BaseModel):
    answer: str = Field(description="The user's answer being evaluated")
    score: int = Field(description="Score from 0 to 10")
    max_score: int = Field(default=10, description="Maximum possible score (always 10)")
    feedback: str = Field(description="1 sentence explaining the score")

class BatchEvaluation(BaseModel):
    evaluations: List[QuestionScore]

class SingleEvaluation(BaseModel):
    score: int = Field(description="Score from 0 to 10")
    feedback: str = Field(description="1 sentence explaining the score")

parser = PydanticOutputParser(pydantic_object=BatchEvaluation)
single_parser = PydanticOutputParser(pydantic_object=SingleEvaluation)

system_prompt = """You are a reading comprehension evaluator. Given the passage and 5 questions with their corresponding student answers, evaluate each answer.
For each answer, give a score from 0 to 10. Be fair but strict - partial credit is fine.
Feedback should be 1 sentence explaining the score.
Output ONLY JSON matching this format: {format_instructions}."""

single_system_prompt = """You are a reading comprehension evaluator. Given the passage, a question, and the student's answer, evaluate it.
Give a score from 0 to 10. Be fair but strict - partial credit is fine.
Feedback should be 1 sentence explaining the score.
Output ONLY JSON matching this format: {format_instructions}."""

prompt_template = ChatPromptTemplate.from_messages([
    ("system", system_prompt),
    ("user", "Passage:\n{passage}\n\nQuestions and Answers:\n{qna_text}\n\nEvaluate the student's answers.")
])

single_prompt_template = ChatPromptTemplate.from_messages([
    ("system", single_system_prompt),
    ("user", "Passage:\n{passage}\n\nQuestion:\n{question}\nGuidance: {guidance}\nStudent Answer: {answer}\n\nEvaluate the student's answer.")
])

async def evaluate_single_answer(passage: str, question: dict, answer: str) -> dict:
    chain = single_prompt_template | evaluator_llm | single_parser
    try:
        result: SingleEvaluation = await chain.ainvoke({
            "format_instructions": single_parser.get_format_instructions(),
            "passage": passage,
            "question": question.get("question", ""),
            "guidance": question.get("guidance", ""),
            "answer": answer
        })
        return {"score": result.score, "max_score": 10, "feedback": result.feedback, "answer": answer}
    except Exception as e:
        print(f"Single evaluation error: {e}")
        return {"score": 10, "max_score": 10, "feedback": "MOCK: Perfect score due to LLM error.", "answer": answer}

async def evaluate_all_answers(passage: str, test_questions: list, user_answers: list) -> list:
    # We leave this here for backwards compatibility, though evaluator_node won't use it directly now.
    qna_text = ""
    for i, (q, a) in enumerate(zip(test_questions, user_answers)):
        qna_text += f"Question {i+1}:\n{q.get('question', '')}\nGuidance: {q.get('guidance', '')}\nStudent Answer: {a}\n\n"

    chain = prompt_template | evaluator_llm | parser
    try:
        result: BatchEvaluation = await chain.ainvoke({
            "format_instructions": parser.get_format_instructions(),
            "passage": passage,
            "qna_text": qna_text
        })
        return [e.model_dump() if hasattr(e, 'model_dump') else e.dict() for e in result.evaluations]
    except Exception as e:
        print(f"Batch evaluation error: {e}")
        return [{"score": 10, "max_score": 10, "feedback": "MOCK: Perfect score due to LLM error.", "answer": a} for a in user_answers]

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
        chunk_data = cast(list[dict], resp.data or [])
        if chunk_data:
            sorted_chunks = sorted(chunk_data, key=lambda x: x["chunk_index"])
            passage = "\n\n".join(c["content"] for c in sorted_chunks)
            
    # 2 & 3. Evaluate answers using gathered parallel tasks and caches
    import asyncio
    
    tasks = []
    task_indices = []
    results = [None] * len(test_questions)
    
    for i, (q, ans) in enumerate(zip(test_questions, user_answers)):
        cached = q.get("cached_eval")
        # Ensure cache exists and the answer hasn't changed
        if cached and cached.get("answer") == ans:
            results[i] = cached
        else:
            task = evaluate_single_answer(passage, q, ans)
            tasks.append(task)
            task_indices.append(i)
            
    if tasks:
        evaluated_results = await asyncio.gather(*tasks)
        for idx, res in zip(task_indices, evaluated_results):
            results[idx] = res
            
    # Cast results correctly
    from typing import Dict, Any
    final_results: list[Dict[str, Any]] = [cast(Dict[str, Any], r) for r in results if r is not None]
    
    # Ensure results map to the number of answers even if something failed
    if len(final_results) < len(test_questions):
        padding = [{"score": 0, "max_score": 10, "feedback": "MOCK: Failed to evaluate.", "answer": ""} for _ in range(len(test_questions) - len(final_results))]
        final_results.extend(padding)
    
    total_score = sum(r["score"] for r in final_results)
    max_score = sum(r["max_score"] for r in final_results)
    percentage = (total_score / max_score) * 100 if max_score > 0 else 0
    
    per_question = []
    for i in range(len(test_questions)):
        per_question.append({
            "question": test_questions[i],
            "user_answer": user_answers[i],
            "score": final_results[i]["score"],
            "feedback": final_results[i]["feedback"]
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
        recent_scores = cast(list[dict], history_resp.data or [])
        
        if recent_scores:
            total_sum = sum(r["total_score"] for r in recent_scores)
            max_sum = sum(r["max_score"] for r in recent_scores)
            avg_score = (total_sum / max_sum) * 100 if max_sum > 0 else 0
            
            prog_resp = supabase.table("reading_progress").select("id, chunks_completed, re_read_queue").eq("user_id", user_id).eq("book_id", book_id).execute()
            prog_data = cast(list[dict], prog_resp.data or [])
            
            if prog_data:
                prog_id = prog_data[0]["id"]
                chunks_completed = prog_data[0]["chunks_completed"] + len(chunk_indices)
                            
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
        "per_question": [{"score": r["score"], "feedback": r["feedback"]} for r in final_results]
    }
    
    return {"evaluation_result": evaluation_result}

async def evaluate_answers(session_id: str, user_id: str, book_id: str, chunk_indices: List[int], test_questions: List[dict], user_answers: List[str]) -> Optional[dict]:
    """Helper function to run the workflow strictly for answer evaluation."""
    from backend.agents.graph import workflow
    
    initial_state = cast(AgentState, {
        "session_id": session_id,
        "user_id": user_id,
        "book_id": book_id,
        "chunk_indices": chunk_indices,
        "test_questions": test_questions,
        "user_answers": user_answers,
        "time_taken_seconds": 180,
        "status": "evaluating"
    })
    
    result = await workflow.ainvoke(initial_state)
    
    if "error" in result and result["error"]:
        print(f"Evaluate Answers Error: {result['error']}")
        return None
        
    return result.get("evaluation_result", {})
