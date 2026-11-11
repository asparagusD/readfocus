"""Structured blocks and table of contents (C12.1): PDF text heuristics, block shape, toc."""

import json
from pathlib import Path

import pytest

from backend.services import book_ingestor, book_structure
from backend.services.book_structure import TYPES, build, text_blocks


def skeleton(text):
    return "".join(ch for ch in text if not ch.isspace())


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
