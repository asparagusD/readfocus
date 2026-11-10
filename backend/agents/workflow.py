"""Runs the agent workflow (backend/agents/graph.py) for each event the session router handles.

The only callers of the compiled graph: each runner invokes it once with
its event and a recursion limit (the longest flow, submit, visits four
nodes, which LangGraph counts as five steps with the input) and returns
the final state. save_decisions stores a run's
decisions entries in agent_decisions (migration 009) in one insert; the
router calls it after the response, and a failure is logged, never raised.
"""

from typing import cast
from uuid import uuid4

from backend.agents.graph import workflow
from backend.agents.planner.strategy import SessionPlan
from backend.agents.state import AgentState
from backend.services.supabase_client import supabase

RUN_CONFIG = {"recursion_limit": 10}
DECISION_KEYS = ("agent", "inputs_summary", "output_summary", "reason", "duration_ms")


def _log_errors(session: str | None, result: dict) -> None:
    for error in result.get("errors") or []:
        print(f"Agent error in session {session}: {error}")


async def run_start(user_id: str, book_id: str) -> tuple[SessionPlan | None, dict]:
    """start_session: the planner. The plan is None if it failed, and has no sections if the book is done."""
    try:
        result = await workflow.ainvoke(
            cast(AgentState, {"event": "start_session", "user_id": user_id, "book_id": book_id}), config=RUN_CONFIG
        )
        return SessionPlan(**result["plan"]), result
    except Exception as error:  # noqa: BLE001 - the router answers 500
        print(f"Planner failed for book {book_id}: {error}")
        return None, {}


def run_finish(session_id: str, user_id: str, book_id: str, chunk_indices: list[int], mix: list | None) -> dict:
    """finish_reading: the test generator stores the session's test (in `test_questions`). Synchronous."""
    result = workflow.invoke(cast(AgentState, {
        "event": "finish_reading", "session_id": session_id, "user_id": user_id, "book_id": book_id,
        "chunk_indices": chunk_indices, "plan": {"question_mix": mix},
    }), config=RUN_CONFIG)
    _log_errors(session_id, result)
    return result


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


async def run_abandon(session_id: str, user_id: str, book_id: str, chunk_indices: list[int]) -> dict:
    """abandon: the optimizer takes the stopped session into account. Returns the final state."""
    result = await workflow.ainvoke(cast(AgentState, {
        "event": "abandon", "session_id": session_id, "user_id": user_id, "book_id": book_id,
        "chunk_indices": chunk_indices,
    }), config=RUN_CONFIG)
    _log_errors(session_id, result)
    return result


def decision_rows(state: dict, session_id: str | None = None) -> list[dict]:
    """One agent_decisions row per decisions entry of a run, numbered in order under one run id."""
    run_id = str(uuid4())
    return [
        {
            "user_id": state.get("user_id"), "book_id": state.get("book_id"),
            "session_id": session_id or state.get("session_id"), "run_id": run_id, "event": state.get("event"),
            "step": step, **{key: entry.get(key) for key in DECISION_KEYS},
        }
        for step, entry in enumerate(state.get("decisions") or [], start=1)
    ]


def save_decisions(state: dict, session_id: str | None = None) -> None:
    """Store a run's decisions; `session_id` names the session when the run made it (start)."""
    rows = decision_rows(state, session_id)
    if not rows:
        return
    try:
        supabase.table("agent_decisions").insert(rows).execute()
    except Exception as error:  # noqa: BLE001 - the audit trail never fails a request
        print(f"Saving agent decisions failed for session {rows[0]['session_id']}: {error}")
