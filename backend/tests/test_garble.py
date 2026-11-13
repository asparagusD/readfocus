"""backend.regions.garble: telling broken text extraction from real prose, math and code."""

import pytest

from backend.regions import policy
from backend.regions.garble import garble_score, is_garbled

CLEAN = [
    ("prose", ("The derivative measures how a function changes as its input changes. "
               "We first define it as the limit of a difference quotient.")),
    ("prose with ligatures already normalised", "The first definition is efficient and flawless."),
    ("prose with numbers and a dash", "In 1905 Einstein published four papers—each one changed physics."),
    ("inline math kept by the extractor", "If f(x) = x² + 3x − 1, then f′(x) = 2x + 3 for every real x."),
    ("an equation with operators between words", "Let A ⊆ B and x ∈ A; then x ∈ B."),
    ("code", "(define (square x) (* x x))\nfor i in range(10): print(i)"),
    ("initials and a list", "J. R. R. Tolkien wrote it. Options: a, b, c."),
    ("empty", ""),
]


@pytest.mark.parametrize("name,text", CLEAN, ids=[c[0] for c in CLEAN])
def test_clean_text_is_not_garbled(name, text):
    score = garble_score(text)
    assert not is_garbled(text), score
    assert score["reasons"] == []
    assert score["ratio"] == 0


def test_cid_artefacts():
    text = "The (cid:16)(cid:17) integral of (cid:3)x is shown below."
    score = garble_score(text)
    assert "cid" in score["reasons"]
    assert score["ratio"] > 0
    assert is_garbled(text)


def test_one_cid_artefact_is_enough():
    # Zero tolerance for the hard signals: one missing glyph map spoils the line.
    text = ("A long and otherwise perfectly readable paragraph about limits and continuity, the "
            "way a function approaches a value as its input approaches a point, with one (cid:9) "
            "artefact where a glyph had no Unicode mapping in the font.")
    assert garble_score(text)["ratio"] < policy.GARBLE_MAX_RATIO
    assert is_garbled(text)


def test_replacement_and_private_use_characters():
    assert garble_score("Velocity � distance over time")["reasons"] == ["replacement"]
    assert garble_score("The sum  of the terms")["reasons"] == ["private_use"]
    assert is_garbled("The sum \U000f0041 of the terms")


def test_typical_garbled_equation_extraction():
    # pypdf on a TeX display equation: letters spaced out, a big operator glued into a word.
    text = "Z b a f ( x ) d x = F ( b ) − F ( a )\nwhere F is an anti∫derivative of f."
    score = garble_score(text)
    assert set(score["reasons"]) == {"spaced_letters", "symbol_in_word"}
    assert score["ratio"] >= policy.GARBLE_MAX_RATIO
    assert is_garbled(text)


def test_spaced_letters_need_a_long_run():
    run = " ".join("abcdefghij"[: policy.GARBLE_SPACED_RUN])
    shorter = " ".join("abcdefghij"[: policy.GARBLE_SPACED_RUN - 1])
    assert "spaced_letters" in garble_score(f"Here: {run} end")["reasons"]
    assert "spaced_letters" not in garble_score(f"Here: {shorter} end")["reasons"]


def test_symbol_inside_a_word():
    assert garble_score("contin∑ous")["reasons"] == ["symbol_in_word"]
    assert garble_score("x ∑ y")["reasons"] == []  # between words, it is maths


def test_ligature_leftovers():
    # A font without a ToUnicode entry for fi, ff, ffi ... drops the ligature and leaves a gap.
    text = "The de nition of an e ect on the co e cient is in nite. The  rst  eld."
    score = garble_score(text)
    assert score["reasons"] == ["ligature"]
    assert is_garbled(text)


def test_ligature_characters_themselves_are_not_garbage():
    # U+FB01 and U+FB02 are the right letters in one glyph; agents normalise them (NFKC).
    assert garble_score("The ﬁrst ﬂoor")["reasons"] == []


def test_ligature_fragments_need_their_own_word():
    assert garble_score("The 2nd worst result was the first one.")["reasons"] == []


def test_control_characters():
    assert garble_score("Speed\x07 and \x1bvelocity")["reasons"] == ["control"]
    assert garble_score("Tabs\tand\nnewlines\r\nare fine")["reasons"] == []


def test_ratio_is_a_share_of_visible_characters():
    score = garble_score("ab��")
    assert score["ratio"] == pytest.approx(0.5)


def test_score_is_deterministic():
    text = "Z b a f ( x ) d x (cid:4) ﬁ"
    assert garble_score(text) == garble_score(text)
