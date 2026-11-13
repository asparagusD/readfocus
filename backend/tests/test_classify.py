"""backend.regions.classify: display math regions and inline math spans (C18.3)."""

import hashlib
import json
from pathlib import Path

import pytest

from backend.regions import classify, extract, policy
from scripts.dev.eval_math_regions import evaluate

ROOT = Path(__file__).resolve().parents[2]
LABELS = ROOT / "backend" / "tests" / "fixtures" / "math_labels.json"
SHELF = ROOT / "samples" / "technical"
PAGE = (0.0, 0.0, 600.0, 800.0)
BODY = "Body"
PROSE = "The quick reader turns the page and finds the next idea waiting there"  # 69 characters


def chars(text, x0, top, size=10.0, font=BODY, offset=0.0, step=None):
    """One character per letter, spaces as gaps, `offset` points above the baseline."""
    step = step or size * 0.5
    out = []
    for i, letter in enumerate(text):
        if letter != " ":
            out.append({"text": letter, "fontname": f"ABCDEF+{font}", "size": size, "x0": x0 + i * step,
                        "x1": x0 + i * step + step, "top": top - offset, "bottom": top - offset + size,
                        "upright": True})
    return out


def prose(top, text=PROSE, x0=72.0):
    return chars(text, x0, top)


def classify_chars(raw):
    return classify.classify_page(extract.build_page(raw, page_no=1, bbox=PAGE))


def kinds(regions):
    return [region.kind for region in regions]


# --- characters -------------------------------------------------------------------------------

@pytest.mark.parametrize("font, expected", [
    ("CMMI10", True), ("CMSY7", True), ("rtxmi", True), ("txex", True), ("MathDesign-CH-Regular-OT1-10", True),
    ("CambriaMath", True), ("STIXTwoMath-Regular", True), ("LinLibertineO", False), ("CharterBT-Italic", False),
    ("Times-Roman", False), ("CMR10", False), ("InconsolataLGC", False),
])
def test_math_fonts(font, expected):
    assert classify.is_math_font(font) is expected


@pytest.mark.parametrize("letter, expected", [
    ("=", True), ("∑", True), ("−", True), ("α", True), ("→", True), ("·", True), ("′", True),
    ("a", False), ("-", False), ("7", False), (",", False), ("°", False), ("(", False),
])
def test_math_symbols(letter, expected):
    assert classify.is_math_symbol(letter) is expected


# --- display math -----------------------------------------------------------------------------

def test_a_set_off_equation_between_paragraphs_is_display_math():
    raw = prose(100) + prose(112) + chars("f(x) = x + y", 250, 135, font="CMMI10") + prose(160) + prose(172)
    regions = classify_chars(raw)
    assert kinds(regions) == ["block", "math", "block"]
    math = regions[1]
    assert math.text == "f(x) = x + y" and math.meta["display"] is True
    assert math.bbox == [250, 135, 250 + 12 * 5, 145]
    assert "math_font" in math.meta["clues"]
    assert [len(r.lines) for r in regions] == [2, 1, 2]


def test_symbols_alone_make_a_display_line_without_a_math_font():
    regions = classify_chars(prose(100) + chars("a = b + c − d", 250, 135) + prose(160))
    assert kinds(regions) == ["block", "math", "block"]
    assert "symbols" in regions[1].meta["clues"]


def test_a_display_needs_an_operator_or_relation():
    # Figure labels in a math font ("v2", "Be1") are not equations.
    regions = classify_chars(prose(100) + chars("v", 250, 135) + chars("2", 255, 140, size=7) + prose(160))
    assert "math" not in kinds(regions)


def test_code_in_a_monospace_font_is_never_math():
    code = chars("(cond ((= x 0) 0) ((< x 0) (- x)))", 90, 135, font="InconsolataLGC")
    regions = classify_chars(prose(100) + code + prose(160))
    assert "math" not in kinds(regions)
    assert all(not r.meta.get("inline_math") for r in regions)


def test_consecutive_display_lines_side_by_side_make_one_region():
    left = chars("x + 2y = 6", 150, 135, font="CMMI10") + chars("3x − y = 2", 150, 147, font="CMMI10")
    right = chars("x + 2y = 6", 380, 135, font="CMMI10") + chars("− 7y = 2", 380, 147, font="CMMI10")
    regions = classify_chars(prose(100) + left + right + prose(175))
    assert kinds(regions) == ["block", "math", "block"]
    assert regions[1].bbox[0] == 150 and regions[1].bbox[2] == 380 + 10 * 5
    assert len(regions[1].lines) == 4


def test_a_fragment_next_to_a_display_joins_it():
    raw = prose(100) + chars("√", 262, 126, font="txsy") + chars("φ = 1 + 5", 250, 137, font="rtxmi") + prose(165)
    regions = classify_chars(raw)
    assert kinds(regions) == ["block", "math", "block"]
    assert regions[1].bbox[1] == 126 and len(regions[1].lines) == 2


def test_a_stacked_fraction_is_display_math():
    numerator = chars("RN", 134, 126)
    middle = chars("R", 91, 134) + chars("x", 96, 139, size=7) + chars("= R", 106, 134) + chars("a", 121, 139, size=7)
    denominator = chars("RM", 134, 142)
    regions = classify_chars(prose(100) + numerator + middle + denominator + prose(170))
    assert kinds(regions) == ["block", "math", "block"]
    assert len(regions[1].lines) == 3 and "stack" in regions[1].meta["clues"]


