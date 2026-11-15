"""Focus sessions (C23.4, docs/FOCUS_RULES.md): start at or after the body start, server-timed events with a rate
limit, pause and resume, end at the bookmark, and GET with the server's own time and state. The 3-hour cap moves a
session to its quiz on any event or GET; an open session with no event for two hours is abandoned. Owner only."""

from datetime import datetime
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from backend.agents.question_generation.assembler import public_question
from backend.dependencies import get_current_user, require_model
from backend.focus import policy, quiz, quiz_me, store
from backend.routers.sessions import EpubAnchor, PdfAnchor
from backend.services import body_start
from backend.services.supabase_client import supabase

router = APIRouter()
Anchor = Annotated[PdfAnchor | EpubAnchor, Field(discriminator="kind")]


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(max_length=64)
    anchor: Anchor
    page_key: str | None = Field(default=None, max_length=64)


class EventRequest(BaseModel):
    """What the tab reports. No duration, count or score: the server times and scores everything (F14)."""
    model_config = ConfigDict(extra="forbid")
    kind: Literal["heartbeat", "page_turn", "hidden", "visible", "idle_prompt", "idle_confirm"]
    page_key: str | None = Field(default=None, max_length=64)
    position: float | None = Field(default=None, ge=0, le=1e12)
    client_ts: datetime | None = None  # stored for diagnosis, never scored
    client_event_id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F-]{36}$")
    had_input: bool | None = None


class AnswersRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answers: list[Annotated[str, Field(max_length=4_000)]] = Field(max_length=policy.QUIZ_MAX_QUESTIONS)
    time_taken_seconds: int = Field(ge=0, le=24 * 3600)


class QuizMeRequest(BaseModel):
    """C23.7b: the reader's place (the end of the page shown) and which stretch to ask about. No points, ever."""
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(max_length=64)
    scope: quiz_me.Scope
    anchor: Anchor


class EndRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bookmark_anchor: Anchor


def _book(book_id: str, user_id: str) -> dict:
    rows = supabase.table("books").select("id, file_type, page_count, toc, body_start").eq("id", book_id).eq(
        "user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Book not found")
    return cast(dict[str, Any], rows[0])


QUAD_MIN, QUAD_MAX = -1_000, 100_000  # points: room for rounding at a page's edge, far from a negative A4 position


def _check_place(book: dict, anchor: dict) -> None:
    pdf = str(book.get("file_type") or "").lower() == "pdf"
    if (anchor["kind"] == "pdf") != pdf or store.unit_of(anchor) is None:
        raise HTTPException(status_code=422, detail="That place is not in this book.")
    if pdf and book.get("page_count") and anchor["page"] > book["page_count"]:
        raise HTTPException(status_code=422, detail="That page is not in this book.")
    # C23.G: quads are points on the page; numbers off it would make a negative A4 position (refused by the row).
    if pdf and any(not QUAD_MIN <= value <= QUAD_MAX for quad in anchor["quads"] for value in quad):
        raise HTTPException(status_code=422, detail="That place is not on the page.")


def _before_body(book: dict, anchor: dict) -> str | None:
    """The body start's title when the place comes before it (F2), else None. No known start locks nothing."""
    start = book.get("body_start") or (body_start.for_book(supabase, book) or {}).get("body_start")
    if not start or start.get("kind") != anchor["kind"]:
        return None
    first = start["page"] if start["kind"] == "pdf" else start["spine_index"]
    return (start.get("title") or "Chapter 1") if store.unit_of(anchor) < first else None


def _start(user_id: str, req: StartRequest) -> dict:
    book = _book(req.book_id, user_id)
    anchor = req.anchor.model_dump()
    _check_place(book, anchor)
    title = _before_body(book, anchor)
    if title:
        raise HTTPException(status_code=409, detail=f"Focus mode starts at {title}.")
    existing = store.open_session(user_id)
    if existing:
        raise HTTPException(status_code=409, detail={"message": "Another focus session is open.",
                                                     "session_id": existing["id"], "book_id": existing["book_id"]})
    at = store.now()
    row = {"user_id": user_id, "book_id": req.book_id, "status": "active", "start_anchor": anchor,
           "start_position": store.position(anchor), "started_at": store.stamp(at), "updated_at": store.stamp(at),
           "rules_version": policy.RULES_VERSION}
    session = cast(dict[str, Any], supabase.table("focus_sessions").insert(row).execute().data[0])
    events = [store.insert_event(session, "start", at, page_key=req.page_key, position=row["start_position"])]
    return store.view(session, events, store.tally(events))


