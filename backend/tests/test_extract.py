"""backend.regions.extract: characters with fonts and positions, grouped into lines and blocks."""

from pathlib import Path

import pytest

from backend.regions import extract, policy

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = ROOT / "frontend" / "e2e" / "fixtures" / "books" / "sample.pdf"
SHELF = ROOT / "samples" / "technical"


def char(text, x0, top, size=10.0, font="ABCDEF+Body", upright=True, width=None):
    width = width if width is not None else size * 0.5
    return {"text": text, "fontname": font, "size": size, "x0": x0, "x1": x0 + width,
            "top": top, "bottom": top + size, "upright": upright}


def word(text, x0, top, size=10.0, **kw):
    return [char(c, x0 + i * size * 0.5, top, size, **kw) for i, c in enumerate(text)]


def page(chars, width=600.0, height=800.0, bbox=(0.0, 0.0, 600.0, 800.0)):
    return extract.build_page(chars, page_no=1, bbox=bbox)


def test_font_family_drops_the_subset_prefix():
    assert extract.font_family("HWQHFW+LinLibertineO") == "LinLibertineO"
    assert extract.font_family("NotoSans-Regular") == "NotoSans-Regular"


def test_chars_on_one_baseline_make_one_line_with_word_gaps():
    chars = word("Limits", 100, 100) + word("exist", 140, 100)
    result = page(chars)
    assert [line.text for line in result.lines] == ["Limits exist"]
    line = result.lines[0]
    assert (line.x0, line.top, line.x1, line.bottom) == (100, 100, 140 + 5 * 5, 110)
    assert line.chars[0].font == "Body" and line.chars[0].fontname == "ABCDEF+Body"


def test_each_character_knows_its_offset_in_the_line_text():
    line = page(word("ab", 100, 100) + word("cd", 120, 100)).lines[0]
    assert line.text == "ab cd"
    assert [(c.text, c.offset) for c in line.chars] == [("a", 0), ("b", 1), ("c", 3), ("d", 4)]
    assert all(line.text[c.offset:c.offset + len(c.text)] == c.text for c in line.chars)


def test_space_characters_from_the_pdf_are_not_doubled():
    chars = word("a", 100, 100) + [char(" ", 105, 100)] + word("b", 115, 100)
    assert [line.text for line in page(chars).lines] == ["a b"]


def test_letters_closer_than_a_word_gap_join():
    gap = policy.REGION_WORD_GAP_EM * 10
    chars = [char("a", 100, 100, width=5), char("b", 105 + gap * 0.5, 100), char("c", 115 + gap * 2, 100)]
    assert page(chars).lines[0].text == "ab c"


def test_lines_are_in_top_to_bottom_order():
    chars = word("second", 100, 130) + word("first", 100, 100)
    assert [line.text for line in page(chars).lines] == ["first", "second"]


def test_a_superscript_joins_its_line_raised_off_the_baseline():
    chars = word("x", 100, 100) + [char("2", 105, 96, size=7)] + word("y", 115, 100)
    lines = page(chars).lines
    assert [line.text for line in lines] == ["x2 y"]
    two = lines[0].chars[1]
    assert lines[0].baseline == 110
    assert two.baseline_offset == pytest.approx(110 - 103)  # raised 7 points
    assert lines[0].chars[0].baseline_offset == 0


def test_a_subscript_is_lowered():
    chars = word("sum", 100, 100) + [char("i", 115, 106, size=7)]
    line = page(chars).lines[0]
    assert line.text == "sumi"
    assert line.chars[3].baseline_offset == pytest.approx(110 - 113)


def test_a_wide_gutter_splits_two_columns():
    gutter = policy.REGION_COLUMN_GAP_EM * 10 + 1
    left = word("left", 100, 100)
    right = word("right", left[-1]["x1"] + gutter, 100)
    result = page(left + right)
    assert [line.text for line in result.lines] == ["left", "right"]
    assert len(result.blocks) == 2


def test_paragraph_gaps_split_blocks():
    lines = word("one", 100, 100) + word("two", 100, 112) + word("three", 100, 112 + 12 + 30)
    result = page(lines)
    assert [[line.text for line in block.lines] for block in result.blocks] == [["one", "two"], ["three"]]
    first = result.blocks[0]
    assert (first.x0, first.top, first.bottom) == (100, 100, 122)


def test_rotated_characters_stay_out_of_horizontal_lines():
    chars = word("text", 100, 100) + [char("Y", 300, 100, upright=False)]
    result = page(chars)
    assert [line.text for line in result.lines if line.upright] == ["text"]
    assert [line.text for line in result.lines if not line.upright] == ["Y"]


def test_coordinates_are_relative_to_the_crop_box():
    chars = word("a", 110, 120)
    line = page(chars, bbox=(10.0, 20.0, 610.0, 820.0)).lines[0]
    assert (line.x0, line.top) == (100, 100)


def test_an_empty_page_has_no_lines():
    result = page([])
    assert result.lines == [] and result.blocks == []
    assert (result.width, result.height) == (600, 800)


def test_build_page_is_deterministic():
    chars = word("x", 100, 100) + [char("2", 105, 96, size=7)] + word("next", 100, 130)
    assert page(chars) == page(chars)


def test_page_chars_reads_a_real_pdf():
    result = extract.page_chars(SAMPLE, 1)
    assert result.page == 1 and (result.width, result.height) == (612, 792)
    assert result.lines and result.blocks
    assert result.lines[0].text == "Preface"
    for line in result.lines:
        assert 0 <= line.x0 <= line.x1 <= result.width and 0 <= line.top <= line.bottom <= result.height


def test_page_chars_accepts_bytes_and_counts_pages():
    data = SAMPLE.read_bytes()
    assert extract.page_chars(data, 1) == extract.page_chars(SAMPLE, 1)
    with pytest.raises(ValueError):
        extract.page_chars(data, 0)


def test_iter_pages_reads_a_range_once_opened():
    pages = list(extract.iter_pages(SAMPLE.read_bytes(), 1, 2))
    assert [p.page for p in pages] == [1, 2]
    assert pages[0] == extract.page_chars(SAMPLE, 1)
    assert extract.page_count(SAMPLE.read_bytes()) >= 2


@pytest.mark.skipif(not (SHELF / "sicp.pdf").exists(), reason="test shelf not fetched (scripts/fetch_test_shelf.py)")
def test_word_gaps_come_from_positions_when_the_pdf_has_no_spaces():
    text = " ".join(line.text for line in extract.page_chars(SHELF / "sicp.pdf", 50).lines)
    assert "because normal-order" in text
    fonts = {c.font for line in extract.page_chars(SHELF / "sicp.pdf", 50).lines for c in line.chars}
    assert {"LinLibertineO", "InconsolataLGC", "txex"} <= fonts
