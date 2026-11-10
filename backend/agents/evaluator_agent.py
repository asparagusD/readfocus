"""Evaluator: grades a test with the local grader. No LLM.

The grading itself is backend/agents/evaluation/grader.py (pure decide) and
the wording is backend/agents/evaluation/feedback.py (templates). This
module is the thin part around them: it turns stored session questions into
grader inputs, embeds once per test on a worker thread, and persists.

A graded answer is a dict with `score` (0..10, an integer, as Results.jsx
and the dashboard read it), `max_score`, `feedback`, `confidence` (high,
medium, low), `matched_concepts`, `missing_concepts`, and the `method`,
`reasons` and `components` behind the score. A grade is never invented: if
the embedder fails the answer is graded on key terms at low confidence, and
a question with no evidence of its own (the fallback question, or one
stored before C5.5) is graded against the passage and always marked low.
"""

import asyncio
import time
from typing import Any, cast

from backend.agents import policy
from backend.agents.evaluation import feedback, grader
from backend.agents.evaluation.grader import GradeInput
from backend.agents.state import AgentState, decision
from backend.nlp import embedder, text
from backend.services.supabase_client import supabase


def reference_from_passage(passage: str) -> str:
    """The passage's most informative sentences, in reading order: what an ungrounded question is graded against."""
    sentences = text.split_sentences(passage)
    best = set(sorted(sentences, key=text.informativeness, reverse=True)[:policy.GRADE_FALLBACK_SENTENCES])
    return "\n\n".join(sentence for sentence in sentences if sentence in best)


def to_grade_input(question: dict, answer: str, passage: str = "") -> GradeInput:
    return GradeInput(
        question=question.get("question") or "", answer=answer or "",
        evidence=question.get("evidence") or reference_from_passage(passage),
        key_terms=question.get("key_terms") or [], strategy=question.get("strategy"),
        expected=question.get("answer") or None, options=question.get("options"),
    )


def grade_answers(questions: list[dict], answers: list[str], passage: str = "") -> list[dict]:
    """Grade answers to stored session questions. Embeds once; call it from a worker thread."""
    inputs = [to_grade_input(question, answer, passage) for question, answer in zip(questions, answers)]
    results = []
    for question, data, grade in zip(questions, inputs, grader.grade_all(inputs, embedder.embed)):
        if not question.get("evidence") and grade.method != "empty":
            grade = grade.model_copy(update={"confidence": "low", "reasons": [*grade.reasons, "no_reference"]})
        results.append({
            "answer": data.answer, "score": round(grade.score * policy.GRADE_POINTS), "max_score": policy.GRADE_POINTS,
            "feedback": feedback.render(grade, data.evidence), "confidence": grade.confidence,
            "matched_concepts": grade.matched_concepts, "missing_concepts": grade.missing_concepts,
            "method": grade.method, "reasons": grade.reasons, "components": grade.components,
        })
    return results


def load_passage(book_id: str, chunk_indices: list[int]) -> str:
    if not chunk_indices:
        return ""
    resp = supabase.table("chunks").select("chunk_index, content").eq("book_id", book_id).in_(
        "chunk_index", chunk_indices
    ).execute()
    chunks = sorted(cast(list[dict], resp.data or []), key=lambda chunk: chunk["chunk_index"])
    return "\n\n".join(chunk["content"] for chunk in chunks)


def needs_passage(questions: list[dict]) -> bool:
    return any(not question.get("evidence") for question in questions)


async def evaluate_single_answer(question: dict, answer: str, passage: str = "") -> dict:
    """Grade one answer; the result is what the session caches as `cached_eval`."""
    return (await asyncio.to_thread(grade_answers, [question], [answer], passage))[0]


def warm_up() -> None:
    """Load the embedding model ahead of the first grade, so the reader does not wait for it."""
    try:
        embedder.get_model()
    except Exception as error:  # noqa: BLE001 - grading falls back to key terms without the model
        print(f"Evaluator warm-up failed: {error}")


