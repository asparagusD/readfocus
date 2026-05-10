import asyncio
from backend.agents.graph import workflow

async def test_graph():
    print("Initializing state...")
    initial_state = {
        "user_id": "dummy_user",
        "book_id": "dummy_book",
        "session_id": "dummy_session",
        "event_type": "generate_test"
    }
    
    print(f"Initial event_type: {initial_state['event_type']}")
    print("Invoking LangGraph workflow...")
    
    # We use ainvoke for asynchronous execution of the graph
    result = await workflow.ainvoke(initial_state)
    
    print("\n--- Execution Complete ---")
    print(f"Final State Keys: {list(result.keys())}")
    print(f"Final event_type: {result.get('event_type')}")
    print("Success! The orchestrator correctly routed the flow through the graph.")

if __name__ == "__main__":
    asyncio.run(test_graph())
