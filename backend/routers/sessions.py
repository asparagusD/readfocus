import asyncio
from datetime import datetime
from typing import Any, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, model_validator

from backend.agents.evaluator_agent import evaluate_single_answer, load_passage, warm_up
from backend.agents.question_generation.assembler import public_question
from backend.agents.workflow import (
    run_abandon,
    run_finish,
    run_start,
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


class StartSessionRequest(BaseModel):
    book_id: str

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
        "next_session": None,
    }


class EvaluateSingleRequest(BaseModel):
    index: int
    answer: str


class PositionRequest(BaseModel):
    """A place in a book (C12.2): chunk, reader block ("<chunk>.<n>", chunks.blocks) and offset in its text."""

    chunk_index: int = Field(ge=0)
    block_id: str = Field(pattern=r"^\d+\.\d+$", max_length=24)
    char_offset: int = Field(ge=0, le=100_000)

    @model_validator(mode="after")
    def block_in_chunk(self):
        if self.block_id.split(".")[0] != str(self.chunk_index):
            raise ValueError("block_id must be a block of chunk_index")
        return self


def read_book(user_id: str, book_id: str, first_chunk: int):
    """The book's title and author, and the chapter in effect before the session's first chunk (C12.3b).

    A chapter that starts inside the session is found by the reader in the blocks themselves; this is
    the chapter the first pages belong to when they open mid-chapter. A failed read gives (None, None).
    """
    try:
        rows = supabase.table("books").select("title, author, toc").eq("id", book_id).eq(
            "user_id", user_id).execute().data
        if not rows:
            return None, None
        row = cast(dict[str, Any], rows[0])
        earlier = [entry for entry in row.get("toc") or [] if entry.get("chunk_index", 0) < first_chunk]
        book = {"title": row.get("title"), "author": row.get("author"), "toc": row.get("toc") or []}  # toc: contents drawer
        return book, (earlier[-1]["title"] if earlier else None)
    except Exception as e:  # noqa: BLE001 - the running head shows less, the session still starts
        print(f"Book details not read: {e}")
        return None, None


def read_position(user_id: str, book_id: str):
    """The saved place for /start; a failed read is no place, never a failed start."""
    try:
        rows = supabase.table("reading_progress").select("position").eq("user_id", user_id).eq(
            "book_id", book_id).execute().data
        return cast(dict[str, Any], rows[0]).get("position") if rows else None
    except Exception as e:  # noqa: BLE001 - the reader starts at the plan's first page instead
        print(f"Reading position not read: {e}")
        return None

def owns_book(user_id: str, book_id: str) -> bool:
    """True when the book is the caller's; the service-role client bypasses RLS, so this is the check (issue 17)."""
    return bool(supabase.table("books").select("id").eq("id", book_id).eq("user_id", user_id).execute().data)


