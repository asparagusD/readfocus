"""Optimizer node: the I/O around optimizer.pace.decide. No LLM.

Reads the reader's progress and the pace recommendation stored with it
(the previous multiplier, recent percentages, recent question outcomes and
question mix), the book's recent sessions (this one's words and minutes,
and which earlier ones were abandoned) and the profile speed; calls the
pure decide; stores the recommendation with the updated history and the
re-read queue; returns it with one decisions entry.
"""

import time
from typing import cast

from backend.agents import policy
from backend.agents.optimizer.pace import OptimizerInput, QuestionOutcome, decide
from backend.agents.state import AgentState, decision
from backend.services.supabase_client import supabase


def _rows(query) -> list[dict]:
    return cast(list[dict], query.execute().data or [])


async def optimizer_node(state: AgentState) -> dict:
    started = time.perf_counter()
    user_id, book_id, session_id = state.get("user_id") or "", state.get("book_id") or "", state.get("session_id")
    indices = list(state.get("chunk_indices") or [])
    result = state.get("evaluation_result") or {}
    abandoned = state.get("event") == "abandon"  # no test: the stopped session counts, no score does

    progress = (_rows(supabase.table("reading_progress").select("*").eq("user_id", user_id).eq("book_id", book_id))
                or [{}])[0]
    pace = progress.get("pace_recommendation") or {}
    sessions = _rows(supabase.table("sessions").select("id, status, assigned_words, actual_duration_minutes").eq(
        "user_id", user_id).eq("book_id", book_id).order("started_at", desc=True).limit(policy.OPT_ABANDON_WINDOW + 1))
    this = next((row for row in sessions if row["id"] == session_id), {})
    earlier = [row for row in sessions if row["id"] != session_id][:policy.OPT_ABANDON_WINDOW]
    profile = _rows(supabase.table("profiles").select("reading_goal_wpm").eq("user_id", user_id))

    new_outcomes = [
        {"strategy": question.get("strategy"), "score": graded["score"] / graded["max_score"]}
        for question, graded in zip(state.get("test_questions") or [], result.get("per_question") or [])
        if graded.get("max_score")
    ]
    outcomes = (new_outcomes + list(pace.get("recent_outcomes") or []))[:policy.OPT_OUTCOME_HISTORY]
    data = OptimizerInput(
        percentage=None if abandoned else result.get("percentage") or 0, chunk_indices=indices,
        recent_percentages=pace.get("recent_percentages") or [], re_read_queue=progress.get("re_read_queue") or [],
        previous_multiplier=pace.get("next_chunk_multiplier") or 1.0,
        recent_abandoned=[True] * abandoned + [row.get("status") == "abandoned" for row in earlier],
        wpm=profile[0]["reading_goal_wpm"] if profile else None, session_words=this.get("assigned_words") or 0,
        actual_minutes=this.get("actual_duration_minutes"), outcomes=[QuestionOutcome(**o) for o in outcomes],
        previous_mix=pace.get("question_mix"),
        already_read=bool(indices) and max(indices) <= (progress.get("last_chunk_index") if progress.get(
            "last_chunk_index") is not None else -1),
    )
    recommendation = decide(data)
    stored = {
        **recommendation.model_dump(mode="json"), "recent_outcomes": outcomes,
        "recent_percentages": ([] if data.percentage is None else [data.percentage]
                               + data.recent_percentages)[:policy.OPT_ROLLING_TESTS],
    }

    values = {"re_read_queue": recommendation.re_read_queue, "pace_recommendation": stored}
    if progress.get("id"):
        supabase.table("reading_progress").update(values).eq("id", progress["id"]).execute()
    else:  # a book read before C8.4 has no progress row: start one at this session's sections
        supabase.table("reading_progress").insert({
            "user_id": user_id, "book_id": book_id, "last_chunk_index": indices[-1] if indices else -1,
            "chunks_completed": len(indices), **values,
        }).execute()

    return {
        "pace_recommendation": stored,
        "policy_adjustments": stored,
        "decisions": [decision("optimizer", started, {
            "percentage": data.percentage, "recent_percentages": data.recent_percentages,
            "previous_multiplier": data.previous_multiplier, "abandoned": sum(data.recent_abandoned),
            "outcomes": len(outcomes),
        }, {key: stored[key] for key in (
            "band", "next_chunk_multiplier", "focus_duration_minutes", "re_read_mode", "re_read_queue", "rules")},
            recommendation.reason)],
    }
