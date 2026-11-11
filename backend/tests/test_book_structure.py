"""Structured blocks and table of contents (C12.1): EPUB tags, PDF text heuristics, chunk alignment."""

import io
import json
import zipfile
from pathlib import Path

import pytest

from backend.services import book_ingestor, book_structure
from backend.services.book_structure import TYPES, build, text_blocks


def make_book_epub(docs):
    """A minimal EPUB that ebooklib reads: one XHTML document per body string, in spine order."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                   '</rootfiles></container>')
        items = "".join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(docs)))
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(len(docs)))
        z.writestr("OEBPS/content.opf",
                   '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
                   '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier>'
                   '<dc:title>T</dc:title><dc:language>en</dc:language></metadata>'
                   f'<manifest>{items}</manifest><spine>{spine}</spine></package>')
        for i, body in enumerate(docs):
            z.writestr(f"OEBPS/c{i}.xhtml", '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">'
                                           f'<head><title>c</title></head><body>{body}</body></html>')
    return out.getvalue()


WALDEN = [
    ("<h1>Chapter I</h1><h2>Economy</h2>"
    "<p>When I wrote the <em>following pages</em>, or rather the <strong>bulk</strong> of them, I lived alone, "
    "in the woods, a mile from any neighbor, in a house which I had built myself.</p>"
    "<blockquote><p>Simplicity, simplicity, simplicity!</p></blockquote>"
    "<ul><li>Shelter</li><li>Fuel and <i>food</i></li></ul>"
    "<script>alert('no')</script><style>p { color: red }</style><img src='pond.png' alt='The pond'/>"),
    ("<h1>Chapter II</h1><p>Where I lived, and what I lived for. At a certain season of our life we are accustomed "
    "to consider every spot as the possible site of a house.</p>"),
]


def skeleton(text):
    return "".join(ch for ch in text if not ch.isspace())


def epub_book(docs, target_words=600):
    data = make_book_epub(docs)
    return data, book_ingestor.chunk_text(book_ingestor.extract_text_from_epub(data), target_words)


def all_blocks(blocks):
    return [block for chunk in blocks for block in chunk]


# --- EPUB ---------------------------------------------------------------

def test_epub_tags_become_typed_blocks_with_marks():
    data, chunks = epub_book(WALDEN)
    blocks, toc = build("epub", data, chunks)
    flat = all_blocks(blocks)
    assert [b["type"] for b in flat] == ["chapter", "heading", "paragraph", "quote", "list_item", "list_item",
                                         "chapter", "paragraph"]
    para = flat[2]
    assert para["text"].startswith("When I wrote the following pages, or rather the bulk of them,")
    assert [(para["text"][m["start"]:m["end"]], m["kind"]) for m in para["marks"]] == [
        ("following pages", "em"), ("bulk", "strong")]
    assert flat[5]["text"] == "Fuel and food" and flat[5]["marks"] == [{"start": 9, "end": 13, "kind": "em"}]
    text = " ".join(b["text"] for b in flat)
    assert "alert" not in text and "color" not in text and "The pond" not in text
    assert toc == [{"title": "Chapter I: Economy", "chunk_index": 0, "block_id": "0.0"},
                   {"title": "Chapter II", "chunk_index": 0, "block_id": "0.6"}]


def test_epub_blocks_split_at_chunk_boundaries_and_cover_each_chunk_exactly():
    data, chunks = epub_book(WALDEN, target_words=6)
    assert len(chunks) == 5  # content is split per text node, so chunk ends fall inside paragraphs and lists
    blocks, toc = build("epub", data, chunks)
    assert len(blocks) == len(chunks)
    for content, chunk_blocks in zip(chunks, blocks):
        assert chunk_blocks, "every chunk has at least one block"
        assert skeleton("".join(b["text"] for b in chunk_blocks)) == skeleton(content)
    continued = [b for b in all_blocks(blocks) if b.get("continued")]
    assert continued, "a paragraph cut by a chunk boundary continues in the next chunk"
    for block in all_blocks(blocks):  # marks stay on the right words after the split
        for mark in block["marks"]:
            assert 0 <= mark["start"] < mark["end"] <= len(block["text"])
            assert block["text"][mark["start"]:mark["end"]] in "following pages bulk food"
    assert [entry["title"] for entry in toc] == ["Chapter I: Economy", "Chapter II"]
    for entry in toc:
        ids = [b["id"] for b in blocks[entry["chunk_index"]]]
        assert entry["block_id"] in ids


def test_epub_chapter_level_is_the_top_level_that_repeats():
    data, chunks = epub_book(["<h1>The Book</h1><p>A title page with a few words on it.</p>",
                              "<h2>One</h2><p>First chapter text runs here.</p>",
                              "<h2>Two</h2><p>Second chapter text runs here.</p>"])
    blocks, toc = build("epub", data, chunks)
    assert [b["type"] for b in all_blocks(blocks)][:3] == ["heading", "paragraph", "chapter"]
    assert [entry["title"] for entry in toc] == ["One", "Two"]


def test_epub_that_does_not_match_its_chunks_falls_back_to_text_blocks():
    data, _ = epub_book(WALDEN)
    chunks = ["Some other text entirely.\n\nAnd a second paragraph."]
    blocks, toc = build("epub", data, chunks)
    assert [b["text"] for b in blocks[0]] == ["Some other text entirely.", "And a second paragraph."]
    assert toc == []


def test_unreadable_epub_falls_back_to_text_blocks():
    blocks, _ = build("epub", b"not a zip", ["One paragraph only."])
    assert blocks == [[{"id": "0.0", "type": "paragraph", "text": "One paragraph only.", "marks": []}]]


# --- PDF and plain text -------------------------------------------------

def texts(content):
    return [(b["type"], b["text"]) for b in text_blocks(content)]


def test_wrapped_lines_join_and_hyphenation_is_mended():
    content = "The quick brown fox jum-\nped over the lazy dog and ran\naway into the well-\nKnown forest."
    assert texts(content) == [("paragraph", ("The quick brown fox jumped over the lazy dog and ran away into the "
                                            "well-Known forest."))]


def test_page_numbers_drop_and_a_paragraph_continues_across_a_page_break():
    content = "He walked a long way down the road and into the\n\n12\n\nforest, where he slept until morning."
    assert texts(content) == [("paragraph", ("He walked a long way down the road and into the forest, where he "
                                            "slept until morning."))]


def test_blank_lines_and_short_last_lines_end_paragraphs():
    content = ("It was the best of times, it was the worst of times, it was\n"
               "the age of wisdom.\n"
               "There were a king with a large jaw and a queen with a plain\n"
               "face, on the throne of England.\n\nA second paragraph after a blank line.")
    assert [t for _, t in texts(content)] == [
        "It was the best of times, it was the worst of times, it was the age of wisdom.",
        "There were a king with a large jaw and a queen with a plain face, on the throne of England.",
        "A second paragraph after a blank line."]


@pytest.mark.parametrize("heading", ["CHAPTER 3", "Chapter 12", "Chapter XIV", "Part One", "IV", "IV.", "THE RETURN"])
def test_chapter_headings_are_detected(heading):
    blocks = texts(f"{heading}\nShe came back to the house on a grey morning and found it empty.")
    assert blocks[0] == ("chapter", heading)
    assert blocks[1][0] == "paragraph"


def test_chapter_number_takes_the_title_line_after_it():
    content = "CHAPTER 3\nThe Long Road\nIt was a dark night and the rain fell on the road for hours."
    assert texts(content) == [("chapter", "CHAPTER 3"), ("heading", "The Long Road"),
                              ("paragraph", "It was a dark night and the rain fell on the road for hours.")]
    _blocks, toc = build("pdf", b"", [content])
    assert toc == [{"title": "CHAPTER 3: The Long Road", "chunk_index": 0, "block_id": "0.0"}]


@pytest.mark.parametrize("content", [
    "The ship sailed at dawn and the crew was quiet.\nYes.\nThen the wind rose and the sails filled at once.",
    "The mission was run by the agency called\nNASA\nwhich launched it from Florida that spring.",
    "A long paragraph of ordinary prose ends here.\nTHE END",
    "Revenue rose by 4% in the year.\n2024\nCosts fell by about the same amount overall.",
])
def test_ordinary_lines_are_not_chapters(content):
    assert "chapter" not in [kind for kind, _ in texts(content)]


def test_a_paragraph_cut_by_a_chunk_boundary_continues():
    blocks, toc = build("pdf", b"", ["She walked down to the water and into the", "forest beyond it, and slept."])
    assert blocks[1][0]["continued"] is True
    assert "continued" not in blocks[0][0]
    assert toc == []


def test_blocks_have_the_stored_shape():
    blocks, toc = build("pdf", b"", ["CHAPTER 1\nA first line of text that runs on.", "More text follows here."])
    for chunk_index, chunk in enumerate(blocks):
        for n, block in enumerate(chunk):
            assert set(block) <= {"id", "type", "text", "marks", "continued"}
            assert block["id"] == f"{chunk_index}.{n}" and block["type"] in TYPES
    json.dumps({"blocks": blocks, "toc": toc})  # stored as jsonb


def test_sample_pdf_gives_blocks_for_every_chunk():
    data = (Path(__file__).resolve().parents[2] / "sample.pdf").read_bytes()
    chunks = book_ingestor.chunk_text(book_ingestor.extract_text_from_pdf(data), 600)
    blocks, toc = build("pdf", data, chunks)
    assert len(blocks) == len(chunks) and all(blocks)
    ids = {(i, b["id"]) for i, chunk in enumerate(blocks) for b in chunk}
    assert all((entry["chunk_index"], entry["block_id"]) in ids for entry in toc)
    for content, chunk_blocks in zip(chunks, blocks):  # nothing but page numbers and hyphens is lost
        kept = skeleton("".join(b["text"] for b in chunk_blocks))
        assert len(kept) >= 0.97 * len(skeleton(content))


def test_build_never_raises(monkeypatch):
    monkeypatch.setattr(book_structure, "text_blocks", lambda *a, **k: 1 / 0)
    assert build("pdf", b"", ["Text."]) == (None, None)
