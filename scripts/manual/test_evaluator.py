import asyncio
import uuid
import json
from backend.agents.test_generator_agent import generate_test
from backend.agents.evaluator_agent import evaluate_answers

async def test():
    # Setup test IDs from your database
    user_id = "dd305a06-2700-4bd1-92a8-001f2c760afe"
    book_id = "f450cf54-3be2-40f4-a977-c002f3e8f230"
    chunk_indices = [0]
    session_id = str(uuid.uuid4())
    
    print("1. Generating test questions (this may take ~15s)...")
    questions_pydantic = await generate_test(session_id, chunk_indices, book_id)
    
    if not questions_pydantic:
        print("Failed to generate test questions. Cannot proceed to evaluator.")
        return
        
    # Convert Pydantic models to dicts for the state
    test_questions = [q.model_dump() if hasattr(q, 'model_dump') else q.dict() for q in questions_pydantic]
    
    print("\n2. Mocking user answers...")
    # We provide a mix of good and bad answers to see how the LLM grades them
    user_answers = [
        "The bands are 1.57 GHz and 2.45 GHz.", # Good answer for factual
        "I don't remember.", # Bad answer
        "They used genetic algorithms and simulated annealing.", # Good answer
        "It provides fast predictions without full simulations.", # Good answer
        "The paper is about using an AI surrogate model combined with optimization to design antennas faster." # Good summary
    ]
    
    print("\n3. Testing evaluate_answers() concurrently (this may take ~15s)...")
    eval_result = await evaluate_answers(
        session_id=session_id,
        user_id=user_id,
        book_id=book_id,
        chunk_indices=chunk_indices,
        test_questions=test_questions,
        user_answers=user_answers
    )
    
    print("\n--- Evaluation Result ---")
    if eval_result:
        print(json.dumps(eval_result, indent=2))
        
        pct = eval_result.get("percentage", 100)
        if pct < 50:
            print(f"\nFinal Score: {pct}%. Because it's < 50%, this chunk was just pushed to the re-read queue in Supabase!")
        else:
            print(f"\nFinal Score: {pct}%. Score was high enough to avoid the re-read queue.")
    else:
        print("No evaluation returned.")

if __name__ == "__main__":
    asyncio.run(test())
