from typing import TypedDict, List, Dict, Optional

class AgentState(TypedDict, total=False):
    user_id: str
    book_id: str
    session_id: str
    event_type: str  # 'plan_session', 'generate_test', 'evaluate_answers', 'optimize_pace'
    chunk_indices: list[int]
    chunk_texts: list[str]
    session_plan: dict
    test_questions: list[dict]
    user_answers: list[str]
    evaluation_result: dict
    pace_recommendation: dict
    enriched_context: dict
    error: str
