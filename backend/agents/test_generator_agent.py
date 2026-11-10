"""Test generator node: the session's test from the question bank. No LLM.

Wraps question_bank.assemble_session_test, whose pure decide is the
assembler's (backend/agents/question_generation/assembler.py), with the
question mix the planner chose. Synchronous: it runs in a worker thread or
a background task.
"""

import time

from backend.agents.state import AgentState, decision
from backend.services import question_bank


def test_generator_node(state: AgentState) -> dict:
    started = time.perf_counter()
    session_id, user_id, book_id = state.get("session_id"), state.get("user_id"), state.get("book_id")
    indices = list(state.get("chunk_indices") or [])
    mix = (state.get("plan") or {}).get("question_mix") or None
    inputs = {"session_id": session_id, "chunk_indices": indices, "question_mix": mix}
    if not (session_id and user_id and book_id and indices):
        return {"errors": ["test_generator: missing session, book or sections"],
                "decisions": [decision("test_generator", started, inputs, {"questions": 0}, "Nothing to assemble.")]}
    questions = question_bank.assemble_session_test(session_id, user_id, book_id, indices, mix)
    strategies = [question.get("strategy") for question in questions]
    reason = f"Picked {len(questions)} questions from the question bank for sections {indices[0] + 1}–{indices[-1] + 1}."
    return {"test_questions": questions, "decisions": [decision(
        "test_generator", started, inputs, {"questions": len(questions), "strategies": strategies}, reason)]}
