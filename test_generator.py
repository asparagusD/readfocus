import asyncio
import uuid
from backend.agents.test_generator_agent import generate_test

async def test():
    # Setup test IDs from your previous database entries
    book_id = "f450cf54-3be2-40f4-a977-c002f3e8f230"
    chunk_indices = [0]
    session_id = str(uuid.uuid4())
    
    print("Testing generate_test()...")
    print("Fetching chunks and using LLM to generate 5 comprehension questions...")
    
    questions = await generate_test(session_id, chunk_indices, book_id)
    
    print("\n--- Test Generator Result ---")
    if questions:
        for i, q in enumerate(questions):
            print(f"\nQ{i+1} [{q.type.upper()}]: {q.question}")
            print(f" -> Guidance: {q.guidance}")
    else:
        print("Failed to generate test questions.")

if __name__ == "__main__":
    asyncio.run(test())
