"""Concepts of a chunk: YAKE key phrases, normalised and de-duplicated.

extract_concepts(text) returns the top concepts of one chunk, each with a
stable `key` (a slug of the normalised phrase), a `label`, a `weight` from
0 to 1 (1 is the strongest in the chunk) and the `aliases` merged into it.

Pipeline: YAKE phrases of up to three words -> lower-case, leading
determiners and stopwords stripped, plurals reduced -> near-duplicates
merged when rapidfuzz says the strings are at least 90% alike or their
embeddings have a cosine of at least 0.85 -> top K by weight. Overlapping
n-grams of one phrase ("convert light energy", "light energy", "absorb
light energy") also merge, when they share two words, and the shortest
names the group.

No API calls. The only I/O is loading the local embedding model, and only
when use_embeddings is true.
"""

import re
from functools import lru_cache

import numpy as np
import yake
from pydantic import BaseModel
from rapidfuzz import fuzz

from backend.nlp import embedder, text

MAX_WORDS = 3          # longest key phrase, in words
CANDIDATES = 30        # YAKE phrases considered before merging
FUZZY_MERGE = 90.0     # rapidfuzz ratio (0..100) at or above which phrases merge
COSINE_MERGE = 0.85    # embedding cosine at or above which phrases merge
SHARED_WORDS_MERGE = 2 # overlapping n-grams: phrases sharing this many words merge
DEFAULT_TOP_K = 10

_KEEP_FINAL_S = ("ss", "us", "is")
_UNCHANGED = frozenset({"series", "species", "news", "physics", "mathematics"})
_ES_ENDINGS = ("ches", "shes", "xes", "sses")


class Concept(BaseModel):
    key: str
    label: str
    weight: float
    aliases: list[str] = []


def lemma(word: str) -> str:
    """Reduce a plural noun to its singular; anything doubtful is left alone."""
    if len(word) <= 3 or word in _UNCHANGED or word.endswith(_KEEP_FINAL_S):
        return word
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith(_ES_ENDINGS):
        return word[:-2]
    return word.removesuffix("s")


def normalize_phrase(phrase: str) -> str:
    """Lower-case, strip stopwords (determiners included) from both ends, reduce plurals."""
    tokens = text.tokenize(phrase)
    while tokens and tokens[0] in text.STOPWORDS:
        tokens.pop(0)
    while tokens and tokens[-1] in text.STOPWORDS:
        tokens.pop()
    return " ".join(lemma(token) for token in tokens)


def concept_key(label: str) -> str:
    """A slug that is the same wherever the same normalised phrase appears."""
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def merge(candidates: list[tuple[str, float]], vectors: np.ndarray | None = None) -> list[Concept]:
    """Merge near-duplicate phrases; the heaviest phrase of each group names it.

    `candidates` are (normalised phrase, weight); `vectors`, if given, has
    one embedding per candidate, in the same order. Returns concepts by
    descending weight.
    """
    if vectors is not None:
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        vectors = vectors / np.where(norms == 0, 1.0, norms)
    order = sorted(range(len(candidates)), key=lambda i: (-candidates[i][1], candidates[i][0]))
    groups: list[tuple[int, Concept]] = []
    for index in order:
        label, weight = candidates[index]
        words = set(label.split())
        for head, concept in groups:
            members = [concept.label, *concept.aliases]
            overlaps = any(len(words & set(member.split())) >= SHARED_WORDS_MERGE for member in members)
            alike = overlaps or fuzz.ratio(label, concept.label) >= FUZZY_MERGE
            if not alike and vectors is not None:
                alike = float(vectors[index] @ vectors[head]) >= COSINE_MERGE
            if not alike:
                continue
            if overlaps and len(words) < len(concept.label.split()):
                # "light energy" names the group better than "convert light energy".
                label, concept.label = concept.label, label
                concept.key = concept_key(concept.label)
            if label != concept.label and label not in concept.aliases:
                concept.aliases.append(label)
            break
        else:
            groups.append((index, Concept(key=concept_key(label), label=label, weight=weight)))
    return [concept for _, concept in groups]


@lru_cache(maxsize=1)
def _extractor() -> yake.KeywordExtractor:
    return yake.KeywordExtractor(lan="en", n=MAX_WORDS, top=CANDIDATES)


def extract_concepts(chunk: str, top_k: int = DEFAULT_TOP_K, use_embeddings: bool = True) -> list[Concept]:
    """The top `top_k` concepts of one chunk of text, strongest first."""
    clean = text.normalize(chunk)
    if not clean:
        return []
    best: dict[str, float] = {}
    for phrase, score in _extractor().extract_keywords(clean):
        label = normalize_phrase(phrase)
        if len(label) > 1 and not label.replace(" ", "").isdigit():
            best[label] = min(float(score), best.get(label, float("inf")))  # YAKE: lower is better
    if not best:
        return []
    floor = min(best.values())
    candidates = [(label, round((floor + 1e-9) / (score + 1e-9), 4)) for label, score in best.items()]
    vectors = embedder.embed([label for label, _ in candidates]) if use_embeddings else None
    return merge(candidates, vectors)[:top_k]
