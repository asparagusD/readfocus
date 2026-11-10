import asyncio
import uuid
import json
from backend.agents.optimizer_agent import optimize_pace

async def test():
    # Setup test IDs
    user_id = "dd305a06-2700-4bd1-92a8-001f2c760afe"
    book_id = "f450cf54-3be2-40f4-a977-c002f3e8f230"
    chunk_indices = [0]
    session_id = str(uuid.uuid4())
    
    # We pass the exact evaluation result from our previous failed test!
    # Our previous test got 7 points out of 50 (14%).
    evaluation_result = {
        "total_score": 7,
        "max_score": 50,
        "percentage": 14.0,
        "per_question": []
    }
    
    print("Testing optimize_pace() using the previous 14% failure evaluation...")
    print("This will check your history, trigger deterministic pace sizing, and use the LLM to recommend the next focus duration.")
    
    pace = await optimize_pace(
        session_id=session_id,
        user_id=user_id,
        book_id=book_id,
        chunk_indices=chunk_indices,
        evaluation_result=evaluation_result
    )
    
    print("\n--- Optimizer Result ---")
    if pace:
        print(json.dumps(pace, indent=2))
        
        # Verify the deterministic rules triggered successfully
        if pace.get('re_read_mode') and pace.get('next_chunk_multiplier') == 0.5:
            print("\nSUCCESS: Because the raw score was < 10 (7/50), it slashed the multiplier to 0.5x and activated re_read_mode exactly as designed!")
        else:
            print("\nWARNING: The deterministic rules did not trigger correctly.")
    else:
        print("No pace recommendation returned.")

if __name__ == "__main__":
    asyncio.run(test())
