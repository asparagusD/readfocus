"""backend.regions.code: code blocks with their indentation rebuilt exactly (C18.4)."""

import ast
from pathlib import Path

import pytest

from backend.regions import classify, code, extract
from scripts.dev.make_code_fixture import PYTHON, C

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "backend" / "tests" / "fixtures" / "code_sample.pdf"
SICP = ROOT / "samples" / "technical" / "sicp.pdf"
PAGE = (0.0, 0.0, 600.0, 800.0)
PROSE = "The quick reader turns the page and finds the next idea waiting there"
W = 5.4  # Courier at 9 pt


def chars(text, x0, top, size=9.0, font="Courier", step=W):
    return [{"text": ch, "fontname": f"ABCDEF+{font}", "size": size, "x0": x0 + i * step, "x1": x0 + (i + 1) * step,
             "top": top, "bottom": top + size, "upright": True} for i, ch in enumerate(text) if ch != " "]


def listing(text, x0=90.0, top=120.0, leading=11.0, font="Courier"):
    out = []
    for row, line in enumerate(text.split("\n")):
        out += chars(line, x0, top + row * leading, font=font)
    return out


def prose(top, text=PROSE, x0=72.0):
    """A proportional line: narrow and wide letters have different advances, as in a real text font."""
    out, x = [], x0
    for ch in text:
        width = 3.0 if ch in "iljtf.,I" else 8.5 if ch in "mwMW" else 5.5
        if ch != " ":
            out.append({"text": ch, "fontname": "ABCDEF+Times-Roman", "size": 11.0, "x0": x, "x1": x + width,
                        "top": top, "bottom": top + 11.0, "upright": True})
        x += width
    return out


def regions_of(raw):
    return classify.classify_page(extract.build_page(raw, page_no=1, bbox=PAGE))


def code_texts(regions):
    return [r.text for r in regions if r.kind == "code"]


# --- language guesses -------------------------------------------------------------------------

@pytest.mark.parametrize("text, language", [
    (PYTHON, "python"),
    ("import os\nclass Box:\n    def size(self):\n        return None", "python"),
    ("(define (square x) (* x x))\n(define (abs x)\n  (cond ((< x 0) (- x))\n        (else x)))", "scheme"),
    (C, "c"),
    ("public class Hello {\n    public static void main(String[] args) {\n        System.out.println(\"hi\");\n    }\n}",
     "java"),
    ("const add = (a, b) => a + b;\nfunction show(x) {\n  console.log(x);\n}", "javascript"),
    ("function y = f(x)\n  % square every entry\n  y = x.^2;\nend", "matlab"),
    ("sweep v#branch\n0.000e+00 0.000e+00\n5.000e+00 -1.000e+00", "unknown"),
])
def test_language_guess(text, language):
    assert code.guess_language(text) == language


# --- rebuilding -------------------------------------------------------------------------------

def test_indentation_blank_lines_and_inner_spaces_are_rebuilt_exactly():
    regions = regions_of(prose(80) + listing(PYTHON, top=110) + prose(240))
    assert [r.kind for r in regions] == ["block", "code", "block"]
    assert code_texts(regions) == [PYTHON]
    ast.parse(regions[1].text)
    assert regions[1].meta["language_guess"] == "python"
    assert regions[1].meta["char_width"] == pytest.approx(W)


def test_columns_come_from_the_block_left_edge_not_the_page():
    text = "(define (abs x)\n  (cond ((> x 0) x)\n        ((< x 0) (- x))))"
    assert code_texts(regions_of(listing(text, x0=211.3)))[0] == text


def test_a_line_number_gutter_on_the_same_line_is_stripped():
    numbered = "\n".join(f"{n}  {line}" if line else str(n) for n, line in enumerate(C.split("\n"), start=1))
    region = next(r for r in regions_of(prose(80) + listing(numbered, top=110) + prose(220)) if r.kind == "code")
    assert region.text == C
    assert region.meta["line_numbers"] == [1, 8]


