"""Question generation agent: fills question_bank for chunks of a book.

QuestionGenerationAgent.run(book_id, chunk_ids) reads the chunks, builds
questions from their own sentences (strategies.py), filters and scores
them (quality.py) and stores what is left. No LLM: the only model is the
local embedder, used for sentence, concept and prompt vectors.

The deciding is done by pure functions (body_sentences, generate,
quality.filter_questions, to_row); run() does the I/O around them. Storing
is idempotent: the table's unique rule on (chunk_id, strategy, prompt_hash)
and ON CONFLICT DO NOTHING mean a second run adds nothing.
"""

import hashlib
from collections import Counter

import numpy as np
from pydantic import BaseModel

from backend.agents.question_generation import quality, strategies
from backend.agents.question_generation.strategies import Question, Sentence
from backend.nlp import concepts as concept_extraction
from backend.nlp import embedder
from backend.nlp.concepts import Concept
from backend.services import concept_store
from backend.services.supabase_client import supabase

# question_bank.evidence is one text column; a sentence never contains a
# blank line, so the pieces can be split apart again.
EVIDENCE_SEPARATOR = "\n\n"
CONFLICT_COLUMNS = "chunk_id,strategy,prompt_hash"


class GenerationReport(BaseModel):
    book_id: str
    chunks: int = 0      # chunks read
    generated: int = 0   # questions the strategies produced
    accepted: int = 0    # questions that passed the filter
    stored: int = 0      # rows that were new in question_bank
    by_type: dict[str, int] = {}
    by_strategy: dict[str, int] = {}
    rejected: dict[str, int] = {}
    average_quality: float | None = None  # of the accepted questions


def body_sentences(chunk: str) -> list[Sentence]:
    """The chunk's sentences without front matter, reference entries and page furniture, renumbered."""
    kept = [s for s in strategies.sentences_of(chunk) if quality.boilerplate_reason(s.span) is None]
    return [sentence.model_copy(update={"index": index}) for index, sentence in enumerate(kept)]


def generate(
    sentences: list[Sentence], concepts: list[Concept], sentence_vectors: np.ndarray,
    concept_vectors: dict[str, np.ndarray],
) -> list[Question]:
    """Every question the strategies can make from one chunk."""
    cloze = strategies.cloze(sentences, concepts)
    return [
        *cloze,
        *strategies.multiple_choice(cloze, concept_vectors),
        *strategies.definition(sentences, concepts),
        *strategies.why_how(sentences),
        *strategies.main_idea(sentences, concepts, sentence_vectors),
    ]


def prompt_hash(prompt: str) -> str:
    """The same for prompts that differ only in case and spacing."""
    return hashlib.sha256(" ".join(prompt.lower().split()).encode("utf-8")).hexdigest()[:32]


def to_row(question: Question, chunk: dict) -> dict:
    """A question as a question_bank row for its chunk."""
    return {
        "user_id": chunk["user_id"], "book_id": chunk["book_id"], "chunk_id": chunk["id"],
        "chunk_index": chunk["chunk_index"], "type": question.type, "prompt": question.prompt,
        "answer": question.answer, "evidence": EVIDENCE_SEPARATOR.join(question.evidence),
        "key_terms": question.key_terms, "distractors": question.distractors,
        "difficulty": question.difficulty, "strategy": question.strategy, "quality": question.quality,
        "prompt_hash": prompt_hash(question.prompt),
    }


def _filtered(questions: list[Question]) -> quality.FilterResult:
    """Embed the prompts that can still be used and run the quality filter."""
    vectors = np.zeros((len(questions), embedder.EMBEDDING_DIM))
    usable = [i for i, question in enumerate(questions) if quality.reject_reason(question) is None]
    if usable:
        vectors[usable] = embedder.embed([questions[i].prompt for i in usable])
    return quality.filter_questions(questions, vectors)


class QuestionGenerationAgent:
    def run(self, book_id: str, chunk_ids: list[str]) -> GenerationReport:
        """Generate and store the questions for these chunks of the book. Safe to run again."""
        report = GenerationReport(book_id=book_id)
        if not chunk_ids:
            return report
        query = supabase.table("chunks").select("id, book_id, user_id, chunk_index, content")
        found = query.eq("book_id", book_id).in_("id", chunk_ids).execute().data or []
        prepared = []
        for chunk in sorted(found, key=lambda row: row["chunk_index"]):
            sentences = body_sentences(chunk["content"])
            # Concepts come from the body text only, so a name in the front matter cannot be the topic.
            body = " ".join(sentence.text for sentence in sentences)
            prepared.append((chunk, sentences, concept_extraction.extract_concepts(body, use_embeddings=False)))
        try:  # the book's concepts are kept for the knowledge state; questions do not depend on it
            concept_store.save([(chunk, concepts) for chunk, _, concepts in prepared])
        except Exception as error:  # noqa: BLE001
            print(f"Storing concepts failed for book {book_id}: {error}")
        # Distractors come from the concepts of the chunks in this batch.
        labels = sorted({concept.label for _, _, concepts in prepared for concept in concepts})
        concept_vectors = dict(zip(labels, embedder.embed(labels))) if labels else {}

        rows, accepted, rejected = [], [], Counter()
        for chunk, sentences, concepts in prepared:
            if sentences:
                sentence_vectors = embedder.embed([sentence.text for sentence in sentences])
            else:
                sentence_vectors = np.zeros((0, embedder.EMBEDDING_DIM))
            questions = generate(sentences, concepts, sentence_vectors, concept_vectors)
            result = _filtered(questions)
            report.generated += len(questions)
            rejected.update(result.counts())
            accepted.extend(result.accepted)
            rows.extend(to_row(question, chunk) for question in result.accepted)

        report.chunks = len(prepared)
        report.accepted = len(accepted)
        report.by_type = dict(Counter(question.type for question in accepted))
        report.by_strategy = dict(Counter(question.strategy for question in accepted))
        report.rejected = dict(rejected)
        if accepted:
            report.average_quality = round(sum(question.quality for question in accepted) / len(accepted), 4)
        if rows:
            upsert = supabase.table("question_bank").upsert(rows, on_conflict=CONFLICT_COLUMNS, ignore_duplicates=True)
            report.stored = len(upsert.execute().data or [])
        return report
