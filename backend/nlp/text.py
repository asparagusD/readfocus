"""Text utilities for the local NLP layer. Standard library only, no I/O.

normalize        clean text extracted from a PDF or EPUB
split_sentences  sentences, with abbreviations, quotes and lists handled
tokenize         lower-case word tokens
content_words    tokens that are not stopwords
informativeness  0..1 score of how much a sentence is worth asking about

English only. Every function is pure: same input, same output.
"""

import re
import unicodedata

def _words(block: str) -> frozenset[str]:
    return frozenset(block.split())


STOPWORDS = _words("""
a about above after again against all also am an and any are as at be because been before being
below between both but by can could did do does doing down during each few for from further had
has have having he her here hers herself him himself his how i if in into is it its itself just
me more most my myself no nor not now of off on once only or other our ours ourselves out over
own same she should so some such than that the their theirs them themselves then there these
they this those through to too under until up very was we were what when where which while who
whom why will with would yes you your yours yourself yourselves
""")

# Words that end in a full stop without ending a sentence (written without it).
ABBREVIATIONS = _words("""
dr mr mrs ms prof st sr jr vs etc e.g i.e cf al fig vol ch pp ed eds inc ltd co
u.s u.k a.m p.m jan feb mar apr jun jul aug sep sept oct nov dec
""")

PRONOUN_OPENERS = _words("he she it they we you i this that these those him her them his their its")

# informativeness(): weights and limits.
FULL_LENGTH = (8, 30)   # words: a sentence in this band gets the full length score
ZERO_LENGTH = (3, 50)   # words: at or beyond these the length score is zero
LENGTH_WEIGHT = 0.5
DENSITY_WEIGHT = 0.5
DIGIT_BONUS = 0.1
PROPER_NOUN_BONUS = 0.1
PRONOUN_PENALTY = 0.2

_CHARS = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "­": None})
_BULLET = r"(?:[•*–-]|\d+[.)])"
_BULLET_LINE = re.compile(rf"\n(?=\s*{_BULLET}\s)")
_BULLET_PREFIX = re.compile(rf"^{_BULLET}\s+")
_BOUNDARY = re.compile(r"""[.!?]+["')\]]*\s+(?=["'(\[]?[A-Z0-9])""")
_TOKEN = re.compile(r"[a-z0-9]+(?:['-][a-z0-9]+)*")
_PROPER_NOUN = re.compile(r"(?<=\s)[\"'(]?[A-Z][a-z]+")


def normalize(text: str) -> str:
    """Clean extracted text; paragraphs and list items end up separated by a blank line.

    Joins words hyphenated across a line break, turns other single line
    breaks into spaces, straightens curly quotes, expands ligatures and
    collapses spaces. Normalising twice changes nothing.
    """
    text = unicodedata.normalize("NFKC", text).translate(_CHARS)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(?<=[a-z])-\n\s*(?=[a-z])", "", text)
    text = re.sub(r"\n\s*\n", "\n\n", text)
    text = _BULLET_LINE.sub("\n\n", text)
    paragraphs = (re.sub(r"\s+", " ", p).strip() for p in text.split("\n\n"))
    return "\n\n".join(p for p in paragraphs if p)


def _is_abbreviation(word: str) -> bool:
    word = word.strip("\"'([")
    if len(word) == 1 and word.isupper() and word not in "AI":
        return True  # an initial, as in "J. K. Rowling"
    return word.lower() in ABBREVIATIONS


def split_sentences(text: str) -> list[str]:
    """Split text into sentences. A paragraph or a list item always ends one."""
    sentences = []
    for paragraph in normalize(text).split("\n\n"):
        paragraph = _BULLET_PREFIX.sub("", paragraph)
        start = 0
        for match in _BOUNDARY.finditer(paragraph):
            words = paragraph[start:match.start()].split()
            if paragraph[match.start()] == "." and words and _is_abbreviation(words[-1]):
                continue
            sentences.append(paragraph[start:match.end()].strip())
            start = match.end()
        if paragraph[start:].strip():
            sentences.append(paragraph[start:].strip())
    return sentences


def tokenize(text: str) -> list[str]:
    """Lower-case word tokens; inner apostrophes and hyphens stay in the word."""
    return _TOKEN.findall(normalize(text).lower())


def content_words(text: str) -> list[str]:
    """Tokens that are not stopwords, in order."""
    return [token for token in tokenize(text) if token not in STOPWORDS]


def _length_score(words: int) -> float:
    (low, high), (zero_low, zero_high) = FULL_LENGTH, ZERO_LENGTH
    if low <= words <= high:
        return 1.0
    if words < low:
        return max(0.0, (words - zero_low) / (low - zero_low))
    return max(0.0, (zero_high - words) / (zero_high - high))


def informativeness(sentence: str) -> float:
    """How much a sentence carries, from 0 to 1.

    Half is length (best between 8 and 30 words), half is the share of
    words that are not stopwords. A number and a proper noun each add a
    bonus; opening with a pronoun, which leans on an earlier sentence, costs
    a penalty.
    """
    tokens = tokenize(sentence)
    content = [token for token in tokens if token not in STOPWORDS]
    if not content:
        return 0.0
    score = LENGTH_WEIGHT * _length_score(len(tokens)) + DENSITY_WEIGHT * len(content) / len(tokens)
    if any(char.isdigit() for char in sentence):
        score += DIGIT_BONUS
    if _PROPER_NOUN.search(normalize(sentence)):
        score += PROPER_NOUN_BONUS
    if tokens[0] in PRONOUN_OPENERS:
        score -= PRONOUN_PENALTY
    return min(1.0, max(0.0, score))
