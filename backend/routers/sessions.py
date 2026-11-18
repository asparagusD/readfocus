from datetime import datetime
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from backend.agents.evaluator_agent import evaluate_single_answer, load_passage, warm_up
from backend.agents.question_generation.assembler import public_question
from backend.agents.workflow import (
    run_abandon,
    run_finish,
    run_submit,
    save_decisions,
)
from backend.dependencies import get_current_user, require_model
from backend.services.supabase_client import supabase

router = APIRouter()

def assemble_test_background(session_id: str, user_id: str, book_id: str, chunk_indices: list[int], mix: list | None = None):
    """Runs the finish_reading flow while the reader reads: questions from the bank, in the planner's mix."""
    try:
        save_decisions(run_finish(session_id, user_id, book_id, chunk_indices, mix))
    except Exception as e:
        print(f"Background test assembly failed: {e}")
    warm_up()  # load the grading model while the reader reads, not when they answer


async def abandon_background(session_id: str, user_id: str, book_id: str, chunk_indices: list[int]):
    """Runs the abandon flow after the response: the optimizer counts the stopped session."""
    try:
        save_decisions(await run_abandon(session_id, user_id, book_id, chunk_indices))
    except Exception as e:  # noqa: BLE001 - the session is already marked abandoned
        print(f"Abandon flow failed for session {session_id}: {e}")


class FinishReadingRequest(BaseModel):
    actual_duration_minutes: int

class SubmitAnswersRequest(BaseModel):
    answers: list[str]
    time_taken_seconds: int

PUBLIC_GRADE_KEYS = ("score", "max_score", "feedback", "confidence", "matched_concepts", "missing_concepts")


