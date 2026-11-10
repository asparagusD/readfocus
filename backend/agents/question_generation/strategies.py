"""Extractive question strategies. Pure functions: no I/O, no model, no clock.

Each strategy takes the sentences of one chunk (sentences_of) and the
chunk's concepts (backend.nlp.concepts) and returns Questions. Anything a
strategy needs beyond text, such as embedding vectors, is passed in.

Every Question carries its `evidence`: the sentence or sentences it was
built from, exactly as they stand in the chunk (line breaks and curly
quotes included), so each piece satisfies `piece in chunk`.

cloze       blank the highest-weight concept in an informative sentence
definition  "What is X?" for "X is a ...", "X refers to ...", "known as X"
why_how     a sentence with a causal marker: ask for the cause it states
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
_IS_A = re.compile(r"\s+(?:is|are)\s+(?:an?|the)\b", re.IGNORECASE)
_MEANS = re.compile(r"\s+(?:refers? to|means?|(?:is|are|can be) (?:defined as|known as|called))\b", re.IGNORECASE)
_NAMED = re.compile(r"\b(?:known as|defined as|called|termed)\s+(?:(?:an?|the)\s+)?$", re.IGNORECASE)
_PLURAL_VERB = ("are ", "refer to", "mean ")
_CAUSAL = re.compile(r"\b(because|therefore|as a result|(?:leads?|led|leading) to)\b", re.IGNORECASE)
_CLAUSE_END = re.compile(r"(?:[,;:]|\band)\s*$")           # what must stand before a mid-sentence "therefore"
_HEAD_TRIM = re.compile(r"(?:[\s,;:]+(?:and|so))?[\s,;:]*$")  # ", and" left at the end of the first clause
_EDGES = " ,;:."


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


def _key_terms(source: str, exclude: str = "") -> list[str]:
    skip = set(text.tokenize(exclude))
    terms = dict.fromkeys(word for word in text.content_words(source) if word not in skip)
    return list(terms)[: policy.KEY_TERMS_MAX]


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


def _defined_term(sentence: str, match: re.Match) -> tuple[str, bool] | None:
    """(term as worded for the prompt, is plural) if the match is being defined in the sentence."""
    before, after = sentence[: match.start()], sentence[match.end():]
    term = match.group(0)
    if _NAMED.search(before):
        return term, False
    is_subject = len(before.split()) <= policy.DEFINITION_MAX_LEAD_WORDS and "," not in before
    if not is_subject or not (_IS_A.match(after) or _MEANS.match(after)):
        return None
    if match.start() == 0 and not term.isupper():
        term = term[0].lower() + term[1:]
    return term, after.lstrip().lower().startswith(_PLURAL_VERB)


def definition(sentences: list[Sentence], concepts: list[Concept]) -> list[Question]:
    """'What is X?' for each sentence that defines a concept; the sentence is the answer."""
    questions = []
    ranked = _strongest_first(concepts)
    for sentence in sentences:
        defined = next(
            ((concept, found) for concept in ranked for pattern in _patterns(concept)
             for match in [pattern.search(sentence.text)] if match
             for found in [_defined_term(sentence.text, match)] if found),
            None,
        )
        if defined is None:
            continue
        concept, (term, plural) = defined
        questions.append(Question(
            type="factual", strategy="definition", prompt=f"What {'are' if plural else 'is'} {term}?",
            answer=sentence.text, evidence=[sentence.span], key_terms=_key_terms(sentence.text, exclude=term),
            difficulty=policy.DIFFICULTY["definition"], concept=concept.label,
        ))
    return questions


def _cause_and_statement(sentences: list[Sentence], sentence: Sentence) -> tuple[str, str, list[str], str] | None:
    """(cause, statement, evidence, marker) for a sentence with a causal marker, or None."""
    match = _CAUSAL.search(sentence.text)
    if match is None:
        return None
    marker = match.group(1).lower()
    before = sentence.text[: match.start()]
    head = _HEAD_TRIM.sub("", before).strip()
    tail = sentence.text[match.end():].strip(_EDGES)
    evidence = [sentence.span]
    if marker == "because":
        if head:
            cause, statement = f"because {tail}", head
        else:  # "Because X, Y."
            cause, _, statement = tail.partition(", ")
            cause = f"because {cause}"
    elif marker.endswith(" to"):  # leads to: the cause stands before the marker
        cause, statement = head, tail
    elif head:  # "X, and as a result Y": only between two clauses
        if not _CLAUSE_END.search(before):
            return None
        cause, statement = head, tail
    elif sentence.index > 0:  # "Therefore, Y.": the cause is the sentence before
        previous = sentences[sentence.index - 1]
        cause, statement, evidence = previous.text, tail, [previous.span, sentence.span]
    else:
        return None
    if len(statement.split()) < policy.WHY_MIN_STATEMENT_WORDS or len(cause.split()) < policy.WHY_MIN_CAUSE_WORDS:
        return None
    return cause, statement, evidence, marker


def why_how(sentences: list[Sentence]) -> list[Question]:
    """One question per sentence with a causal marker; the answer is the causal clause."""
    questions = []
    for sentence in sentences:
        found = _cause_and_statement(sentences, sentence)
        if found is None:
            continue
        cause, statement, evidence, marker = found
        if marker.endswith(" to"):
            prompt = f"According to the passage, what leads to {statement}?"
        else:
            prompt = f'According to the passage, why is this so: "{statement[0].upper()}{statement[1:]}"?'
        questions.append(Question(
            type="inference", strategy="why_how", prompt=prompt, answer=cause, evidence=evidence,
            key_terms=_key_terms(cause), difficulty=policy.DIFFICULTY["why_how"],
        ))
    return questions
