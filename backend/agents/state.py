from typing import TypedDict

class AgentState(TypedDict, total=False):
    user_id: str
    book_id: str
    session_id: str
    status: str  # 'reading', 'testing', 'evaluating', 'completed'
    chunk_indices: list[int]
    chunk_texts: list[str]
    session_plan: dict
    test_questions: list[dict]
    user_answers: list[str]
    evaluation_result: dict
    time_taken_seconds: int
    pace_recommendation: dict
    enriched_context: dict
    error: str