def test_digits_that_start_code_are_not_a_gutter():
    text = "(fixed-point cos\n             1.0)\n1.2587315962971173"
    region = next(r for r in regions_of(listing(text)) if r.kind == "code")
    assert region.text == text and "line_numbers" not in region.meta


def test_numbers_that_do_not_count_up_are_not_a_gutter():
    text = "10 PRINT X\n30 GOTO 10\n20 END"
    assert code_texts(regions_of(listing(text))) == [text]


def test_prose_with_a_few_monospace_words_stays_prose():
    line = prose(100, "We call") + chars("(fib 5)", 120, 100) + prose(100, "to see it", x0=170)
    regions = regions_of(line + prose(114))
    assert "code" not in [r.kind for r in regions]


def test_a_template_line_with_placeholders_stays_in_its_code_block():
    template = (chars("(define (iter a result)", 90, 110) + chars("(if", 100, 121) + chars("⟨??⟩", 120, 121, font="txsy")
                + chars("(iter", 120, 132) + chars("⟨??⟩", 150, 132, font="txsy") + chars("))", 175, 132))
    regions = regions_of(prose(80) + template + prose(160))
    assert [r.kind for r in regions] == ["block", "code", "block"]
    assert regions[1].text.split("\n")[1].startswith("  (if")


def test_symbols_alone_in_a_monospace_font_are_not_code():
    regions = regions_of(prose(80) + chars("∞", 200, 110, font="DejaVuSansMono") + prose(130))
    assert "code" not in [r.kind for r in regions]


def test_equal_advances_mark_code_when_the_font_name_says_nothing():
    text = "while (x > 0) {\n    x = x - 1;\n}"
    regions = regions_of(prose(80) + listing(text, top=110, font="F12") + prose(160))
    assert code_texts(regions) == [text]


def test_code_lines_are_not_math():
    text = "x = a + b * c\ny = x <= 2"
    regions = regions_of(prose(80) + listing(text, x0=200, top=110) + prose(150))
    assert [r.kind for r in regions] == ["block", "code", "block"]


def test_rebuilding_is_deterministic():
    raw = prose(80) + listing(PYTHON, top=110) + prose(240)
    assert regions_of(raw) == regions_of(raw)


# --- a real PDF -------------------------------------------------------------------------------

def test_the_fixture_pdf_rebuilds_both_listings_character_for_character():
    regions = classify.classify_page(extract.page_chars(FIXTURE, 1))
    assert [r.kind for r in regions] == ["block", "code", "block", "code", "block"]
    python, c = [r for r in regions if r.kind == "code"]
    assert python.text == PYTHON and c.text == C
    ast.parse(python.text)
    assert python.meta["language_guess"] == "python" and c.meta["language_guess"] == "c"
    assert c.meta["line_numbers"] == [1, 8] and "line_numbers" not in python.meta


@pytest.mark.skipif(not SICP.exists(), reason="test shelf not fetched (scripts/fetch_test_shelf.py)")
@pytest.mark.parametrize("page_no, expected", [
    (50, ["(define (abs x)\n  (cond ((> x 0) x)\n        ((= x 0) 0)\n        ((< x 0) (- x))))"]),
    (76, [("(define (fib n)\n  (cond ((= n 0) 0)\n        ((= n 1) 1)\n        (else (+ (fib (- n 1))\n"
           "                 (fib (- n 2))))))")]),
    (121, ["(fixed-point (lambda (y) (+ (sin y) (cos y)))\n             1.0)\n1.2587315962971173",
           "(define (sqrt x)\n  (fixed-point (lambda (y) (/ x y))\n               1.0))",
           "(define (sqrt x)\n  (fixed-point (lambda (y) (average y (/ x y)))\n               1.0))"]),
])
def test_sicp_listings_keep_their_indentation_and_balance(page_no, expected):
    regions = classify.classify_page(extract.page_chars(SICP, page_no))
    found = [r for r in regions if r.kind == "code"]
    assert [r.text for r in found] == expected
    for region in found:
        assert region.text.count("(") == region.text.count(")")
        assert region.meta["language_guess"] == "scheme"
