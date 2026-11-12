"""Session tests from the question bank: the I/O around the pure assembler.

assemble_session_test reads the bank rows of a session's chunks, has the
question generation agent fill in chunks that have none (books ingested
before the bank existed), picks the questions, stores them with the session
and counts their use. It is synchronous: run it as a background task or in
a worker thread.

A session's test is stored once: the background run at start and the
inline run in finish-reading can overlap, and the test the reader is shown
must be the one that is graded (issue 34). The store is conditional on the
session having no test yet; the run that loses returns the stored test and
counts nothing.
"""

from collections import defaultdict

from backend.agents.question_generation import assembler
from backend.agents.question_generation.agent import QuestionGenerationAgent
from backend.agents.question_generation.assembler import AssemblyInput, BankQuestion
from backend.services import concept_store
from backend.services.supabase_client import supabase

question_agent = QuestionGenerationAgent()


def _bank_rows(user_id: str, book_id: str, chunk_indices: list[int]) -> list[dict]:
    query = supabase.table("question_bank").select("*").eq("user_id", user_id).eq("book_id", book_id)
    return query.in_("chunk_index", chunk_indices).execute().data or []


def _generate_missing(book_id: str, chunk_indices: list[int]) -> bool:
    """Generate the bank rows of chunks that have none. True if the agent ran."""
    query = supabase.table("chunks").select("id, chunk_index").eq("book_id", book_id)
    chunks = query.in_("chunk_index", chunk_indices).execute().data or []
    chunk_ids = [chunk["id"] for chunk in sorted(chunks, key=lambda chunk: chunk["chunk_index"])]
    if not chunk_ids:
        return False
    try:
        question_agent.run(book_id, chunk_ids)
    except Exception as e:  # noqa: BLE001 - a test with a fallback question beats no test
        print(f"Question generation on demand failed for book {book_id}: {e}")
        return False
    return True


def _link_concepts(questions: list[dict], user_id: str, book_id: str, chunk_indices: list[int]) -> None:
    """Give each question `concept_keys`: the concepts of its own chunk that its key terms name."""
    try:
        concepts = concept_store.concepts_for_chunks(user_id, book_id, chunk_indices)
    except Exception as e:  # noqa: BLE001 - a test without concept links is still a test
        print(f"Reading concepts failed for book {book_id}: {e}")
        concepts = []
    concepts.sort(key=lambda row: (-(row["weight"] or 0.0), row["concept_key"]))
    for question in questions:
        own = [row for row in concepts if question.get("chunk_index") in row["chunk_indices"]]
        question["concept_keys"] = concept_store.link_key_terms(question.get("key_terms") or [], own)


def assemble_session_test(
    session_id: str, user_id: str, book_id: str, chunk_indices: list[int], mix: list | None = None,
) -> list[dict]:
    """Pick, store and return the session's test questions (the stored form, with answers)."""
    rows = _bank_rows(user_id, book_id, chunk_indices)
    without_rows = sorted(set(chunk_indices) - {row["chunk_index"] for row in rows})
    if without_rows and _generate_missing(book_id, without_rows):
        rows = _bank_rows(user_id, book_id, chunk_indices)

    picked = assembler.decide(AssemblyInput(questions=[BankQuestion(**row) for row in rows], mix=mix)).questions
    questions = [assembler.session_question(question) for question in picked] or [assembler.fallback_question()]
    _link_concepts(questions, user_id, book_id, chunk_indices)
    stored = supabase.table("sessions").update({"test_questions": questions}).eq("id", session_id).eq(
        "user_id", user_id).is_("test_questions", "null").execute().data
    if not stored:  # another run stored this session's test first: that one is shown and graded
        rows = supabase.table("sessions").select("test_questions").eq("id", session_id).eq("user_id", user_id).execute().data
        return (rows[0].get("test_questions") if rows else None) or questions

    by_use = defaultdict(list)
    for question in picked:
        by_use[question.times_used or 0].append(question.id)
    for used, ids in by_use.items():  # one update per distinct count: usually a single round trip
        supabase.table("question_bank").update({"times_used": used + 1}).in_("id", ids).execute()
    return questions