async def evaluator_node(state: AgentState) -> dict:
    started = time.perf_counter()
    user_id, book_id, session_id = state.get("user_id"), state.get("book_id"), state.get("session_id")
    chunk_indices = state.get("chunk_indices", [])
    questions = state.get("test_questions", [])
    if not questions:
        return {"error": "Missing questions in state."}
    given = list(state.get("user_answers") or [])
    answers = [(given[i] if i < len(given) else "") or "" for i in range(len(questions))]  # a missing answer is blank

    # 1. Grade: reuse a pre-graded answer if its text has not changed, grade the rest in one batch.
    results: list[Any] = [
        question.get("cached_eval") if (question.get("cached_eval") or {}).get("answer") == answer else None
        for question, answer in zip(questions, answers)
    ]
    todo = [i for i, result in enumerate(results) if result is None]
    if todo:
        passage = load_passage(book_id, chunk_indices) if needs_passage([questions[i] for i in todo]) else ""
        graded = await asyncio.to_thread(
            grade_answers, [questions[i] for i in todo], [answers[i] for i in todo], passage
        )
        for i, result in zip(todo, graded):
            results[i] = result

    total_score = sum(result["score"] for result in results)
    max_score = sum(result["max_score"] for result in results)
    public = ("score", "max_score", "feedback", "confidence", "matched_concepts", "missing_concepts")
    per_question = [{key: result.get(key) for key in public} for result in results]

    # 2. Store the result; the answers keep the keys Results.jsx and the dashboard read.
    try:
        supabase.table("test_results").insert({
            "session_id": session_id, "user_id": user_id,
            "chunk_index": chunk_indices[0] if chunk_indices else -1,
            "questions": questions,
            "answers": [
                {"question": question, "user_answer": answer, **{k: v for k, v in result.items() if k != "answer"}}
                for question, answer, result in zip(questions, answers, results)
            ],
            "total_score": total_score, "max_score": max_score,
            "time_taken_seconds": state.get("time_taken_seconds", 300),
        }).execute()
    except Exception as e:  # noqa: BLE001 - the reader still gets their result
        print(f"Failed to insert test_results: {e}")

    # 3. Update the rolling average in reading_progress.
    try:
        history = supabase.table("test_results").select("total_score, max_score").eq("user_id", user_id).order(
            "created_at", desc=True
        ).limit(10).execute()
        recent = cast(list[dict], history.data or [])
        max_sum = sum(r["max_score"] for r in recent)
        progress = supabase.table("reading_progress").select("id, chunks_completed, re_read_queue").eq(
            "user_id", user_id
        ).eq("book_id", book_id).execute()
        rows = cast(list[dict], progress.data or [])
        if recent and rows:
            supabase.table("reading_progress").update({
                "average_score": sum(r["total_score"] for r in recent) / max_sum * 100 if max_sum else 0,
                "last_chunk_index": chunk_indices[-1] if chunk_indices else -1,
                "chunks_completed": rows[0]["chunks_completed"] + len(chunk_indices),
            }).eq("id", rows[0]["id"]).execute()
    except Exception as e:  # noqa: BLE001
        print(f"Failed to update reading_progress: {e}")

    return {
        "evaluation_result": {
            "total_score": total_score, "max_score": max_score,
            "percentage": total_score / max_score * 100 if max_score else 0,
            "per_question": per_question,
            "low_confidence_count": sum(result["confidence"] == "low" for result in results),
        },
        "grades": results,
        "decisions": [decision(  # appended by the state's reducer
            "evaluator", started,
            {"questions": [question.get("id") for question in questions], "regraded": todo},
            {"total_score": total_score, "max_score": max_score, "grades": [
                {key: result.get(key) for key in ("score", "confidence", "method", "reasons", "components")}
                for result in results
            ]},
            f"Graded {len(results)} answers locally: {total_score} of {max_score}.",
        )],
    }
