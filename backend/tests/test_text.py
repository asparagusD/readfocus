"""backend.nlp.text: normalisation, sentence splitting, tokens, informativeness."""

import pytest

from backend.nlp import text

SPLIT_CASES = [
    ("abbreviated title", "Dr. Smith arrived. He sat down.", ["Dr. Smith arrived.", "He sat down."]),
    ("e.g. before lower case", "Use tools, e.g. a timer, daily. It helps.",
     ["Use tools, e.g. a timer, daily.", "It helps."]),
    ("e.g. before a capital", "Use a language, e.g. Python. It helps.",
     ["Use a language, e.g. Python.", "It helps."]),
    ("i.e. and etc.", "The rest, i.e. Tuesday, Friday etc. are free. Rest then.",
     ["The rest, i.e. Tuesday, Friday etc. are free.", "Rest then."]),
    ("decimal", "Pi is about 3.14 in value. Yes.", ["Pi is about 3.14 in value.", "Yes."]),
    ("initials", "J. K. Rowling wrote it. Fans agreed.", ["J. K. Rowling wrote it.", "Fans agreed."]),
    ("dotted acronym", "The U.S. Army left. Peace came.", ["The U.S. Army left.", "Peace came."]),
    ("question and exclamation", "Is it true? Yes! Good.", ["Is it true?", "Yes!", "Good."]),
    ("ellipsis", "Well... Maybe not.", ["Well...", "Maybe not."]),
    ("closing quote ends a sentence", 'He said, "Go now." Then he left.',
     ['He said, "Go now."', "Then he left."]),
    ("quote continues the sentence", '"Stop!" she cried. "Why?"', ['"Stop!" she cried.', '"Why?"']),
    ("curly quotes", "“Wait.” He stopped.", ['"Wait."', "He stopped."]),
    ("bullet list", "Goals:\n• Read daily.\n• Take notes\n- Review often",
     ["Goals:", "Read daily.", "Take notes", "Review often"]),
    ("numbered list", "1. Skim the chapter.\n2) Read it closely.", ["Skim the chapter.", "Read it closely."]),
    ("hyphenated line break", "Reading improves compre-\nhension over time. It works.",
     ["Reading improves comprehension over time.", "It works."]),
    ("line break inside a sentence", "The cat\nsat down. Then it slept.", ["The cat sat down.", "Then it slept."]),
    ("paragraph break without a full stop", "A heading\n\nThe body starts here.",
     ["A heading", "The body starts here."]),
    ("no final punctuation", "One sentence only", ["One sentence only"]),
    ("empty", "  \n ", []),
]


@pytest.mark.parametrize("name,raw,expected", SPLIT_CASES, ids=[c[0] for c in SPLIT_CASES])
def test_split_sentences(name, raw, expected):
    assert text.split_sentences(raw) == expected


NORMALIZE_CASES = [
    ("hyphenated line break", "compre-\nhension", "comprehension"),
    ("hyphen kept inside a line", "a well-known fact", "a well-known fact"),
    ("single line break", "one\ntwo", "one two"),
    ("windows line endings", "one\r\ntwo", "one two"),
    ("paragraphs kept", "A.\n\n\n  B.", "A.\n\nB."),
    ("spaces and tabs", "a  b\t c ", "a b c"),
    ("ligature", "ﬁrst", "first"),
    ("curly quotes and soft hyphen", "‘it’s’ “so­ft”", "'it's' \"soft\""),
    ("non-breaking space", "a b", "a b"),
]


@pytest.mark.parametrize("name,raw,expected", NORMALIZE_CASES, ids=[c[0] for c in NORMALIZE_CASES])
def test_normalize(name, raw, expected):
    assert text.normalize(raw) == expected


def test_normalize_twice_changes_nothing():
    messy = "Intro-\nduction’s  first\nline.\n\n• one\n• two\n\nEnd."
    once = text.normalize(messy)
    assert text.normalize(once) == once


def test_tokenize_lowercases_and_keeps_inner_apostrophes_and_hyphens():
    assert text.tokenize("Don't panic: 42 well-known FACTS!") == ["don't", "panic", "42", "well-known", "facts"]


def test_content_words_drop_stopwords():
    assert text.content_words("The cat is on the mat, and it was not here") == ["cat", "mat"]
    assert "the" in text.STOPWORDS and "cat" not in text.STOPWORDS


RANKED_PAIRS = [
    ("facts beat filler",
     "In 1869 Dmitri Mendeleev published the first periodic table of the chemical elements.",
     "It was very nice and they all liked it a lot."),
    ("a pronoun opening is penalised",
     "Mendeleev arranged the known elements by atomic weight in a table.",
     "He arranged the known elements by atomic weight in a table."),
    ("a number is a bonus",
     "The battle ended in 1815 after heavy losses on both sides.",
     "The battle ended later after heavy losses on both sides."),
    ("a proper noun is a bonus",
     "The young writer moved to Paris after the long war ended.",
     "The young writer moved to town after the long war ended."),
    ("too short scores lower",
     "Photosynthesis converts light energy into chemical energy inside plant cells.",
     "Plants grow."),
    ("too long scores lower",
     "Photosynthesis converts light energy into chemical energy inside plant cells.",
     "Photosynthesis converts light energy into chemical energy inside plant cells "
     + "and leaf tissue " * 25 + "today."),
]


@pytest.mark.parametrize("name,better,worse", RANKED_PAIRS, ids=[c[0] for c in RANKED_PAIRS])
def test_informativeness_ranks(name, better, worse):
    assert text.informativeness(better) > text.informativeness(worse)


@pytest.mark.parametrize("sentence", ["", "   ", "Yes.", "?!", *[pair[1] for pair in RANKED_PAIRS]])
def test_informativeness_stays_between_zero_and_one(sentence):
    assert 0.0 <= text.informativeness(sentence) <= 1.0


def test_informativeness_of_nothing_is_zero():
    assert text.informativeness("") == 0.0
    assert text.informativeness("?!") == 0.0
