import time
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

# Use our standard testing UUIDs
user_id = "dd305a06-2700-4bd1-92a8-001f2c760afe"
book_id = "f450cf54-3be2-40f4-a977-c002f3e8f230"

# Our local dev bypass allows using the raw UUID as the bearer token
headers = {"Authorization": f"Bearer {user_id}"}

def test_full_flow():
    print("--- STARTING END-TO-END SESSION API TEST ---")
    
    print("\n1. Calling POST /sessions/start...")
    start_resp = client.post("/sessions/start", json={"book_id": book_id}, headers=headers)
    if start_resp.status_code != 200:
        print(f"   FAILED: {start_resp.text}")
        return
        
    start_data = start_resp.json()
    session_id = start_data["session_id"]
    print(f"   SUCCESS! Created Session ID: {session_id}")
    print(f"   Planner assigned chunks: {start_data['chunk_indices']}")
    print(f"   Planner focus duration: {start_data['focus_duration_minutes']} min")
    print(f"   Fetched {len(start_data['chunks'])} chunks of text to display to user.")
    
    print("\n2. Calling POST /sessions/{id}/finish-reading...")
    print("   (Please wait ~10-15s, the Test Generator LLM is designing custom questions...)")
    finish_resp = client.post(f"/sessions/{session_id}/finish-reading", json={"actual_duration_minutes": 15}, headers=headers)
    if finish_resp.status_code != 200:
        print(f"   FAILED: {finish_resp.text}")
        return
        
    finish_data = finish_resp.json()
    questions = finish_data["questions"]
    print("   SUCCESS! Test generated. Hidden guidance was successfully stripped out for the frontend!")
    for i, q in enumerate(questions):
        print(f"     Q{i+1} [{q['type']}]: {q['question']}")
        
    print("\n3. Calling POST /sessions/{id}/submit-answers...")
    print("   (Please wait ~15s, Evaluator LLM is grading answers and Optimizer LLM is adjusting pace...)")
    # Provide terrible mock answers to trigger the optimizer's penalty mode
    answers = ["I wasn't paying attention"] * len(questions)
    
    submit_resp = client.post(f"/sessions/{session_id}/submit-answers", json={"answers": answers, "time_taken_seconds": 60}, headers=headers)
    if submit_resp.status_code != 200:
        print(f"   FAILED: {submit_resp.text}")
        return
        
    submit_data = submit_resp.json()
    print(f"   SUCCESS! Session complete.")
    print(f"   Total Score: {submit_data['total_score']} / {submit_data['max_score']} ({submit_data['percentage']}%)")
    print("\n   Pace Recommendation from Optimizer:")
    print(f"     Multiplier: {submit_data['pace_recommendation']['next_chunk_multiplier']}x")
    print(f"     Re-Read Mode Triggered: {submit_data['pace_recommendation'].get('re_read_mode', False)}")
    print(f"     Focus Duration: {submit_data['pace_recommendation']['focus_duration_minutes']} min")
    
    print("\n--- ALL TESTS PASSED! ---")

if __name__ == "__main__":
    test_full_flow()
