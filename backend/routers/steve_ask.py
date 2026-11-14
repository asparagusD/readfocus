"""Asking Steve (C20.6, docs/STEVE.md S12): POST /steve/ask as Server-Sent Events, and the reader's threads.

POST /steve/ask checks, before anything leaves the server: consent to the current notice, Steve switched on, no
comprehension test open on the book, the image (a PNG of at most 500 KB), the thread and the book being the
reader's. Then the context (backend/steve/context.py), the prompt (prompts.py) and service.ask (cache, breaker,
daily limit, provider). A failure before the first token is a typed JSON error; after it, an `error` event.

Events: `start` {thread_id, pages}, `token` {text} as Gemini writes, then `done` {message_id, thread_id, text,
citations, usage}: the text with citations to pages that were not sent removed (a latex_equation answer: bare
LaTeX). The question and the answer are kept in the thread; the image and any key are not.
"""

import base64
import binascii
import hashlib
import json
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from backend.dependencies import get_current_user
from backend.routers.sessions import EpubAnchor, PdfAnchor
from backend.services.supabase_client import supabase
from backend.steve import consent, policy, prompts, service, threads
from backend.steve.context import ContextError, build_context
from backend.steve.errors import SteveUnavailable

router = APIRouter()
logger = logging.getLogger("steve.ask")

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PAUSE_STATUS = {"paused_quota": 429, "daily_limit": 429, "timeout": 503, "unavailable": 503, "not_configured": 503,
                "key_rejected": 400}
CONTEXT_STATUS = {"book_not_found": 404, "region_not_found": 404}
MESSAGES = {
    "no_consent": "Turn on Steve first: he needs your consent before he reads along.",
    "disabled": "Steve is switched off. Turn him on in his settings to ask.",
    "in_test": "Steve waits while a test is open on this book.",
    "too_large": "That image is too large for Steve.",
    "bad_image": "Steve can only read a PNG image.",
    "thread_not_found": "That conversation was not found.",
    "paused_quota": "Steve is resting for now.",
    "daily_limit": "You have used today's shared questions.",
    "timeout": "Steve took too long to answer. Try again.",
    "unavailable": "Steve cannot answer right now. Try again soon.",
    "not_configured": "Steve is not set up on this server yet.",
    "key_rejected": "Google did not accept your key. Add it again in Steve's settings.",
    "not_pdf_equation": "Only a PDF equation is turned into LaTeX by Steve; an EPUB's is copied on your device.",
    "needs_image": "Steve needs the equation's picture to read it.",
    "book_not_found": "That book was not found.",
    "region_not_found": "That part of the page was not found.",
}


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    book_id: str = Field(min_length=1, max_length=64)
    thread_id: str | None = Field(default=None, max_length=64)
    question: str = Field(min_length=1, max_length=policy.QUESTION_MAX_CHARS)
    mode: Literal["ask", "explain_highlight", "explain_equation", "latex_equation", "explain_code",
                  "explain_figure"] = "ask"
    anchor: Annotated[PdfAnchor | EpubAnchor, Field(discriminator="kind")] | None = None
    image_png_b64: str | None = None
    region_id: str | None = Field(default=None, max_length=64,
                                  validation_alias=AliasChoices("region_id", "code_region_id"))
    utc_offset_minutes: int = Field(default=0, ge=-policy.UTC_OFFSET_LIMIT_MINUTES,
                                    le=policy.UTC_OFFSET_LIMIT_MINUTES)