def _owned(session_id: str, user_id: str) -> tuple[dict, list[dict]]:
    """The caller's session (404 otherwise) and its events; an open one idle for two hours is abandoned first."""
    session = store.load_session(session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Focus session not found")
    if store.stale(session, store.now()):
        store.abandon(session, store.now())
    return session, store.load_events(session_id)


def _require_open(session: dict) -> None:
    if session["status"] not in policy.OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"This focus session is {session['status'].replace('_', ' ')}.")


def _limited(req: EventRequest, events: list[dict], at: datetime) -> str | None:
    """Why an event is ignored: a resend of one stored, or too soon after the last of its kind (F3)."""
    if req.client_event_id and any(e.get("client_event_id") == req.client_event_id for e in events):
        return "duplicate"
    gap = policy.HEARTBEAT_RATE_S if req.kind == "heartbeat" else policy.EVENT_RATE_S
    last = next((e for e in reversed(events) if e["kind"] == req.kind), None)
    if last and (at - datetime.fromisoformat(last["server_ts"])).total_seconds() < gap:
        return "rate_limited"
    return None


def _event(user_id: str, session_id: str, req: EventRequest) -> dict:
    session, events = _owned(session_id, user_id)
    _require_open(session)
    at = store.now()
    reason = _limited(req, events, at)
    if reason:
        store.update_session(session, {"ignored_events": (session.get("ignored_events") or 0) + 1})
        return {"accepted": False, "reason": reason, "session": store.view(session, events, store.tally(events))}
    fields = req.model_dump(exclude={"kind", "client_ts"}, exclude_none=True)
    if req.client_ts:
        fields["client_ts"] = store.stamp(req.client_ts)
    events.append(store.insert_event(session, req.kind, at, **fields))
    store.update_session(session, {"updated_at": store.stamp(at)})
    out = store.settle(session, events, at)
    return {"accepted": True, "reason": None, "session": store.view(session, events, out)}


def _toggle(user_id: str, session_id: str, kind: str, want: str, becomes: str) -> dict:
    session, events = _owned(session_id, user_id)
    if session["status"] != want:
        raise HTTPException(status_code=409, detail=f"This focus session is {session['status'].replace('_', ' ')}.")
    at = store.now()
    events.append(store.insert_event(session, kind, at))
    store.update_session(session, {"status": becomes, "updated_at": store.stamp(at)})
    return store.view(session, events, store.settle(session, events, at))


def _end(user_id: str, session_id: str, req: EndRequest) -> dict:
    session, events = _owned(session_id, user_id)
    store.settle(session, events, store.now())
    capped = session["status"] == "awaiting_quiz" and not session.get("end_anchor")
    if not capped:
        _require_open(session)
    bookmark, began = req.bookmark_anchor.model_dump(), session["start_anchor"]
    _check_place(_book(session["book_id"], user_id), bookmark)  # C23.G: a place the quiz can map, like the start
    if bookmark["kind"] != began["kind"] or store.order_key(bookmark) <= store.order_key(began):
        raise HTTPException(status_code=422, detail="Place the bookmark after where this session started.")
    if capped:  # the 3-hour cap ended it: the reader places the bookmark now, and no time is added (F8-F9)
        store.update_session(session, {"end_anchor": bookmark, "end_position": store.position(bookmark)})
        return store.view(session, events, store.tally(events))
    at = store.now()
    events.append(store.insert_event(session, "end", at, position=store.position(bookmark)))
    out = store.tally(events)  # frozen: no event is accepted after the end
    store.update_session(session, {
        "status": "awaiting_quiz", "ended_at": store.stamp(at), "updated_at": store.stamp(at), "end_anchor": bookmark,
        "end_position": store.position(bookmark), "active_seconds": out.active_seconds,
        "voided_seconds": out.voided_seconds})
    return store.view(session, events, out)


def _get(user_id: str, session_id: str) -> dict:
    session, events = _owned(session_id, user_id)
    return store.view(session, events, store.settle(session, events, store.now()))


def _awaiting(user_id: str, session_id: str) -> tuple[dict, list[dict]]:
    session, events = _owned(session_id, user_id)
    store.settle(session, events, store.now())  # a session past the cap is ready for its quiz
    if session["status"] != "awaiting_quiz":
        raise HTTPException(status_code=409, detail=f"This focus session is {session['status'].replace('_', ' ')}.")
    return session, events