def test_an_equation_number_at_the_right_margin_belongs_to_its_display():
    raw = (prose(100) + chars("A = B C", 250, 135, font="CMMI10") + chars("(4.2.1)", 400, 135)
           + prose(160))
    regions = classify_chars(raw)
    math = regions[1]
    assert math.kind == "math" and math.meta["equation_number"] == "4.2.1"
    assert math.bbox[2] == 400 + 7 * 5
    assert kinds(regions) == ["block", "math", "block"]


def test_an_equation_reference_in_prose_is_not_a_number_of_anything():
    regions = classify_chars(prose(100) + prose(112, "Solve (1.1.1) using the elimination method today"))
    assert kinds(regions) == ["block"]
    assert regions[0].meta["inline_math"] == []


# --- inline math ------------------------------------------------------------------------------

def inline_texts(region):
    return [region.text[start:end] for start, end in region.meta["inline_math"]]


def test_inline_math_spans_are_char_ranges_of_the_prose_region():
    line = chars("so we solve 10z = 30 to get z = 3 now", 72, 100) + prose(112)
    region = classify_chars(line)[0]
    assert region.kind == "block"
    assert inline_texts(region) == ["10z = 30", "z = 3"]


def test_superscripts_and_math_fonts_start_an_inline_span():
    raw = (chars("that y", 72, 100) + chars("2", 102, 100, size=7, offset=3) + chars("= x, and more words follow", 110, 100)
           + prose(112))
    region = classify_chars(raw)[0]
    assert inline_texts(region) == ["y2 = x"]


def test_footnote_markers_and_units_are_not_math():
    raw = (chars("as shown in Chapter 4.", 72, 100) + chars("16", 182, 100, size=7, offset=4)
           + chars("the resistance is exactly 5 Ω here", 72, 112) + prose(124))
    region = classify_chars(raw)[0]
    assert region.meta["inline_math"] == []


def test_a_word_glued_to_math_is_trimmed():
    raw = chars("grows with", 72, 100) + chars("√", 122, 100, font="txsy") + chars("n today", 127, 100) + prose(112)
    region = classify_chars(raw)[0]
    assert inline_texts(region) == ["√n"]


def test_a_comma_outside_brackets_ends_a_span_but_not_inside_them():
    raw = chars("all except R", 72, 100) + chars("x", 132, 106, size=7) + chars(", R", 136, 100)         + chars("a", 151, 106, size=7) + chars(" and (x, y) = (1, 2) too", 155, 100) + prose(112)
    assert inline_texts(classify_chars(raw)[0]) == ["Rx", "Ra", "(x, y) = (1, 2)"]


def test_a_slightly_lowered_small_character_is_a_subscript():
    raw = chars("guesses y", 72, 100) + chars("1", 117, 103.5, size=7.3) + chars(" and more of them", 121, 100)         + prose(112)
    assert inline_texts(classify_chars(raw)[0]) == ["y1"]


def test_ordinal_endings_are_not_math():
    raw = chars("the k", 72, 100) + chars("th", 97, 96, size=7) + chars(" number in line", 104, 100) + prose(112)
    assert classify_chars(raw)[0].meta["inline_math"] == []


def test_a_line_that_is_mostly_monospace_has_no_inline_math():
    raw = chars("x = 1 | y = 2 | z = 3", 72, 100, font="NimbusMonL-Regu") + prose(112)
    assert classify_chars(raw)[0].meta["inline_math"] == []


def test_spans_in_a_later_line_count_from_the_region_start():
    raw = prose(100) + chars("and the sign x = y appears", 72, 112)
    region = classify_chars(raw)[0]
    assert inline_texts(region) == ["x = y"]
    assert region.meta["inline_math"][0][0] > len(PROSE)


def test_classification_is_deterministic():
    raw = prose(100) + chars("f(x) = x + y", 250, 135, font="CMMI10") + chars("so x = 2 here", 72, 160)
    assert classify_chars(raw) == classify_chars(raw)


# --- the hand-labelled shelf pages ------------------------------------------------------------

def labelled_pages():
    return json.loads(LABELS.read_text(encoding="utf-8"))


def test_the_label_fixture_covers_ten_pages_of_display_and_inline_math():
    data = labelled_pages()
    assert len(data["pages"]) == 10
    regions = [r for page in data["pages"] for r in page["regions"]]
    assert {r["kind"] for r in regions} == {"display", "inline"}
    assert any(r.get("equation_number") for r in regions)
    for region in regions:
        x0, top, x1, bottom = region["bbox"]
        assert x0 <= x1 and top <= bottom


def test_iou():
    assert classify.iou([0, 0, 10, 10], [0, 0, 10, 10]) == 1
    assert classify.iou([0, 0, 10, 10], [5, 0, 15, 10]) == pytest.approx(1 / 3)
    assert classify.iou([0, 0, 1, 1], [2, 2, 3, 3]) == 0


@pytest.mark.skipif(not SHELF.exists() or not any(SHELF.glob("*.pdf")),
                    reason="test shelf not fetched (scripts/fetch_test_shelf.py)")
def test_precision_and_recall_on_the_labelled_shelf_pages():
    data = labelled_pages()
    for page in data["pages"]:
        digest = hashlib.sha256((SHELF / page["book"]).read_bytes()).hexdigest()
        assert digest == page["sha256"], f"{page['book']} is not the labelled file"
    scores = evaluate(data["pages"], SHELF, policy.MATH_MATCH_IOU)
    # Measured at C18.3: display 0.86 / 1.00, inline 0.85 / 0.95 (precision / recall).
    assert scores["display"]["precision"] >= 0.8 and scores["display"]["recall"] >= 0.9, scores
    assert scores["inline"]["precision"] >= 0.8 and scores["inline"]["recall"] >= 0.9, scores
