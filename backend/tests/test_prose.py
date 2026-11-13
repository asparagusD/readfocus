"""Prose-only chunk text with anchored placeholders (C18.6a): backend/regions/prose.py, pure."""

import re

from backend.regions import prose
from backend.regions.garble import is_garbled


def region(kind, text, page=1, order=0, **meta):
    return {"kind": kind, "page": page, "text": text, "order_in_page": order, "meta": meta}


def epub_region(kind, text, spine, path, order=0, **meta):
    return {"kind": kind, "page": None, "spine_index": spine, "text": text, "order_in_page": order, "meta": meta,
            "anchor": {"kind": "epub", "spine_index": spine, "path": path, "cfi": f"epubcfi(/6/{2 * (spine + 1)}!{path})"}}


# --- placeholders ----------------------------------------------------------------------------

def test_math_placeholder_uses_the_equation_number_when_there_is_one():
    assert prose.placeholder(region("math", "E = mc2", equation_number="3.2"), "p. 45") == "[Equation 3.2, p. 45]"
    assert prose.placeholder(region("math", "E = mc2"), "p. 45") == "[Equation, p. 45]"


def test_code_figure_and_table_placeholders():
    assert prose.placeholder(region("code", "(define x 1)"), "p. 46") == "[Code listing, p. 46]"
    fig = region("figure", "Figure 3.4 The unit circle.", label="Figure 3.4", caption="Figure 3.4 The unit circle.")
    assert prose.placeholder(fig, "p. 47") == "[Figure 3.4: The unit circle., p. 47]"
    assert prose.placeholder(region("figure", "", caption=None, label=None), "p. 47") == "[Figure, p. 47]"
    alt = region("figure", "A white rabbit", caption="A white rabbit", label=None, alt="A white rabbit")
    assert prose.placeholder(alt, "sec. 3") == "[Figure: A white rabbit, sec. 3]"
    table = region("table", "a\tb", label="Table 2.1", caption="Table 2.1: Resistor colours")
    assert prose.placeholder(table, "p. 9") == "[Table 2.1: Resistor colours, p. 9]"


def test_a_long_caption_is_cut_and_brackets_inside_it_are_softened():
    fig = region("figure", "", caption="Figure 1 " + "word [x] " * 40, label="Figure 1")
    text = prose.placeholder(fig, "p. 1")
    assert len(text) <= prose.policy.PLACEHOLDER_CAPTION_MAX + len("[Figure 1: …, p. 1]")
    assert text.count("[") == 1 and text.count("]") == 1 and prose.PLACEHOLDER.fullmatch(text)


# --- applying spans --------------------------------------------------------------------------

def test_apply_replaces_each_span_once_and_keeps_the_rest_byte_for_byte():
    content = "The rule is\nx = y + 1\nfor every x.\n\nNext paragraph."
    start = 100  # the chunk starts at book skeleton position 100
    eq = region("math", "x=y+1", equation_number="1")
    line = prose.skeleton("The rule is")
    spans = [{"start": start + len(line), "end": start + len(line) + 5, "region": eq, "text": "[Equation 1, p. 1]"}]
    text, used = prose.apply(content, start, spans)
    assert text == "The rule is\n[Equation 1, p. 1]\nfor every x.\n\nNext paragraph."
    assert used == [spans[0]]


def test_apply_writes_one_placeholder_for_a_region_split_into_several_spans():
    eq = region("code", "ab")
    spans = [{"start": 1, "end": 2, "region": eq, "text": "[Code listing, p. 1]"},
             {"start": 3, "end": 4, "region": eq, "text": "[Code listing, p. 1]"}]
    text, used = prose.apply("x a y b z", 0, spans)
    assert text == "x [Code listing, p. 1] y z"
    assert len(used) == 1


# --- PDF -------------------------------------------------------------------------------------