def _quiz(user_id: str, session_id: str) -> dict:
    """F10: the questions on the text from the session's start to its bookmark; no answers leave the server."""
    session, _events = _awaiting(user_id, session_id)
    built = quiz.build(session)
    return {"questions": [public_question(q) for q in built["questions"]], "count": built["count"],
            "words_in_range": built["words_in_range"]}


@router.post("/{session_id}/quiz")
async def focus_quiz(session_id: str, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_quiz, user_id, session_id)


@router.post("/{session_id}/quiz/answers", dependencies=[Depends(require_model)])
async def focus_quiz_answers(session_id: str, req: AnswersRequest, user_id: str = Depends(get_current_user)):
    """Grade the quiz once (submit_answers: grades, test_results, mastery) and score the session (F11-F12)."""
    session, events = await run_in_threadpool(_awaiting, user_id, session_id)
    try:
        result = await quiz.grade(session, events, req.answers, req.time_taken_seconds)
    except quiz.NotGraded:  # C23.G: nothing scored; the reader's answers are kept in the browser
        raise HTTPException(status_code=503,
                            detail="Your answers couldn't be graded just now. They are kept; try again.") from None
    if result is None:
        raise HTTPException(status_code=409, detail="This quiz has not been asked yet, or is already answered.")
    return result


def _current(user_id: str, book_id: str) -> dict:
    """The reader's open session or the one waiting for its quiz, in this book (C23.6: a reload picks it up)."""
    _book(book_id, user_id)
    rows = supabase.table("focus_sessions").select("id").eq("user_id", user_id).eq("book_id", book_id).in_(
        "status", [*policy.OPEN_STATUSES, "awaiting_quiz"]).execute().data or []
    if not rows:
        return {"session": None}
    session = _get(user_id, rows[0]["id"])
    return {"session": session if session["status"] in (*policy.OPEN_STATUSES, "awaiting_quiz") else None}


def _discard(user_id: str, session_id: str) -> dict:
    """Leave focus mode without a quiz (C23.6): the session is abandoned and earns 0 (F12)."""
    session, events = _owned(session_id, user_id)
    if session["status"] not in (*policy.OPEN_STATUSES, "awaiting_quiz"):
        raise HTTPException(status_code=409, detail=f"This focus session is {session['status'].replace('_', ' ')}.")
    store.abandon(session, store.now())
    return store.view(session, events, store.tally(events))


def _quiz_me(user_id: str, req: QuizMeRequest) -> dict:
    book = _book(req.book_id, user_id)
    place = req.anchor.model_dump()
    _check_place(book, place)
    try:
        built = quiz_me.build(user_id, book, req.scope, place)
    except quiz_me.NothingToAsk:
        raise HTTPException(status_code=409, detail="There is nothing to ask about yet. Read a little further first.") from None
    return {"session_id": built["session_id"], "questions": [public_question(q) for q in built["questions"]],
            "count": built["count"], "words_in_range": built["words_in_range"]}


@router.post("/quiz-me")
async def quiz_me_start(req: QuizMeRequest, user_id: str = Depends(get_current_user)):
    """C23.7b (F13): a quiz from the chapter's start, or since the last quiz, to the reader's place; no points."""
    return await run_in_threadpool(_quiz_me, user_id, req)


@router.get("/current")
async def current_focus(book_id: str = Query(max_length=64), user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_current, user_id, book_id)


@router.post("/{session_id}/discard")
async def discard_focus(session_id: str, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_discard, user_id, session_id)


@router.post("/start")
async def start_focus(req: StartRequest, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_start, user_id, req)


@router.post("/{session_id}/event")
async def focus_event(session_id: str, req: EventRequest, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_event, user_id, session_id, req)


@router.post("/{session_id}/pause")
async def pause_focus(session_id: str, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_toggle, user_id, session_id, "pause", "active", "paused")


@router.post("/{session_id}/resume")
async def resume_focus(session_id: str, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_toggle, user_id, session_id, "resume", "paused", "active")


@router.post("/{session_id}/end")
async def end_focus(session_id: str, req: EndRequest, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_end, user_id, session_id, req)


@router.get("/{session_id}")
async def get_focus(session_id: str, user_id: str = Depends(get_current_user)):
    return await run_in_threadpool(_get, user_id, session_id)
