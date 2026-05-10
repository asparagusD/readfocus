import asyncio
from backend.agents.planner_agent import plan_session

async def test():
    # These are the IDs from your previous test_ingest.py success
    user_id = "dd305a06-2700-4bd1-92a8-001f2c760afe"
    book_id = "f450cf54-3be2-40f4-a977-c002f3e8f230"
    
    print("Testing plan_session()...")
    print("This will fetch your book chunks and use the LLM to generate a session plan.")
    
    plan = await plan_session(user_id, book_id)
    
    print("\n--- Plan Result ---")
    if plan:
        # Compatible with both Pydantic v1 and v2
        if hasattr(plan, 'model_dump_json'):
            print(plan.model_dump_json(indent=2))
        else:
            print(plan.json(indent=2))
    else:
        print("No plan returned.")

if __name__ == "__main__":
    asyncio.run(test())
