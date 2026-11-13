"""Garble detector: does extracted text carry broken-extraction artefacts?

Pure functions, no I/O. Math and code are not garbage: operators between
words, Greek letters, primes and braces are all fine. What is flagged is
what a broken font map or a glyph-by-glyph extraction leaves behind:

- replacement:    U+FFFD, a character the extractor could not decode
- private_use:    Private Use Area code points (a font's own glyph ids)
- cid:            pdfminer's "(cid:NN)" for a glyph with no Unicode mapping
- control:        C0/C1 control characters other than tab and line breaks
- symbol_in_word: a math symbol glued inside a word ("anti∫derivative")
- spaced_letters: a long run of single letters separated by spaces
- ligature:       the gap a dropped fi/ff/fl/ffi/ffl ligature leaves
                  ("de nition", "e ect", " rst")

garble_score returns the share of visible characters inside a flagged span
and the reasons found; is_garbled applies the thresholds in policy.py.
"""

import re

from backend.agents import policy

REASONS = ("replacement", "private_use", "cid", "control", "symbol_in_word", "spaced_letters", "ligature")

MATH_SYMBOLS = "∀-⋿⨀-⫿←-⇿⌠⌡⎲⎳"
PATTERNS = {
    "replacement": re.compile("�"),
    "private_use": re.compile("[-\U000f0000-\U000ffffd\U00100000-\U0010fffd]"),
    "cid": re.compile(r"\(cid:\d+\)"),
    "control": re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]"),
    "symbol_in_word": re.compile(f"(?<=[^\\W\\d_])[{MATH_SYMBOLS}](?=[^\\W\\d_])"),
}
# A maximal run of one-character tokens separated by single spaces.
SINGLES = re.compile(r"(?<!\S)\S(?: \S)+(?!\S)")

# Common words that contain a ligature. Each becomes the pattern of the gap
# its dropped ligature leaves; a fragment must stand as its own word.
LIGATURE_WORDS = (
    "affect", "benefit", "classified", "classify", "coefficient", "coefficients", "define", "defined",
    "defines", "definite", "definition", "definitions", "difference", "different", "differential",
    "difficult", "effect", "effective", "effects", "efficient", "field", "fields", "figure", "figures",
    "final", "finally", "find", "finite", "first", "fixed", "flow", "fluid", "flux", "identify",
    "infinite", "infinity", "influence", "modified", "modify", "offer", "office", "profile",
    "reflect", "reflection", "satisfies", "satisfy", "scientific", "significant", "specific",
    "specified", "sufficient", "suffix", "verify", "official", "affine", "simplify", "simplified",
)
LIGATURES = re.compile("ffi|ffl|ff|fi|fl")
MIN_LONE_FRAGMENT = 3  # a word that starts with its ligature leaves only its tail ("rst")


def _ligature_pattern() -> re.Pattern:
    gaps = set()
    for word in LIGATURE_WORDS:
        for match in LIGATURES.finditer(word):
            head, tail = word[: match.start()], word[match.end():]
            if head and tail:
                gaps.add(f"{head} {tail}")
            elif tail and len(tail) >= MIN_LONE_FRAGMENT:
                gaps.add(tail)
    alternatives = "|".join(sorted((re.escape(g) for g in gaps), key=len, reverse=True))
    return re.compile(rf"(?<![\w-])(?:{alternatives})(?![\w-])", re.IGNORECASE)


PATTERNS["ligature"] = _ligature_pattern()


def _spaced_letter_spans(text: str):
    for run in SINGLES.finditer(text):
        letters = [m for m in re.finditer(r"[^\W\d_]", run.group())]
        if len(letters) >= policy.GARBLE_SPACED_RUN:
            yield [(run.start() + m.start(), run.start() + m.end()) for m in letters]


def garble_score(text: str) -> dict:
    """{"ratio": share of visible characters in flagged spans (0..1), "reasons": [...]}."""
    flagged = bytearray(len(text))
    found = set()
    for reason, pattern in PATTERNS.items():
        for match in pattern.finditer(text):
            found.add(reason)
            flagged[match.start():match.end()] = b"\x01" * (match.end() - match.start())
    for spans in _spaced_letter_spans(text):
        found.add("spaced_letters")
        for start, end in spans:
            flagged[start:end] = b"\x01" * (end - start)
    visible = [i for i, char in enumerate(text) if not char.isspace()]
    ratio = sum(flagged[i] for i in visible) / len(visible) if visible else 0.0
    return {"ratio": ratio, "reasons": [r for r in REASONS if r in found]}


def is_garbled(text: str) -> bool:
    score = garble_score(text)
    if any(reason in policy.GARBLE_HARD_REASONS for reason in score["reasons"]):
        return True
    return score["ratio"] >= policy.GARBLE_MAX_RATIO
