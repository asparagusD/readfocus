"""Planner node: the I/O around planner.strategy.decide. No LLM.

Reads the reader's progress (creating the row on a first session, with
nothing read yet), the profile speed, the candidate sections and their
concepts, the reader's mastery and each section's question difficulty;
calls the pure decide; pops a re-read from the queue when a session starts
with it (a plan made after a submit is a preview); and returns the plan with
one decisions entry. The optimizer's last pace_recommendation supplies
the multiplier, the reading speed it assumed and the recent score.
"""

import time
from datetime import UTC, datetime
from typing import cast

from backend.agents import policy
from backend.agents.planner.strategy import (
    ChunkInfo,
    ConceptState,
    PaceHint,
    PlannerInput,
    decide,
)
from backend.agents.state import AgentState, decision
from backend.services.supabase_client import fetch_all, supabase


def _rows(query) -> list[dict]:
    return cast(list[dict], query.execute().data or [])


def load_progress(user_id: str, book_id: str) -> dict:
    """The reader's progress row for the book, created on the first session (-1: nothing read)."""
    rows = _rows(supabase.table("reading_progress").select("*").eq("user_id", user_id).eq("book_id", book_id))
    if rows:
        return rows[0]
    row = {"user_id": user_id, "book_id": book_id, "last_chunk_index": -1, "chunks_completed": 0, "re_read_queue": []}
    return (_rows(supabase.table("reading_progress").insert(row)) or [row])[0]


async def build_input(user_id: str, book_id: str, progress: dict, now: datetime) -> PlannerInput:
    pace = progress.get("pace_recommendation") or {}
    last = progress.get("last_chunk_index")
    last = -1 if last is None else last
    upto = last + policy.PLANNER_MAX_CHUNKS
    results = await fetch_all(  # independent reads, one round trip (issue 28)
        supabase.table("chunks").select("chunk_index, word_count").eq("book_id", book_id).lte(
            "chunk_index", upto).order("chunk_index"),
        supabase.table("concepts").select("concept_key, label, chunk_indices").eq("user_id", user_id).eq(
            "book_id", book_id),
        supabase.table("user_concept_mastery").select("concept_key, mastery, attempts, correct, next_review").eq(
            "user_id", user_id).eq("book_id", book_id),
        supabase.table("question_bank").select("chunk_index, difficulty").eq("user_id", user_id).eq(
            "book_id", book_id).lte("chunk_index", upto),
        supabase.table("profiles").select("reading_goal_wpm").eq("user_id", user_id),
    )
    for fetched in results:
        if isinstance(fetched, Exception):
            raise fetched
    chunks, concepts, mastery, bank, profile = results
    wpm = pace.get("reading_wpm") or (profile[0]["reading_goal_wpm"] if profile else None)

    def difficulty(index: int) -> float | None:
        values = [row["difficulty"] for row in bank if row["chunk_index"] == index and row.get("difficulty") is not None]
        return sum(values) / len(values) if values else None

    labels = {row["concept_key"]: row.get("label") or "" for row in concepts}
    return PlannerInput(
        now=now, last_chunk_index=last, re_read_queue=progress.get("re_read_queue") or [], wpm=int(wpm) if wpm else None,
        recent_percentages=[pace["rolling_percentage"]] if pace.get("rolling_percentage") is not None else [],
        pace=PaceHint(next_chunk_multiplier=pace.get("next_chunk_multiplier") or 1.0,
                      focus_duration_minutes=pace.get("focus_duration_minutes")) if pace else None,
        chunks=[ChunkInfo(index=chunk["chunk_index"], word_count=chunk["word_count"] or 0, difficulty=difficulty(
            chunk["chunk_index"]), concept_keys=[row["concept_key"] for row in concepts if chunk["chunk_index"] in (
                row.get("chunk_indices") or [])]) for chunk in chunks],
        concepts=[ConceptState(**row, label=labels.get(row["concept_key"], "")) for row in mastery],
    )


async def planner_node(state: AgentState) -> dict:
    started = time.perf_counter()
    user_id, book_id = state.get("user_id") or "", state.get("book_id") or ""
    progress = load_progress(user_id, book_id)
    data = await build_input(user_id, book_id, progress, datetime.now(UTC))
    plan = decide(data)
    if plan.mode == "re_read" and progress.get("id") and state.get("event") == "start_session":
        queue = [index for index in data.re_read_queue if index != plan.chunk_indices[0]]
        supabase.table("reading_progress").update({"re_read_queue": queue}).eq("id", progress["id"]).execute()
    return {
        "plan": plan.model_dump(),
        "session_plan": plan.model_dump(include={"chunk_indices", "assigned_words", "focus_duration_minutes", "reason"}),
        "chunk_indices": plan.chunk_indices,
        "decisions": [decision("planner", started, {
            "last_chunk_index": data.last_chunk_index, "re_read_queue": data.re_read_queue, "wpm": data.wpm,
            "candidates": [chunk.index for chunk in data.chunks], "concept_states": len(data.concepts),
        }, plan.model_dump(include={"mode", "rule", "chunk_indices", "assigned_words", "focus_duration_minutes"}),
            plan.reason)],
    }