def stored_result(session_id: str, user_id: str, book_id: str) -> dict:
    """The submit response for a session already graded, rebuilt from what was stored (issue 33)."""
    rows = supabase.table("test_results").select("total_score, max_score, answers").eq("session_id", session_id).eq(
        "user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=409, detail="This test has already been submitted.")
    row = cast(dict[str, Any], rows[0])
    answers = row.get("answers") or []
    progress = supabase.table("reading_progress").select("pace_recommendation").eq("user_id", user_id).eq(
        "book_id", book_id).execute().data
    return {
        "total_score": row["total_score"], "max_score": row["max_score"],
        "percentage": row["total_score"] / row["max_score"] * 100 if row["max_score"] else 0,
        "per_question": [{key: answer.get(key) for key in PUBLIC_GRADE_KEYS} for answer in answers],
        "low_confidence_count": sum(answer.get("confidence") == "low" for answer in answers),
        "pace_recommendation": cast(dict[str, Any], progress[0]).get("pace_recommendation") if progress else None,
    }


class EvaluateSingleRequest(BaseModel):
    index: int
    answer: str


class PdfAnchor(BaseModel):
    """A place in a PDF (docs/ANCHORS.md A1, A3): 1-based page, quads in points from the top-left, text."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["pdf"]
    page: int = Field(ge=1, le=100_000)
    quads: list[Annotated[list[float], Field(min_length=4, max_length=4)]] = Field(min_length=1, max_length=64)
    text: str = Field(default="", max_length=2_000)


class EpubAnchor(BaseModel):
    """A place in an EPUB (ANCHORS A1, A3): an EPUB CFI and the text under it ("" for a point)."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["epub"]
    cfi: str = Field(pattern=r"^epubcfi\(.+\)$", max_length=1_024)
    text: str = Field(default="", max_length=2_000)


def refuse_focus_quiz(session_id: str, user_id: str) -> None:
    """C23.G: a focus session's quiz is answered and scored only through /focus/{id}/quiz/answers (F12, F14)."""
    if supabase.table("focus_sessions").select("id").eq("id", session_id).eq("user_id", user_id).execute().data:
        raise HTTPException(status_code=409, detail="This is a focus session's quiz; answer it in focus mode.")


@router.post("/{session_id}/finish-reading")
async def finish_reading(
    session_id: str, req: FinishReadingRequest, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)
):
    # 1. Mark the session as testing; the update returns the row, so this is the only round trip. C23.G: only a
    #    session still being read or tested: a graded one (a focus quiz's included) is never reopened for a retake.
    sess_resp = await run_in_threadpool(supabase.table("sessions").update({
        "status": "testing",
        "actual_duration_minutes": req.actual_duration_minutes
    }).eq("id", session_id).eq("user_id", user_id).in_("status", ["reading", "testing"]).execute)  # C34.5: off the loop
    if not sess_resp.data:
        found = (await run_in_threadpool(
            supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", user_id).execute)).data
        if found:
            raise HTTPException(status_code=409, detail="This test has been answered already.")
        raise HTTPException(status_code=404, detail="Session not found.")

    sess = cast(dict[str, Any], sess_resp.data[0])
    test_questions = sess.get("test_questions")

    # 2. The test is normally assembled in the background at start; if it is not there yet, do it now
    if not test_questions:
        chunk_indices = list(range(sess["chunk_start_index"], sess["chunk_end_index"] + 1))
        run = await run_in_threadpool(run_finish, session_id, user_id, sess["book_id"], chunk_indices, None)
        test_questions = run.get("test_questions") or []
        background_tasks.add_task(save_decisions, run)

    # 3. Only the public part of each question leaves the server: no answers, evidence or hints
    return {
        "test_id": session_id,
        "questions": [public_question(q) for q in test_questions]
    }

@router.post("/{session_id}/evaluate-single", dependencies=[Depends(require_model)])
async def evaluate_single(session_id: str, req: EvaluateSingleRequest, user_id: str = Depends(get_current_user)):
    """Grade one answer now and cache it with the session, so submit has less to do.

    The grade stays on the server: its feedback quotes the passage, and the test is not over.
    """
    sess_resp = await run_in_threadpool(supabase.table("sessions").select(
        "book_id, chunk_start_index, chunk_end_index, test_questions").eq("id", session_id).eq("user_id", user_id).execute)
    if not sess_resp.data:
        raise HTTPException(status_code=404, detail="Session not found.")
    sess = cast(dict[str, Any], sess_resp.data[0])
    test_questions = sess.get("test_questions") or []
    if not 0 <= req.index < len(test_questions):
        raise HTTPException(status_code=400, detail="No such question in this test.")

    question = test_questions[req.index]
    passage = ""
    if not question.get("evidence"):
        passage = await run_in_threadpool(
            load_passage, sess["book_id"], list(range(sess["chunk_start_index"], sess["chunk_end_index"] + 1)))
    test_questions[req.index]["cached_eval"] = await evaluate_single_answer(question, req.answer, passage)
    await run_in_threadpool(supabase.table("sessions").update({"test_questions": test_questions}).eq(
        "id", session_id).eq("user_id", user_id).execute)
    return {"status": "graded"}

@router.post("/{session_id}/submit-answers", dependencies=[Depends(require_model)])
async def submit_answers(
    session_id: str, req: SubmitAnswersRequest, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)
):
    await run_in_threadpool(refuse_focus_quiz, session_id, user_id)
    # 1. Claim the session: two submits at once cannot both grade it (issue 33), and the update returns
    #    the session row, so on the happy path this is the only round trip before grading (issue 28).
    claimed = await run_in_threadpool(supabase.table("sessions").update({
        "status": "completed", "completed_at": datetime.utcnow().isoformat()
    }).eq("id", session_id).eq("user_id", user_id).neq("status", "completed").execute)  # C34.5: off the loop
    if not claimed.data:
        found = await run_in_threadpool(
            supabase.table("sessions").select("book_id").eq("id", session_id).eq("user_id", user_id).execute)
        if not found.data:
            raise HTTPException(status_code=404, detail="Session not found.")
        # graded already, or being graded by a concurrent submit: the stored result, nothing re-run
        return await run_in_threadpool(stored_result, session_id, user_id, cast(dict[str, Any], found.data[0])["book_id"])

    sess = cast(dict[str, Any], claimed.data[0])
    book_id = sess["book_id"]
    chunk_indices = list(range(sess["chunk_start_index"], sess["chunk_end_index"] + 1))
    test_questions = sess.get("test_questions") or []

    def release():
        supabase.table("sessions").update({"status": "testing", "completed_at": None}).eq(
            "id", session_id).eq("user_id", user_id).execute()

    if not test_questions:
        await run_in_threadpool(release)
        raise HTTPException(status_code=400, detail="No test questions found. Did you call finish-reading?")

    # 3. Run the submit_answers flow: evaluator -> knowledge state -> optimizer (C26.6: no planner)
    try:
        final = await run_submit(
            session_id, user_id, book_id, chunk_indices, test_questions, req.answers, req.time_taken_seconds
        )
    except Exception:
        await run_in_threadpool(release)
        raise
    eval_result = final.get("evaluation_result")
    if final.get("error") or not eval_result:
        print(f"Evaluate Answers Error: {final.get('error')}")
        await run_in_threadpool(release)
        raise HTTPException(status_code=500, detail="Failed to evaluate answers.")
    background_tasks.add_task(save_decisions, final)
    
    return {
        "total_score": eval_result.get("total_score"),
        "max_score": eval_result.get("max_score"),
        "percentage": eval_result.get("percentage"),
        "per_question": eval_result.get("per_question"),
        "low_confidence_count": eval_result.get("low_confidence_count", 0),
        "pace_recommendation": final.get("pace_recommendation"),  # none when every grade was low-confidence
    }  # C26.6: no next_session; the reader reads on from their place

@router.post("/{session_id}/abandon")
def abandon_session(session_id: str, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    resp = supabase.table("sessions").update({
        "status": "abandoned",
        "completed_at": datetime.utcnow().isoformat()
    }).eq("id", session_id).eq("user_id", user_id).execute()
    
    if not resp.data:
        raise HTTPException(status_code=404, detail="Session not found.")
    sess = cast(dict[str, Any], resp.data[0])
    chunk_indices = list(range(sess["chunk_start_index"], sess["chunk_end_index"] + 1))
    background_tasks.add_task(abandon_background, session_id, user_id, sess["book_id"], chunk_indices)
    return {"status": "abandoned"}

@router.get("/{session_id}")
def get_session(session_id: str, user_id: str = Depends(get_current_user)):
    sess_resp = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).execute()
    if not sess_resp.data:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    session: dict[str, Any] = cast(dict[str, Any], sess_resp.data[0])

    # Questions are stored with their answers for grading; the client gets the public part only.
    session["test_questions"] = [public_question(q) for q in session.get("test_questions") or []]

    if session["status"] == "completed":
        test_resp = supabase.table("test_results").select("*").eq("session_id", session_id).execute()
        if test_resp.data:
            results = cast(dict[str, Any], test_resp.data[0])
            results["questions"] = [public_question(q) for q in results.get("questions") or []]
            results["answers"] = [
                {**answer, "question": public_question(answer.get("question") or {})}
                for answer in results.get("answers") or []
            ]
            session["test_results"] = results

    return session
