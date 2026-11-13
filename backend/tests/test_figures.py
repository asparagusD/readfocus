"""backend.regions.figures: figures, tables, drawn math, captions and reading order (C18.5a)."""

from pathlib import Path

import pytest

from backend.regions import classify, extract

ROOT = Path(__file__).resolve().parents[2]
SHELF = ROOT / "samples" / "technical"
PAGE = (0.0, 0.0, 612.0, 792.0)
PROSE = "The quick reader turns the page and finds the next idea waiting there"


def chars(text, x0, top, size=10.0, font="Body"):
    out, x = [], x0
    for ch in text:
        width = 2.8 if ch in "iljtf.,I" else 8.0 if ch in "mwMW" else 5.0
        if ch != " ":
            out.append({"text": ch, "fontname": f"ABCDEF+{font}", "size": size, "x0": x, "x1": x + width,
                        "top": top, "bottom": top + size, "upright": True})
        x += width
    return out


def prose(top, text=PROSE, x0=72.0):
    return chars(text, x0, top)


def shape(kind, x0, top, x1, bottom):
    return {"object_type": kind, "x0": x0, "top": top, "x1": x1, "bottom": bottom}


def plot(x0, top, x1, bottom):
    """A vector figure: two axes and a few long curves."""
    return [shape("line", x0, bottom, x1, bottom), shape("line", x0, top, x0, bottom),
            shape("curve", x0, top + 10, x1, bottom - 5), shape("curve", x0 + 5, top + 30, x1 - 5, bottom - 20)]


def glyphs(x0, top, count, size=10.0):
    """Math drawn as curves: one glyph-sized curve per character."""
    return [shape("curve", x0 + i * 6, top, x0 + i * 6 + 5, top + size) for i in range(count)]


def page_of(raw_chars, graphics=(), tables=()):
    return extract.build_page(raw_chars, page_no=1, bbox=PAGE, graphics=list(graphics), tables=list(tables))


def kinds(regions):
    return [r.kind for r in regions]


def test_a_vector_plot_with_a_caption_is_a_figure_with_its_labels():
    raw = (prose(100) + chars("y", 150, 160) + chars("x", 300, 300)
           + chars("Figure 3.4 The graph of a parabola.", 72, 330) + prose(360))
    regions = classify.classify_page(page_of(raw, plot(140, 150, 400, 310)))
    assert kinds(regions) == ["block", "figure", "block"]
    fig = regions[1]
    assert fig.meta["caption"] == "Figure 3.4 The graph of a parabola." and fig.meta["label"] == "Figure 3.4"
    assert fig.bbox[1] == 150 and fig.bbox[3] == 340
    assert fig.meta["labels"] == ["y", "x"]


def test_an_image_is_a_figure_and_a_small_icon_is_not():
    raw = prose(100) + prose(260)
    regions = classify.classify_page(page_of(raw, [shape("image", 150, 130, 450, 250), shape("image", 60, 100, 68, 108)]))
    assert kinds(regions) == ["block", "figure", "block"]
    assert regions[1].meta["images"] == 1


def test_a_caption_above_the_figure_also_belongs_to_it():
    raw = prose(100) + chars("Fig. 2 A sketch", 72, 130) + prose(320)
    regions = classify.classify_page(page_of(raw, plot(140, 150, 400, 300)))
    assert kinds(regions) == ["block", "figure", "block"]
    assert regions[1].meta["label"] == "Fig. 2"


def test_a_lone_rule_is_not_a_figure():
    regions = classify.classify_page(page_of(prose(100) + prose(140), [shape("line", 72, 125, 540, 125)]))
    assert "figure" not in kinds(regions)


def test_glyph_sized_curves_set_apart_are_drawn_display_math():
    regions = classify.classify_page(page_of(prose(100) + prose(170), glyphs(200, 135, 12)))
    assert kinds(regions) == ["block", "math", "block"]
    math = regions[1]
    assert math.meta["drawn"] is True and math.meta["display"] is True and math.text == ""


def test_glyph_sized_curves_inside_a_line_are_inline_drawn_math_on_its_block():
    raw = prose(100, "Use the limit laws to evaluate") + prose(114)
    regions = classify.classify_page(page_of(raw, glyphs(250, 100, 6)))
    assert kinds(regions) == ["block"]
    assert regions[0].meta["inline_drawn"] == [[250, 100, 250 + 5 * 6 + 5, 110]]


