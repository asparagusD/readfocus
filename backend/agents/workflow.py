"""Runs the agent workflow (backend/agents/graph.py) for each event the session router handles.

The only callers of the compiled graph. Every run sets the recursion limit:
the longest flow (submit) visits four nodes.
"""

from typing import cast

from backend.agents.graph import workflow
from backend.agents.planner.strategy import SessionPlan
from backend.agents.state import AgentState

RUN_CONFIG = {"recursion_limit": 10}


def _log_errors(session: str, result: dict) -> None:
    for error in result.get("errors") or []:
        print(f"Agent error in session {session}: {error}")


async def run_start(user_id: str, book_id: str) -> SessionPlan | None:
    """start_session: the planner. None if it failed; a plan with no sections if the book is done."""
    try:
        result = await workflow.ainvoke(
            cast(AgentState, {"event": "start_session", "user_id": user_id, "book_id": book_id}), config=RUN_CONFIG
        )
        return SessionPlan(**result["plan"])
    except Exception as error:  # noqa: BLE001 - the router answers 500
        print(f"Planner failed for book {book_id}: {error}")
        return None


def run_finish(session_id: str, user_id: str, book_id: str, chunk_indices: list[int], mix: list | None) -> list[dict]:
    """finish_reading: the test generator stores and returns the session's test. Synchronous."""
    result = workflow.invoke(cast(AgentState, {
        "event": "finish_reading", "session_id": session_id, "user_id": user_id, "book_id": book_id,
        "chunk_indices": chunk_indices, "plan": {"question_mix": mix},
    }), config=RUN_CONFIG)
    _log_errors(session_id, result)
    return result.get("test_questions") or []


async def run_submit(
    session_id: str, user_id: str, book_id: str, chunk_indices: list[int], test_questions: list[dict],
    answers: list[str], time_taken_seconds: int,
) -> dict:
    """submit_answers: grade, move mastery, adapt the pace, plan the next session. Returns the final state."""
    result = await workflow.ainvoke(cast(AgentState, {
        "event": "submit_answers", "session_id": session_id, "user_id": user_id, "book_id": book_id,
        "chunk_indices": chunk_indices, "test_questions": test_questions, "answers": answers,
        "user_answers": answers, "time_taken_seconds": time_taken_seconds,
    }), config=RUN_CONFIG)
    _log_errors(session_id, result)
    return result


async def run_abandon(session_id: str, user_id: str, book_id: str, chunk_indices: list[int]) -> dict | None:
    """abandon: the optimizer takes the stopped session into account. Returns its recommendation."""
    result = await workflow.ainvoke(cast(AgentState, {
        "event": "abandon", "session_id": session_id, "user_id": user_id, "book_id": book_id,
        "chunk_indices": chunk_indices,
    }), config=RUN_CONFIG)
    _log_errors(session_id, result)
    return result.get("pace_recommendation")
