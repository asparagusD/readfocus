from typing import List, Optional
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser

from backend.services.supabase_client import supabase
from backend.services.llm import test_llm
from backend.agents.state import AgentState

from backend.services.retriever import get_similar_chunks

class TestQuestion(BaseModel):
    question: str = Field(description="The comprehension question text")
    type: str = Field(description="Question type: 'factual', 'inference', or 'summary'")
    guidance: str = Field(description="A 1-sentence hint about what a good answer would include")

class TestQuestionList(BaseModel):
    questions: List[TestQuestion]

parser = PydanticOutputParser(pydantic_object=TestQuestionList)

async def test_generator_node(state: AgentState) -> dict:
    book_id = state.get("book_id")
    chunk_indices = state.get("chunk_indices", [])
    
    if not book_id or not chunk_indices:
        return {"error": "Missing book_id or chunk_indices in state."}
    
    # 1. Fetch chunk texts
    passage = ""
    # Supabase allows .in_() for array filtering
    resp = supabase.table("chunks").select("chunk_index, content").eq("book_id", book_id).in_("chunk_index", chunk_indices).execute()
    
    if resp.data:
        # Sort them to maintain correct reading order
        sorted_chunks = sorted(resp.data, key=lambda x: x["chunk_index"])
        passage = "\n\n".join(c["content"] for c in sorted_chunks)
            
    if not passage:
        return {"error": "No passage content found for the given chunks."}
        
    # 2. RAG Retrieval for related context
    try:
        similar_chunks_list = await get_similar_chunks(passage, book_id, k=3)
        # Filter out the exact same chunks just in case they match
        similar_chunks_list = [c for c in similar_chunks_list if c.strip() != passage.strip()]
        related_chunks_str = "\n---\n".join(similar_chunks_list)
    except Exception as e:
        print(f"RAG failed: {e}")
        related_chunks_str = ""
        
    related_context_msg = ""
    if related_chunks_str:
        related_context_msg = f"For inference and summary questions, you may also reference how this passage connects to earlier sections the user has read: \n{related_chunks_str}"

    system_prompt = f"""You are a reading comprehension test designer. Given the passage below, generate exactly 5 questions.
Format:
- 3 factual recall questions (directly answerable from the text)
- 1 inference question (requires reading between the lines)
- 1 summary question (asks the user to summarize the main idea in 2-3 sentences)

Output ONLY JSON matching this format: {{format_instructions}}.
Do not make questions that require knowledge outside the passage.
{related_context_msg}"""

    prompt_template = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "Passage:\n\n{passage}\n\nGenerate the 5 questions.")
    ])

    # 3. Invoke LLM
    chain = prompt_template | test_llm | parser
    
    try:
        result: TestQuestionList = await chain.ainvoke({
            "format_instructions": parser.get_format_instructions(),
            "passage": passage
        })
        
        # 4. Convert to list of dicts for state
        questions_dict = [q.model_dump() if hasattr(q, 'model_dump') else q.dict() for q in result.questions]
        
        return {"test_questions": questions_dict}
        
    except Exception as e:
        print(f"Test Generator LLM failed: {str(e)}. Falling back to mock questions.")
        mock_questions = [
            {"question": "What is the main topic of the passage you just read?", "type": "factual", "guidance": "Should mention the primary subject of the text."},
            {"question": "List two key details mentioned in the text.", "type": "factual", "guidance": "Should list any two distinct facts from the passage."},
            {"question": "What happened first in the sequence of events described?", "type": "factual", "guidance": "Should identify the chronological beginning."},
            {"question": "Based on the text, what can you infer about the author's purpose?", "type": "inference", "guidance": "Should deduce the underlying reason for writing."},
            {"question": "Summarize the central message in one or two sentences.", "type": "summary", "guidance": "Should provide a concise overview of the core idea."}
        ]
        return {"test_questions": mock_questions}

async def generate_test(session_id: str, chunk_indices: List[int], book_id: str) -> Optional[List[TestQuestion]]:
    """Helper function to run the workflow strictly for test generation."""
    from backend.agents.graph import workflow
    
    initial_state = {
        "session_id": session_id,
        "book_id": book_id,
        "chunk_indices": chunk_indices,
        "event_type": "generate_test"
    }
    
    result = await workflow.ainvoke(initial_state)
    
    if "error" in result and result["error"]:
        print(f"Generate Test Error: {result['error']}")
        return None
        
    questions_dict = result.get("test_questions", [])
    return [TestQuestion(**q) for q in questions_dict] if questions_dict else None