def test_a_table_with_text_cells_and_its_caption():
    cells = [["x", "f(x)"], ["0.1", "a."], ["0.01", "b."]]
    raw = (prose(100) + chars("Table 1.2 Values near zero", 72, 130) + chars("x", 160, 152) + chars("f(x)", 260, 152)
           + chars("0.1", 160, 172) + chars("a.", 260, 172) + chars("0.01", 160, 192) + chars("b.", 260, 192)
           + prose(240))
    table = {"bbox": [150, 145, 350, 210], "rows": cells}
    regions = classify.classify_page(page_of(raw, [shape("rect", 150, 145, 350, 210)], [table]))
    assert kinds(regions) == ["block", "table", "block"]
    assert regions[1].meta["rows"] == cells and regions[1].meta["caption"] == "Table 1.2 Values near zero"
    assert regions[1].text == "x\tf(x)\n0.1\ta.\n0.01\tb."


def test_a_one_cell_box_is_not_a_table():
    table = {"bbox": [72, 95, 540, 130], "rows": [["Theorem 2.6 Limits of polynomial functions"]]}
    regions = classify.classify_page(page_of(prose(100) + prose(114), [], [table]))
    assert "table" not in kinds(regions)


def test_graphics_inside_a_table_do_not_make_a_figure():
    cells = [["a", "b"], ["c", "d"]]
    raw = chars("a", 160, 152) + chars("b", 260, 152) + chars("c", 160, 172) + chars("d", 260, 172) + prose(240)
    corners = [shape("curve", 150 + i * 40, 145, 160 + i * 40, 150) for i in range(5)]
    regions = classify.classify_page(page_of(raw, corners + plot(150, 145, 350, 190), [{"bbox": [150, 145, 350, 190],
                                                                                        "rows": cells}]))
    assert kinds(regions) == ["table", "block"]


def test_two_columns_are_read_left_column_first():
    left = "the left column of this page"
    right = "the right column of this page"
    raw = (chars("A heading across the whole page width for both columns", 72, 80)
           + chars(left, 72, 110) + chars(left, 72, 124) + chars(left, 72, 400)
           + chars(right, 330, 110) + chars(right, 330, 124))
    order = [(r.bbox[0], r.bbox[1]) for r in classify.classify_page(page_of(raw))]
    assert order == [(72, 80), (72, 110), (72, 400), (330, 110)]


def test_reading_order_keeps_one_column_pages_top_to_bottom():
    regions = classify.classify_page(page_of(prose(100) + prose(160) + prose(220)))
    tops = [r.bbox[1] for r in regions]
    assert tops == sorted(tops)


def test_build_page_moves_graphics_and_tables_to_crop_box_coordinates():
    page = extract.build_page([], 1, (10.0, 20.0, 622.0, 812.0), graphics=[shape("image", 110, 120, 210, 220)],
                              tables=[{"bbox": [110, 120, 210, 220], "rows": [["a"]]}])
    assert page.graphics[0].bbox == [100, 100, 200, 200] and page.graphics[0].kind == "image"
    assert page.tables[0]["bbox"] == [100, 100, 200, 200]


# --- shelf pages ------------------------------------------------------------------------------

def shelf_regions(book, page_no):
    return classify.classify_page(extract.page_chars(SHELF / book, page_no))


@pytest.mark.skipif(not (SHELF / "calculus-volume-1.pdf").exists(), reason="test shelf not fetched")
def test_calculus_tables_figures_and_drawn_math():
    tables = [r for r in shelf_regions("calculus-volume-1.pdf", 141) if r.kind == "table"]
    assert len(tables) == 6 and all(len(t.meta["rows"]) >= 5 for t in tables)
    figures_120 = [r for r in shelf_regions("calculus-volume-1.pdf", 120) if r.kind == "figure"]
    assert any(f.meta.get("label") == "Figure 2.11" for f in figures_120)
    page_150 = shelf_regions("calculus-volume-1.pdf", 150)
    assert "figure" not in kinds(page_150)
    assert sum(1 for r in page_150 if r.kind == "math" and r.meta.get("drawn")) >= 3
    assert any(r.meta.get("inline_drawn") for r in page_150 if r.kind == "block")


@pytest.mark.skipif(not (SHELF / "lessons-in-electric-circuits-dc.pdf").exists(), reason="test shelf not fetched")
def test_a_schematic_takes_its_labels_out_of_the_prose():
    regions = shelf_regions("lessons-in-electric-circuits-dc.pdf", 304)
    schematic = next(r for r in regions if r.kind == "figure")
    assert {"Ra", "RM", "Rm", "Rn", "RN", "Rx", "null"} <= set(schematic.meta["labels"])
    prose_text = " ".join(r.text for r in regions if r.kind == "block")
    assert "Kelvin Double bridge" in prose_text and "null\n" not in prose_text


def test_a_single_filled_bar_is_not_a_figure():
    regions = classify.classify_page(page_of(prose(100) + prose(140), [shape("rect", 0, 0, 40, 792)]))
    assert "figure" not in kinds(regions)