@router.post("/start")
async def start_session(req: StartSessionRequest, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    # 0. Only the caller's own book: nothing is planned, created or read for anyone else's
    try:
        owned = await run_in_threadpool(owns_book, user_id, req.book_id)
    except Exception as e:  # noqa: BLE001 - fail closed: a book we cannot check is not served
        print(f"Book ownership not checked: {e}")
        raise HTTPException(status_code=503, detail="Could not open this book just now; try again.")
    if not owned:
        raise HTTPException(status_code=404, detail="Book not found.")

    # 1. Run the start_session flow: the planner
    plan, run = await run_start(user_id, req.book_id)
    if not plan:
        raise HTTPException(status_code=500, detail="Planner failed to generate a session plan.")
        
    chunk_indices = plan.chunk_indices
    if not chunk_indices:
        raise HTTPException(status_code=400, detail="No more chunks available to read.")
        
    # 2-3. Fetch the chunk content and create the session row; neither needs the other, so they run at once
    chunk_query = supabase.table("chunks").select("chunk_index, content, word_count, blocks").eq(
        "book_id", req.book_id).in_("chunk_index", chunk_indices)
    session_query = supabase.table("sessions").insert({
        "user_id": user_id,
        "book_id": req.book_id,
        "chunk_start_index": chunk_indices[0],
        "chunk_end_index": chunk_indices[-1],
        "assigned_words": getattr(plan, "assigned_words", 0),
        "focus_duration_minutes": getattr(plan, "focus_duration_minutes", 20),
        "status": "reading",
        "started_at": datetime.utcnow().isoformat()
    })
    resp, session_resp, position, (book, chapter_before) = await asyncio.gather(
        run_in_threadpool(chunk_query.execute), run_in_threadpool(session_query.execute),
        run_in_threadpool(read_position, user_id, req.book_id),
        run_in_threadpool(read_book, user_id, req.book_id, chunk_indices[0]))
    chunks_data: list[dict[str, Any]] = sorted(cast(list[dict[str, Any]], resp.data or []), key=lambda x: x["chunk_index"])

    if not session_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create session.")
        
    session_id = cast(dict[str, Any], session_resp.data[0])["id"]
    
    # 4. After the response: store the planner's decisions, and assemble the test from the question bank
    background_tasks.add_task(save_decisions, run, session_id)
    background_tasks.add_task(
        assemble_test_background, session_id, user_id, req.book_id, chunk_indices, getattr(plan, "question_mix", None)
    )
    
    return {
        "session_id": session_id,
        "chunk_indices": chunk_indices,
        "focus_duration_minutes": getattr(plan, "focus_duration_minutes", 20),
        "reason": getattr(plan, "reason", ""),
        "chunks": chunks_data,
        "position": position,  # the last saved place in this book, or None; the reader decides whether to resume
        "book": book,  # {title, author} for the running head, or None
        "chapter_before": chapter_before,  # the chapter the first page belongs to when it opens mid-chapter
    }


@router.put("/{session_id}/position")
async def save_position(session_id: str, req: PositionRequest, user_id: str = Depends(get_current_user)):
    """Save the reader's place (sent debounced as pages turn). Only reading_progress.position changes."""
    sess = await run_in_threadpool(
        supabase.table("sessions").select("book_id").eq("id", session_id).eq("user_id", user_id).execute)
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found.")
    book_id = cast(dict[str, Any], sess.data[0])["book_id"]
    chunk = await run_in_threadpool(supabase.table("chunks").select("id").eq("book_id", book_id).eq(
        "chunk_index", req.chunk_index).limit(1).execute)
    if not chunk.data:
        raise HTTPException(status_code=422, detail="No such chunk in this book.")
    position = req.model_dump()
    # Update only: the planner creates this row on a first start, and a row made here would reset its cursor.
    updated = await run_in_threadpool(supabase.table("reading_progress").update({"position": position}).eq(
        "user_id", user_id).eq("book_id", book_id).execute)
    if not updated.data:
        raise HTTPException(status_code=409, detail="This book has no reading progress yet.")
    return {"position": position}

@router.post("/{session_id}/finish-reading")
async def finish_reading(
    session_id: str, req: FinishReadingRequest, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)
):
    # 1. Mark the session as testing; the update returns the row, so this is the only round trip
    sess_resp = supabase.table("sessions").update({
        "status": "testing",
        "actual_duration_minutes": req.actual_duration_minutes
    }).eq("id", session_id).eq("user_id", user_id).execute()
    if not sess_resp.data:
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
    sess_resp = supabase.table("sessions").select("book_id, chunk_start_index, chunk_end_index, test_questions").eq("id", session_id).eq("user_id", user_id).execute()
    if not sess_resp.data:
        raise HTTPException(status_code=404, detail="Session not found.")
    sess = cast(dict[str, Any], sess_resp.data[0])
    test_questions = sess.get("test_questions") or []
    if not 0 <= req.index < len(test_questions):
        raise HTTPException(status_code=400, detail="No such question in this test.")

    question = test_questions[req.index]
    passage = ""
    if not question.get("evidence"):
        passage = load_passage(sess["book_id"], list(range(sess["chunk_start_index"], sess["chunk_end_index"] + 1)))
    test_questions[req.index]["cached_eval"] = await evaluate_single_answer(question, req.answer, passage)
    supabase.table("sessions").update({"test_questions": test_questions}).eq("id", session_id).eq("user_id", user_id).execute()
    return {"status": "graded"}

@router.post("/{session_id}/submit-answers", dependencies=[Depends(require_model)])
async def submit_answers(
    session_id: str, req: SubmitAnswersRequest, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)
):
    # 1. Claim the session: two submits at once cannot both grade it (issue 33), and the update returns
    #    the session row, so on the happy path this is the only round trip before grading (issue 28).
    claimed = supabase.table("sessions").update({
        "status": "completed", "completed_at": datetime.utcnow().isoformat()
    }).eq("id", session_id).eq("user_id", user_id).neq("status", "completed").execute()
    if not claimed.data:
        found = supabase.table("sessions").select("book_id").eq("id", session_id).eq("user_id", user_id).execute()
        if not found.data:
            raise HTTPException(status_code=404, detail="Session not found.")
        # graded already, or being graded by a concurrent submit: the stored result, nothing re-run
        return stored_result(session_id, user_id, cast(dict[str, Any], found.data[0])["book_id"])

    sess = cast(dict[str, Any], claimed.data[0])
    book_id = sess["book_id"]
    chunk_indices = list(range(sess["chunk_start_index"], sess["chunk_end_index"] + 1))
    test_questions = sess.get("test_questions") or []

    def release():
        supabase.table("sessions").update({"status": "testing", "completed_at": None}).eq(
            "id", session_id).eq("user_id", user_id).execute()

    if not test_questions:
        release()
        raise HTTPException(status_code=400, detail="No test questions found. Did you call finish-reading?")

    # 3. Run the submit_answers flow: evaluator -> knowledge state -> optimizer -> planner
    try:
        final = await run_submit(
            session_id, user_id, book_id, chunk_indices, test_questions, req.answers, req.time_taken_seconds
        )
    except Exception:
        release()
        raise
    eval_result = final.get("evaluation_result")
    if final.get("error") or not eval_result:
        print(f"Evaluate Answers Error: {final.get('error')}")
        release()
        raise HTTPException(status_code=500, detail="Failed to evaluate answers.")
    next_plan = final.get("plan") or {}
    background_tasks.add_task(save_decisions, final)
    
    return {
        "total_score": eval_result.get("total_score"),
        "max_score": eval_result.get("max_score"),
        "percentage": eval_result.get("percentage"),
        "per_question": eval_result.get("per_question"),
        "low_confidence_count": eval_result.get("low_confidence_count", 0),
        "pace_recommendation": final.get("pace_recommendation"),  # none when every grade was low-confidence
        "next_session": {key: next_plan.get(key) for key in ("mode", "chunk_indices", "focus_duration_minutes", "reason")}
        if next_plan else None,
    }

@router.post("/{session_id}/abandon")
async def abandon_session(session_id: str, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
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
async def get_session(session_id: str, user_id: str = Depends(get_current_user)):
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