PAGE_ONE = "Ohm's law relates the three.\nE = I R (2.1)\nHere E is the voltage.\n(define (square x)\n  (* x x))\nThe end."
PAGE_TWO = "Figure 2.3 A simple circuit.\nR1\nBattery\nThe circuit above has one loop."


def pdf_regions():
    return [
        region("block", "Ohm's law relates the three.", page=1, order=0),
        region("math", "E = IR (2.1)", page=1, order=1, equation_number="2.1"),
        region("block", "Here E is the voltage.", page=1, order=2, inline_math=[[5, 6]]),
        region("code", "(define (square x)\n  (* x x))", page=1, order=3),
        region("block", "The end.", page=1, order=4),
        region("figure", "Figure 2.3 A simple circuit.", page=2, order=0, label="Figure 2.3",
               caption="Figure 2.3 A simple circuit.", labels=["R1", "Battery"]),
        region("block", "The circuit above has one loop.", page=2, order=1),
    ]


def test_pdf_prose_replaces_math_code_and_figures_with_page_placeholders():
    from backend.services.book_ingestor import chunk_text

    pages = [PAGE_ONE, "", PAGE_TWO]  # an empty page in between, as pypdf gives for a blank page
    regions = [r if r["page"] == 1 else {**r, "page": 3} for r in pdf_regions()]
    chunks = chunk_text([p for p in pages if p], 600)
    built = prose.pdf_prose(chunks, pages, regions)
    assert len(built) == len(chunks) == 1
    text = built[0]["prose"]
    assert "[Equation 2.1, p. 1]" in text
    assert "[Code listing, p. 1]" in text and "define" not in text
    assert "[Figure 2.3: A simple circuit., p. 3]" in text and "Battery" not in text and "R1" not in text
    assert "Here [Equation, p. 1] is the voltage." in text  # inline math too
    assert "Ohm's law relates the three." in text and "The circuit above has one loop." in text
    anchors = built[0]["anchors"]
    assert anchors["kind"] == "pdf" and anchors["pages"] == [1, 3]
    assert [s["page"] for s in anchors["spans"]] == [1, 3]
    assert [p["kind"] for p in anchors["placeholders"]] == ["math", "math", "code", "figure"]
    assert all(p["page"] in (1, 3) for p in anchors["placeholders"])


def test_pdf_prose_leaves_a_chunk_without_regions_as_it_is():
    built = prose.pdf_prose(["Plain words only."], ["Plain words only."], [])
    assert built[0]["prose"] == "Plain words only."
    assert built[0]["anchors"]["placeholders"] == []


def test_a_short_line_between_two_lines_of_one_figure_goes_with_the_figure():
    page = "Text before the figure.\nFigure 1 Axes.\nx\nFigure 1 Axes, continued.\nText after."
    regions = [region("block", "Text before the figure."), region("block", "Text after the figure x.", order=2),
               region("figure", "Figure 1 Axes.\nx\nFigure 1 Axes, continued.", order=1, label="Figure 1",
                      caption="Figure 1 Axes.")]
    text = prose.pdf_prose([page], [page], regions)[0]["prose"]
    assert "\nx\n" not in text and text.count("[Figure 1") == 1


def test_pdf_chunk_ranges_split_pages_between_chunks():
    pages = ["aaa bbb", "ccc", "ddd eee"]
    chunks = ["aaa", "bbb\n\nccc\n\nddd", "eee"]
    built = prose.pdf_prose(chunks, pages, [])
    assert [b["anchors"]["pages"] for b in built] == [[1, 1], [1, 3], [3, 3]]
    assert built[1]["anchors"]["spans"] == [{"page": 1, "char_start": 3, "char_end": 6},
                                           {"page": 2, "char_start": 0, "char_end": 3},
                                           {"page": 3, "char_start": 0, "char_end": 3}]


# --- EPUB ------------------------------------------------------------------------------------

