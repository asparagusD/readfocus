"""The bookmark-range quiz around the pure parts (C23.5, docs/FOCUS_RULES.md F10-F12): build it from the question
bank (generating questions for range chunks that have none), keep it on a `sessions` row whose id is the focus
session's, so the existing submit_answers flow grades it, stores test_results and moves mastery (event id = the
focus session), then score the focus session with the C23.3 engine. Synchronous: run in a worker thread."""

from backend.agents import policy as agent_policy
from backend.agents.question_generation import assembler
from backend.agents.question_generation.assembler import BankQuestion
from backend.agents.workflow import run_submit
from backend.focus import range_quiz as rq
from backend.focus import store
from backend.focus.scoring import Event, Quiz, ScoringInput, decide
from backend.services import question_bank
from backend.services.supabase_client import supabase

PART = store.PART


def _end_anchor(session: dict) -> dict | None:
    """The bookmark, or for a session the 3-hour cap ended, its last place (the whole of that page or section)."""
    if session.get("end_anchor"):
        return session["end_anchor"]
    if session.get("end_position") is None:
        return None
    unit = int(session["end_position"] // PART)
    if session["start_anchor"]["kind"] == "pdf":
        return {"kind": "pdf", "page": unit, "quads": [[0, 0, 0, 0]], "text": ""}
    return {"kind": "epub", "cfi": f"epubcfi(/6/{2 * (unit + 1)}!/99999)", "text": ""}


def _chunks(book_id: str, columns: str, indices: list[int] | None = None) -> list[dict]:
    query = supabase.table("chunks").select(columns).eq("book_id", book_id)
    if indices is not None:
        query = query.in_("chunk_index", indices)
    return query.execute().data or []


def _slices(book: dict, start: dict, end: dict) -> tuple[list[rq.Slice], dict[int, str]]:
    """The range's slices and the text of each chunk in it (for where its questions' evidence is)."""
    kind = "pdf" if start["kind"] == "pdf" else "epub"
    first, last = store.unit_of(start), store.unit_of(end)
    slices: list[rq.Slice] = []
    if kind == "pdf":
        mapped = [c for c in _chunks(book["id"], "chunk_index, anchors") if (c.get("anchors") or {}).get("pages")]
        near = [c["chunk_index"] for c in mapped if c["anchors"]["pages"][0] <= last and c["anchors"]["pages"][1] >= first]
        rows = _chunks(book["id"], "chunk_index, anchors, prose, content", near) if near else []
        slices = rq.pdf_slices(rows, first, last)
        texts = {c["chunk_index"]: c.get("prose") or c.get("content") or "" for c in rows}
    else:
        paths = _chunks(book["id"], "chunk_index, block_paths")
        if any(c.get("block_paths") for c in paths):
            rows = _chunks(book["id"], "chunk_index, blocks, block_paths")
            slices = rq.epub_slices(rows, start["cfi"], end["cfi"])
            texts = {c["chunk_index"]: rq.BLOCK_JOIN.join(b.get("text") or "" for b in c.get("blocks") or []) for c in rows}
    if not slices:  # no anchors or block paths yet: whole chunks by the contents
        listed = _chunks(book["id"], "chunk_index")
        whole = rq.toc_slices([{**c, "content": ""} for c in listed], book.get("toc") or [], kind, first, last)
        rows = _chunks(book["id"], "chunk_index, prose, content", [s.chunk_index for s in whole]) if whole else []
        slices = rq.toc_slices(rows, book.get("toc") or [], kind, first, last)
        texts = {c["chunk_index"]: c.get("prose") or c.get("content") or "" for c in rows}
    return slices, texts


def _candidates(user_id: str, book_id: str, slices: list[rq.Slice], texts: dict[int, str]) -> list[rq.Candidate]:
    indices = [s.chunk_index for s in slices]
    out = []
    for row in question_bank._bank_rows(user_id, book_id, indices):
        bank = BankQuestion(**{k: row.get(k) for k in BankQuestion.model_fields})
        where = rq.position_in_range(slices, bank.chunk_index, rq.evidence_fraction(texts.get(bank.chunk_index, ""),
                                                                                    bank.evidence))
        if where is not None:
            out.append(rq.Candidate(position=where, question=bank))
    return out


def _preferences(user_id: str, book_id: str) -> tuple[list | None, float]:
    """The optimizer's question mix and a difficulty for the reader's recent scores (the planner's bands)."""
    rows = supabase.table("reading_progress").select("average_score, pace_recommendation").eq("user_id", user_id).eq(
        "book_id", book_id).execute().data or []
    progress = rows[0] if rows else {}
    mix = (progress.get("pace_recommendation") or {}).get("question_mix") or None
    average = progress.get("average_score")
    band = "mid" if average is None else "low" if average < agent_policy.PLANNER_LOW_SCORE * 100 else \
        "high" if average >= agent_policy.PLANNER_HIGH_SCORE * 100 else "mid"
    return mix, agent_policy.PLANNER_TARGET_DIFFICULTY[band]


def _assemble(user_id: str, book: dict, start: dict, end: dict | None) -> tuple[list[dict], float, list[int], list]:
    """The range's questions (stored form), its prose words, its chunk indices and the bank questions picked."""
    slices, texts = _slices(book, start, end) if end else ([], {})
    words = sum(s.words for s in slices)
    n = rq.question_count(words)
    candidates = _candidates(user_id, book["id"], slices, texts)
    # Top up: range chunks with no bank questions (too few in all, or a stretch of the range left uncovered)
    # get them now from their prose, with the C5 strategies, and persisted.
    asked = {c.question.chunk_index for c in candidates}
    missing = [s.chunk_index for s in slices if s.chunk_index not in asked]
    if missing and question_bank._generate_missing(book["id"], missing):
        candidates = _candidates(user_id, book["id"], slices, texts)
    mix, target = _preferences(user_id, book["id"])
    picked = rq.select(candidates, n, words, mix, target)
    questions = [assembler.session_question(c.question) for c in picked] or [assembler.fallback_question()]
    indices = [s.chunk_index for s in slices] or [0]
    question_bank._link_concepts(questions, user_id, book["id"], indices)
    return questions, words, indices, picked


def _keep(session_id: str, user_id: str, book_id: str, questions: list[dict], words: float, indices: list[int],
          picked: list, started_at: str | None) -> None:
    """The quiz on a sessions row, so submit_answers grades it and moves mastery; the picked questions counted."""
    supabase.table("sessions").insert({
        "id": session_id, "user_id": user_id, "book_id": book_id, "chunk_start_index": min(indices),
        "chunk_end_index": max(indices), "assigned_words": round(words), "status": "testing",
        "started_at": started_at, "test_questions": questions}).execute()
    for c in picked:
        supabase.table("question_bank").update({"times_used": (c.question.times_used or 0) + 1}).eq(
            "id", c.question.id).execute()


def build(session: dict) -> dict:
    """The session's quiz {questions (stored form), words_in_range, count}; built once and kept."""
    kept = supabase.table("sessions").select("test_questions").eq("id", session["id"]).eq(
        "user_id", session["user_id"]).execute().data
    if kept and kept[0].get("test_questions"):
        return {"questions": kept[0]["test_questions"], "words_in_range": session.get("words_in_range") or 0,
                "count": session.get("quiz_total") or len(kept[0]["test_questions"])}
    book = supabase.table("books").select("id, file_type, toc").eq("id", session["book_id"]).execute().data[0]
    questions, words, indices, picked = _assemble(session["user_id"], book, session["start_anchor"],
                                                  _end_anchor(session))
    _keep(session["id"], session["user_id"], book["id"], questions, words, indices, picked, session.get("started_at"))
    store.update_session(session, {"words_in_range": round(words), "quiz_total": len(questions),
                                   "quiz_question_ids": [q["id"] for q in questions if q.get("id")]})
    return {"questions": questions, "words_in_range": round(words), "count": len(questions)}


async def grade(session: dict, events: list[dict], answers: list[str], seconds: int) -> dict | None:
    """Grade once through submit_answers and score the focus session. None when it was already graded."""
    claimed = supabase.table("sessions").update({"status": "completed", "completed_at": store.stamp(store.now())}).eq(
        "id", session["id"]).eq("user_id", session["user_id"]).eq("status", "testing").execute().data
    if not claimed:
        return None
    row = claimed[0]
    indices = list(range(row["chunk_start_index"], row["chunk_end_index"] + 1))
    final = await run_submit(session["id"], session["user_id"], session["book_id"], indices, row["test_questions"],
                             answers, seconds)
    per_question = ((final or {}).get("evaluation_result") or {}).get("per_question") or []
    weighted, whole = rq.weighted_correct(per_question)
    total = len(row["test_questions"])
    scored = [Event(id=n, kind=e["kind"], server_ts=e["server_ts"], client_event_id=e.get("client_event_id"),
                    page_key=e.get("page_key"), had_input=e.get("had_input")) for n, e in enumerate(events)]
    out = decide(ScoringInput(events=scored, quiz=Quiz(correct=weighted, total=total)))
    store.update_session(session, {
        "status": "scored", "quiz_correct": whole, "quiz_total": total, "points_time": out.points_time,
        "points_bonus": out.points_bonus, "points_total": out.points_total, "active_seconds": out.active_seconds,
        "voided_seconds": out.voided_seconds, "rules_version": out.rules_version, "updated_at": store.stamp(store.now())})
    public = ("score", "max_score", "feedback", "confidence")
    graded = (final or {}).get("evaluation_result") or {}
    return {**store.view(session, events, out), "passed": out.passed, "quiz_score": weighted / total,
            "total_score": graded.get("total_score"), "max_score": graded.get("max_score"),
            "percentage": graded.get("percentage", weighted / total * 100),
            "points_bonus": out.points_bonus, "quiz_correct": whole, "quiz_total": total, "lines": [line.model_dump() for line in out.lines],
            "per_question": [{k: q.get(k) for k in public} for q in per_question]}
