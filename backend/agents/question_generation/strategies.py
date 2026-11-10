"""Extractive question strategies. Pure functions: no I/O, no model, no clock.

Each strategy takes the sentences of one chunk (sentences_of) and the
chunk's concepts (backend.nlp.concepts) and returns Questions. Anything a
strategy needs beyond text, such as embedding vectors, is passed in.

Every Question carries its `evidence`: the sentence or sentences it was
built from, exactly as they stand in the chunk (line breaks and curly
quotes included), so each piece satisfies `piece in chunk`.

cloze       blank the highest-weight concept in an informative sentence
"""

import re

from pydantic import BaseModel

from backend.agents import policy
from backend.nlp import text
from backend.nlp.concepts import Concept


class Sentence(BaseModel):
    index: int
    text: str  # normalised: what questions are worded from
    span: str  # the same sentence exactly as it stands in the chunk


class Question(BaseModel):
    type: str  # factual, inference or summary
    strategy: str
    prompt: str
    answer: str
    evidence: list[str]
    key_terms: list[str] = []
    distractors: list[str] = []
    difficulty: float
    concept: str | None = None  # label of the concept the question is about


_EITHER_QUOTE = {"'": "['‘’]", '"': '["“”]'}


def _span_pattern(sentence: str) -> str:
    """A regex for the sentence as it may stand in the raw chunk: any whitespace, either quote style."""
    words = []
    for word in sentence.split():
        escaped = re.escape(word)
        for plain, either in _EITHER_QUOTE.items():
            escaped = escaped.replace(plain, either)
        words.append(escaped)
    return r"\s+".join(words)


def sentences_of(chunk: str) -> list[Sentence]:
    """The chunk's sentences, each with its verbatim span.

    A sentence that normalising rewrote beyond spaces and quotes (a word
    hyphenated across a line break, a ligature) has no verbatim span and is
    left out: no evidence, no question.
    """
    found: list[Sentence] = []
    position = 0
    for sentence in text.split_sentences(chunk):
        match = re.compile(_span_pattern(sentence)).search(chunk, position)
        if match is None:
            continue
        position = match.end()
        found.append(Sentence(index=len(found), text=sentence, span=match.group(0)))
    return found


def _word_pattern(word: str) -> str:
    if word.endswith("y") and len(word) > 3:
        return re.escape(word[:-1]) + "(?:y|ies)"
    return re.escape(word) + "(?:e?s)?"


def _patterns(concept: Concept) -> list[re.Pattern]:
    """Whole-word, any-case patterns for a concept's label and aliases, plurals included."""
    return [
        re.compile(r"(?<![\w-])" + r"[\s-]+".join(map(_word_pattern, label.split())) + r"(?![\w-])", re.IGNORECASE)
        for label in [concept.label, *concept.aliases]
        if label.split()
    ]


def _strongest_first(concepts: list[Concept]) -> list[Concept]:
    return sorted(concepts, key=lambda concept: (-concept.weight, concept.label))


def cloze(sentences: list[Sentence], concepts: list[Concept]) -> list[Question]:
    """One fill-in-the-blank per informative sentence: its highest-weight concept is blanked."""
    questions = []
    ranked = _strongest_first(concepts)
    for sentence in sentences:
        if text.informativeness(sentence.text) < policy.CLOZE_MIN_INFORMATIVENESS:
            continue
        for concept in ranked:
            patterns = _patterns(concept)
            match = next((m for m in (p.search(sentence.text) for p in patterns) if m), None)
            if match is None:
                continue
            blanked = sentence.text
            for pattern in patterns:  # every form of the answer goes, or the prompt gives it away
                blanked = pattern.sub(policy.BLANK, blanked)
            questions.append(Question(
                type="factual", strategy="cloze", prompt=f"Fill in the blank: {blanked}",
                answer=match.group(0), evidence=[sentence.span], key_terms=[concept.label],
                difficulty=policy.DIFFICULTY["cloze"], concept=concept.label,
            ))
            break
    return questions
