"""backend.regions.epub: regions from EPUB structure, with CFI anchors (C18.5b)."""

import re
from pathlib import Path

import pytest

from backend.regions import epub
from scripts.dev.make_epub_fixture import PYTHON, SCHEME

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "backend" / "tests" / "fixtures" / "regions_sample.epub"
E2E_BOOKS = ROOT / "frontend" / "e2e" / "fixtures" / "books"
ALICE = ROOT / "samples" / "technical" / "alices-adventures-in-wonderland.epub"


@pytest.fixture(scope="module")
def regions():
    return epub.epub_regions(FIXTURE.read_bytes())


def of(regions, spine, kind=None):
    return [r for r in regions if r["spine_index"] == spine and (kind is None or r["kind"] == kind)]


def test_the_first_chapter_has_every_kind_in_document_order(regions):
    assert [r["kind"] for r in of(regions, 0)] == ["prose", "prose", "math", "code", "code", "figure", "table", "prose"]
    assert [r["order"] for r in of(regions, 0)] == list(range(8))


def test_prose_marks_inline_math_and_inline_code(regions):
    paragraph = of(regions, 0, "prose")[1]
    text = paragraph["text"]
    assert text.startswith("The function double returns twice its input")
    assert [text[s:e] for s, e in paragraph["meta"]["inline_math"]] == ["f(x)=2x"]
    assert [text[s:e] for s, e in paragraph["meta"]["inline_code"]] == ["double"]
    assert "  " not in text and "\n" not in text


def test_display_math_keeps_its_mathml_and_latex(regions):
    math = of(regions, 0, "math")[0]
    assert math["text"] == "x^2 + 1" and math["meta"]["latex"] == "x^2 + 1"
    assert math["meta"]["mathml"].startswith("<math") and "<msup>" in math["meta"]["mathml"]
    assert math["meta"]["display"] is True


def test_code_blocks_keep_their_exact_text_and_language(regions):
    python, scheme = of(regions, 0, "code")
    assert python["text"] == PYTHON and python["meta"] == {"language_guess": "python", "language_source": "class"}
    assert scheme["text"] == SCHEME and scheme["meta"] == {"language_guess": "scheme", "language_source": "guess"}


def test_a_figure_takes_its_figcaption_alt_and_image_path(regions):
    figure = of(regions, 0, "figure")[0]
    assert figure["text"] == "Figure 1.1 A plot of double."
    assert figure["meta"] == {"caption": "Figure 1.1 A plot of double.", "label": "Figure 1.1",
                              "alt": "A rising line", "images": ["images/plot.png"]}


def test_a_table_takes_its_caption_and_cells(regions):
    table = of(regions, 0, "table")[0]
    assert table["meta"]["caption"] == "Table 1.1 Values of double" and table["meta"]["label"] == "Table 1.1"
    assert table["meta"]["rows"] == [["x", "double(x)"], ["1", "2"], ["3", "6"]]
    assert table["text"] == "x\tdouble(x)\n1\t2\n3\t6"


def test_bare_images_take_alt_text_or_a_nearby_figure_caption(regions):
    figures = of(regions, 1, "figure")
    assert [f["meta"]["images"] for f in figures] == [["images/photo.png"], ["images/night.png"], ["images/diagram.svg"]]
    assert figures[0]["meta"]["caption"] == "A lamp on a desk"
    assert figures[1]["meta"]["caption"] == "Figure 2.2 The same lamp at night."
    assert figures[2]["meta"]["caption"] is None
    prose = [r["text"] for r in of(regions, 1, "prose")]
    assert "Figure 2.2 The same lamp at night." not in prose  # taken by its figure, not repeated


def test_every_image_in_the_package_has_a_figure_region(regions):
    used = {path for r in regions if r["kind"] == "figure" for path in r["meta"]["images"]}
    assert set(epub.package_images(FIXTURE.read_bytes())) == used == {
        "images/plot.png", "images/photo.png", "images/night.png", "images/diagram.svg"}


def test_anchors_are_cfis_into_the_spine(regions):
    heading = regions[0]
    assert heading["text"] == "Chapter 1 Doubling"
    assert heading["anchor"] == {"kind": "epub", "spine_index": 0, "path": "/4/2/2", "cfi": "epubcfi(/6/2!/4/2/2)"}
    for region in regions:
        assert re.fullmatch(r"epubcfi\(/6/\d+!(/\d+)+\)", region["anchor"]["cfi"])
        assert region["anchor"]["spine_index"] == region["spine_index"]


def test_srcset_and_picture_sources_are_images_of_the_figure():
    markup = ('<html><head/><body><figure><picture><source srcset="img/a-2x.png 2x"/>'
              '<img src="img/a.png" srcset="img/a.png 1x, img/a-2x.png 2x" alt="A"/></picture></figure></body></html>')
    [figure] = epub.document_regions(markup, 0, "OEBPS")
    assert figure["meta"]["images"] == ["OEBPS/img/a-2x.png", "OEBPS/img/a.png"]


def test_regions_are_deterministic():
    assert epub.epub_regions(FIXTURE.read_bytes()) == epub.epub_regions(FIXTURE.read_bytes())


def test_a_file_that_is_not_an_epub_raises():
    with pytest.raises(Exception):  # noqa: B017 - the regions job records whatever it is
        epub.epub_regions(b"not an epub")


@pytest.mark.parametrize("name", ["reflow.epub", "fixed.epub", "hostile.epub"])
def test_every_image_used_by_a_spine_document_has_a_figure_region(name):
    data = (E2E_BOOKS / name).read_bytes()
    found = epub.epub_regions(data)
    used = {path for r in found if r["kind"] == "figure" for path in r["meta"]["images"]}
    assert set(epub.spine_images(data)) <= used
    assert all(r["anchor"]["cfi"].startswith("epubcfi(/6/") for r in found)


@pytest.mark.skipif(not ALICE.exists(), reason="test shelf not fetched (scripts/fetch_test_shelf.py)")
def test_alice_has_a_figure_for_every_illustration():
    data = ALICE.read_bytes()
    found = epub.epub_regions(data)
    used = {path for r in found if r["kind"] == "figure" for path in r["meta"]["images"]}
    assert set(epub.spine_images(data)) <= used
    # Every manifest image but the cover (named only in the package metadata) is in a figure, 2x renditions too.
    assert set(epub.package_images(data)) - used == {"images/cover.jpg"}
    assert sum(1 for r in found if r["kind"] == "figure") == 45