def epub_book():
    blocks = [[{"id": "0.0", "type": "paragraph", "text": "Alice was tired."},
               {"id": "0.1", "type": "paragraph", "text": "def f(x):\n    return x"},
               {"id": "0.2", "type": "paragraph", "text": "The rabbit ran past"},
               {"id": "0.3", "type": "paragraph", "text": "Then x2 grew."}]]
    paths = [[{"block_id": "0.0", "spine_index": 1, "path": "/4/2"},
              {"block_id": "0.1", "spine_index": 1, "path": "/4/4"},
              {"block_id": "0.2", "spine_index": 1, "path": "/4/6/2"},
              {"block_id": "0.3", "spine_index": 2, "path": "/4/2"}]]
    regions = [epub_region("prose", "Alice was tired.", 1, "/4/2", 0),
               epub_region("code", "def f(x):\n    return x", 1, "/4/4", 1),
               epub_region("figure", "The rabbit ran past", 1, "/4/6", 2, caption="The rabbit ran past",
                           label=None, alt=None),
               epub_region("prose", "Then x^2 grew.", 2, "/4/2", 0, inline_math=[[5, 8]], inline_code=[])]
    chunks = ["Alice was tired.\n\ndef f(x):\n\n    return x\n\nThe rabbit ran past\n\nThen x\n\n2\n\ngrew."]
    return chunks, blocks, paths, regions


def test_epub_prose_replaces_code_figures_and_inline_math_by_element_path():
    chunks, blocks, paths, regions = epub_book()
    built = prose.epub_prose(chunks, blocks, paths, regions)
    text = built[0]["prose"]
    assert text.startswith("Alice was tired.")
    assert "[Code listing, sec. 2]" in text and "return" not in text
    assert "[Figure: The rabbit ran past, sec. 2]" in text
    assert "Then [Equation, sec. 3] grew." in re.sub(r"\s+", " ", text)
    anchors = built[0]["anchors"]
    assert anchors["kind"] == "epub"
    assert anchors["start"] == {"spine_index": 1, "cfi": "epubcfi(/6/4!/4/2)", "location": 1_000_000}
    assert anchors["end"]["spine_index"] == 2 and anchors["end"]["cfi"] == "epubcfi(/6/6!/4/2)"
    assert [p["kind"] for p in anchors["placeholders"]] == ["code", "figure", "math"]
    assert anchors["placeholders"][0]["cfi"] == "epubcfi(/6/4!/4/4)"


def test_epub_prose_without_paths_keeps_the_content():
    built = prose.epub_prose(["Some text."], None, None, [])
    assert built[0]["prose"] == "Some text." and built[0]["anchors"] is None


# --- garble and placeholders in sentences --------------------------------------------------------

def test_placeholders_are_never_garbled_and_are_found_by_the_pattern():
    for text in ("[Equation 3.2, p. 45]", "[Code listing, p. 46]", "[Figure 3.4: A graph of f(x), p. 47]",
                 "[Table 1: Units, sec. 2]"):
        assert prose.PLACEHOLDER.search(text) and not is_garbled(text)
    assert not prose.PLACEHOLDER.search("See [1] and [Smith, 2001].")


def test_garbled_and_placeholder_sentences_are_counted():
    counts = prose.sentence_counts("A clean sentence here. Th ugly one. See [Equation, p. 2] now.")
    assert counts == {"garbled": 1, "placeholder": 1}


def test_epub_blocks_outside_the_spine_get_no_anchor():
    chunks, blocks, paths, regions = epub_book()
    chunks, blocks = chunks + ["Colophon text."], blocks + [[{"id": "1.0", "type": "paragraph", "text": "Colophon text."}]]
    paths = paths + [[{"block_id": "1.0", "spine_index": None, "path": "/4/2"}]]
    built = prose.epub_prose(chunks, blocks, paths, regions)
    assert built[1]["prose"] == "Colophon text."
    assert built[1]["anchors"]["start"] is None and built[1]["anchors"]["end"] is None
    assert built[0]["anchors"]["end"]["spine_index"] == 2