def fail(status: int, code: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": MESSAGES.get(code, code), **extra})


def _check_reader(user_id: str, book_id: str) -> None:
    rows = supabase.table("profiles").select("steve_enabled, steve_consent_at, steve_consent_version").eq(
        "user_id", user_id).execute().data
    profile = rows[0] if rows else {}
    if not profile.get("steve_consent_at") or profile.get("steve_consent_version") != consent.CONSENT_VERSION:
        raise fail(403, "no_consent")
    if profile.get("steve_enabled") is False:
        raise fail(403, "disabled")
    testing = supabase.table("sessions").select("id").eq("user_id", user_id).eq("book_id", book_id).eq(
        "status", "testing").limit(1).execute().data
    if testing:
        raise fail(409, "in_test")


def _image(encoded: str | None) -> dict | None:
    if encoded is None:
        return None
    if len(encoded) > (policy.ASK_IMAGE_MAX_BYTES * 4) // 3 + 4:
        raise fail(413, "too_large", max_bytes=policy.ASK_IMAGE_MAX_BYTES)
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise fail(422, "bad_image") from None
    if len(data) > policy.ASK_IMAGE_MAX_BYTES:
        raise fail(413, "too_large", max_bytes=policy.ASK_IMAGE_MAX_BYTES)
    if not data.startswith(PNG_SIGNATURE):
        raise fail(422, "bad_image")
    return {"mime_type": "image/png", "data": data}


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _paused(unavailable: SteveUnavailable) -> HTTPException:
    extra = {"until": unavailable.until.isoformat()} if unavailable.until else {}
    return fail(PAUSE_STATUS.get(unavailable.reason, 503), unavailable.reason, **extra)


@router.post("/ask")
async def ask(req: AskRequest, user_id: str = Depends(get_current_user)):
    await run_in_threadpool(_check_reader, user_id, req.book_id)
    image = _image(req.image_png_b64)
    thread = None
    if req.thread_id:
        thread = await run_in_threadpool(threads.get_thread, user_id, req.thread_id)
        if thread is None or thread["book_id"] != req.book_id:
            raise fail(404, "thread_not_found")
    anchor = req.anchor.model_dump() if req.anchor else None
    try:
        ctx = await build_context(user_id=user_id, book_id=req.book_id, question=req.question, anchor=anchor,
                                  image=image, region_id=req.region_id)
        prompt = prompts.build_prompt(ctx, req.mode)
    except (ContextError, prompts.PromptError) as error:
        raise fail(CONTEXT_STATUS.get(error.reason, 422), error.reason) from None
    answer = service.ask(user_id=user_id, book_id=req.book_id, question=f"{req.mode}\n{req.question}",
                         context_hash=ctx.context_hash, parts=prompt.parts, system=prompt.system,
                         model="vision" if image else "chat", stream=True,
                         utc_offset_minutes=req.utc_offset_minutes)
    try:
        first = await anext(answer)
    except SteveUnavailable as unavailable:
        raise _paused(unavailable) from None
    except StopAsyncIteration:
        first = None
    if thread is None:
        thread = await run_in_threadpool(threads.create_thread, user_id, req.book_id)
    await run_in_threadpool(lambda: threads.add_message(thread_id=thread["id"], user_id=user_id, role="reader",
                                                        content=req.question, anchor=anchor))
    pages = sorted(ctx.citations, key=prompts.label_key)

    async def stream():
        yield _event("start", {"thread_id": thread["id"], "pages": pages})
        pieces, last = [], first
        try:
            if first is not None:
                pieces.append(first.text)
                yield _event("token", {"text": first.text})
                async for piece in answer:
                    pieces.append(piece.text)
                    last = piece
                    yield _event("token", {"text": piece.text})
        except SteveUnavailable as unavailable:
            logger.info("steve.ask stream stopped mode=%s status=%s", req.mode, unavailable.reason)
            yield _event("error", {"code": unavailable.reason, "message": MESSAGES.get(unavailable.reason, "")})
            return
        raw = "".join(pieces)
        if req.mode == "latex_equation":
            text, used = prompts.clean_latex(raw), []
        else:
            text, used = prompts.clean_citations(raw, ctx.citations)
        citations = [{"label": label, "anchor": anchor_} for label, anchor_ in used]
        usage = {"model": last.model if last else None, "tokens_in": last.tokens_in if last else None,
                 "tokens_out": last.tokens_out if last else None, "cached": bool(last and last.cached)}
        saved = await run_in_threadpool(lambda: threads.add_message(
            thread_id=thread["id"], user_id=user_id, role="steve", content=text, citations=citations,
            model=usage["model"], tokens_in=usage["tokens_in"], tokens_out=usage["tokens_out"]))
        logger.info("steve.ask done mode=%s chars=%d citations=%d cached=%s tokens_in=%s tokens_out=%s", req.mode,
                    len(text), len(citations), usage["cached"], usage["tokens_in"], usage["tokens_out"])
        yield _event("done", {"message_id": saved["id"], "thread_id": thread["id"], "text": text,
                              "citations": citations, "usage": usage})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/threads")
async def list_threads(book_id: str = Query(min_length=1, max_length=64), user_id: str = Depends(get_current_user)):
    return {"threads": await run_in_threadpool(threads.list_threads, user_id, book_id)}


@router.get("/threads/{thread_id}")
async def get_thread(thread_id: str, user_id: str = Depends(get_current_user)):
    found = await run_in_threadpool(threads.thread_with_messages, user_id, thread_id)
    if found is None:
        raise fail(404, "thread_not_found")
    return found


class LatexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    book_id: str = Field(min_length=1, max_length=64)
    region_id: str = Field(min_length=1, max_length=64)
    image_png_b64: str | None = None
    utc_offset_minutes: int = Field(default=0, ge=-policy.UTC_OFFSET_LIMIT_MINUTES,
                                    le=policy.UTC_OFFSET_LIMIT_MINUTES)


def bbox_hash(bbox) -> str:
    """The equation's box rounded to a tenth of a point, hashed: the same box on any copy of the file."""
    rounded = json.dumps([round(float(v), 1) for v in bbox], separators=(",", ":"))
    return hashlib.sha256(rounded.encode()).hexdigest()[:32]


def _pdf_equation(user_id: str, book_id: str, region_id: str) -> tuple[dict, dict]:
    books = supabase.table("books").select("id, file_sha256").eq("id", book_id).eq("user_id", user_id).execute().data
    if not books:
        raise fail(404, "book_not_found")
    rows = supabase.table("page_regions").select("id, kind, page, bbox").eq("id", region_id).eq(
        "book_id", book_id).execute().data
    if not rows:
        raise fail(404, "region_not_found")
    region = rows[0]
    if region["kind"] != "math" or not region.get("page") or not region.get("bbox"):
        raise fail(422, "not_pdf_equation")
    return books[0], region


def _cached(key: dict) -> dict | None:
    if not key["file_sha256"]:
        return None
    rows = supabase.table("equation_latex").select("latex, model").eq("file_sha256", key["file_sha256"]).eq(
        "page", key["page"]).eq("bbox_hash", key["bbox_hash"]).execute().data
    return rows[0] if rows else None


@router.post("/latex")
async def equation_latex(req: LatexRequest, user_id: str = Depends(get_current_user)):
    """A PDF equation as LaTeX (C20.8, docs/STEVE.md S14). Known for this file (any reader's copy): returned with
    no call and no consent needed, since nothing is sent. Otherwise the reader's checks, then one non-streamed
    latex_equation call on the vision model with the crop, stored for every reader of this file."""
    book, region = await run_in_threadpool(_pdf_equation, user_id, req.book_id, req.region_id)
    key = {"file_sha256": book.get("file_sha256"), "page": region["page"], "bbox_hash": bbox_hash(region["bbox"])}
    known = await run_in_threadpool(_cached, key)
    if known:
        return {"latex": known["latex"], "cached": True, "model": known.get("model")}
    await run_in_threadpool(_check_reader, user_id, req.book_id)
    image = _image(req.image_png_b64)
    if image is None:
        raise fail(422, "needs_image")
    try:
        ctx = await build_context(user_id=user_id, book_id=req.book_id, question="Copy this equation as LaTeX.",
                                  image=image, region_id=req.region_id)
        prompt = prompts.build_prompt(ctx, "latex_equation")
    except (ContextError, prompts.PromptError) as error:
        raise fail(CONTEXT_STATUS.get(error.reason, 422), error.reason) from None
    pieces, model = [], None
    try:
        async for piece in service.ask(user_id=user_id, book_id=req.book_id, question="latex_equation\nlatex",
                                       context_hash=ctx.context_hash, parts=prompt.parts, system=prompt.system,
                                       model="vision", stream=False, utc_offset_minutes=req.utc_offset_minutes):
            pieces.append(piece.text)
            model = piece.model
    except SteveUnavailable as unavailable:
        raise _paused(unavailable) from None
    latex = prompts.clean_latex("".join(pieces))
    if not latex:
        raise fail(503, "unavailable")
    if key["file_sha256"]:
        await run_in_threadpool(lambda: supabase.table("equation_latex").upsert(
            {**key, "latex": latex, "model": model}, on_conflict="file_sha256,page,bbox_hash",
            ignore_duplicates=True).execute())
    logger.info("steve.latex stored chars=%d model=%s", len(latex), model)
    return {"latex": latex, "cached": False, "model": model}
