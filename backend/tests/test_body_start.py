"""Where a book's body (chapter 1) begins, for focus mode (C23.1, FOCUS_RULES F2): the outline first, then a
heading in the region map, then the first page after the contents with enough prose."""

import pytest

from backend.services import body_start

PROSE = " ".join(["word"] * 320)


def region(unit, text, order=0, kind="block", pdf=True):
    return {"page": unit if pdf else None, "spine_index": None if pdf else unit, "kind": kind, "text": text,
            "order_in_page": order}


# --- (1) the outline -----------------------------------------------------------------------------------------------

def test_epub_nav_skips_front_matter_and_finds_chapter_one():
    toc = [{"title": "Cover", "spine_index": 0}, {"title": "Title Page", "spine_index": 1},
           {"title": "Copyright", "spine_index": 2}, {"title": "Contents", "spine_index": 3},
           {"title": "Dedication", "spine_index": 4}, {"title": "Preface", "spine_index": 5},
           {"title": "Chapter 1: Loomings", "spine_index": 6}, {"title": "Chapter 2: The Carpet-Bag", "spine_index": 7}]
    found = body_start.detect("epub", toc, [])
    assert found == {"source": "outline", "body_start": {
        "kind": "epub", "spine_index": 6, "title": "Chapter 1: Loomings",
        "anchor": {"kind": "epub", "cfi": "epubcfi(/6/14!/4)", "text": ""}}}


def test_pdf_outline_numbered_one_and_its_page():
    toc = [{"title": "Foreword", "page": 7}, {"title": "Acknowledgments", "page": 9},
           {"title": "1 Introduction", "page": 13}, {"title": "1.1 Background", "page": 14}, {"title": "2 Signals", "page": 30}]
    found = body_start.detect("pdf", toc, [])
    assert found["source"] == "outline"
    assert found["body_start"] == {"kind": "pdf", "page": 13, "title": "1 Introduction",
                                   "anchor": {"kind": "pdf", "page": 13, "quads": [[0, 0, 0, 0]], "text": ""}}


@pytest.mark.parametrize("title", ["CHAPTER ONE", "Chapter I. The Beginning", "Ch. 1 — Start", "1. Loomings", "1: Waves", "1"])
def test_chapter_one_spellings(title):
    assert body_start.chapter_one(["Prologue", title, "Chapter 2"]) == 1
    toc = [{"title": "Preface", "page": 3}, {"title": title, "page": 11}, {"title": "Chapter 2", "page": 20}]
    assert body_start.detect("pdf", toc, [])["body_start"]["page"] == 11


@pytest.mark.parametrize("title", ["Chapter 10", "Chapter 1.2", "1.1 Background", "1984", "Chi", "Chapter Ideas", "10 Waves"])
def test_not_chapter_one(title):
    assert body_start.chapter_one([title]) is None


def test_part_one_counts_when_a_chapter_follows_it():
    toc = [{"title": "Introduction", "page": 5}, {"title": "Part I: Foundations", "page": 9},
           {"title": "Chapter 1 Sets", "page": 10}]
    assert body_start.detect("pdf", toc, [])["body_start"] == {
        "kind": "pdf", "page": 9, "title": "Part I: Foundations",
        "anchor": {"kind": "pdf", "page": 9, "quads": [[0, 0, 0, 0]], "text": ""}}


def test_part_one_without_a_chapter_after_it_is_not_the_start():
    assert body_start.chapter_one(["Part One", "Notes"]) is None
    assert body_start.chapter_one(["Part One", "Glossary", "Chapter 1"]) == 2


def test_a_bare_introduction_is_not_chapter_one_but_a_numbered_one_is():
    toc = [{"title": "Introduction", "page": 5}, {"title": "The Old House", "page": 12}]
    assert body_start.detect("pdf", toc, [])["body_start"]["page"] == 12  # the first entry past the front matter
    toc = [{"title": "Preface", "page": 2}, {"title": "Chapter 1: Introduction", "page": 5}]
    assert body_start.detect("pdf", toc, [])["body_start"]["page"] == 5


def test_a_novel_with_unnumbered_chapters_starts_at_its_first_story_entry():
    toc = [{"title": "Cover", "spine_index": 0}, {"title": "Title", "spine_index": 1}, {"title": "Also by the author", "spine_index": 2},
           {"title": "The Boy Who Lived", "spine_index": 3}, {"title": "The Vanishing Glass", "spine_index": 4}]
    assert body_start.detect("epub", toc, [])["body_start"]["spine_index"] == 3


def test_section_numbers_and_front_matter_only_outlines_are_not_chapter_one():
    toc = [{"title": "Cover", "page": 1}, {"title": "Contents", "page": 2}, {"title": "List of Figures", "page": 3}]
    assert body_start.pick_outline(toc) is None


# --- (2) a heading in the region map -------------------------------------------------------------------------------

def test_no_outline_pdf_finds_the_chapter_heading_and_skips_the_contents_page():
    regions = [
        region(1, "A Book About Rivers"),
        region(3, "Contents"), region(3, "Chapter 1 Springs ........ 7", 1), region(3, "Chapter 2 Deltas ...... 19", 2),
        region(3, "Chapter 3 Floods ....... 31", 3),
        region(5, "Preface\n" + PROSE),
        region(7, "Chapter 1\nSprings"), region(7, PROSE, 1),
    ]
    found = body_start.detect("pdf", [], regions)
    assert found["source"] == "heading" and found["body_start"]["page"] == 7
    assert found["body_start"]["title"] == "Chapter 1"


def test_an_epub_heading_region_gives_its_spine_item():
    regions = [region(0, "Cover", pdf=False), region(2, "CHAPTER ONE", pdf=False, kind="prose"),
               region(2, PROSE, 1, pdf=False, kind="prose")]
    assert body_start.detect("epub", [], regions)["body_start"]["spine_index"] == 2


def test_math_and_code_regions_are_not_headings():
    regions = [region(2, "1 + 1 = 2", kind="math"), region(4, "Chapter 1"), region(4, PROSE, 1)]
    assert body_start.detect("pdf", [], regions)["body_start"]["page"] == 4


# --- (3) the first page after the contents with enough prose -------------------------------------------------------

def test_no_outline_no_heading_takes_the_first_long_page_after_the_contents():
    regions = [region(1, "Title " + " ".join(["w"] * 400)),  # before the contents: not taken
               region(2, "Table of Contents"), region(2, "Rivers 4", 1),
               region(3, "Short dedication"), region(4, " ".join(["word"] * 150)), region(4, " ".join(["word"] * 160), 1),
               region(5, PROSE)]
    found = body_start.detect("pdf", [], regions)
    assert found == {"source": "prose", "body_start": {
        "kind": "pdf", "page": 4, "title": None, "anchor": {"kind": "pdf", "page": 4, "quads": [[0, 0, 0, 0]], "text": ""}}}


def test_without_a_contents_page_the_first_long_page_wins():
    regions = [region(1, "Hi"), region(2, PROSE)]
    assert body_start.detect("pdf", [], regions)["body_start"]["page"] == 2


def test_nothing_found_is_none():
    assert body_start.detect("pdf", [], []) is None
    assert body_start.detect("epub", [{"title": "Cover", "spine_index": 0}], [region(0, "short", pdf=False)]) is None


# --- the reader's own choice ----------------------------------------------------------------------------------------

def test_a_readers_place_builds_the_same_shape():
    assert body_start.place("epub", 4, "Part Two") == {
        "kind": "epub", "spine_index": 4, "title": "Part Two", "anchor": {"kind": "epub", "cfi": "epubcfi(/6/10!/4)", "text": ""}}
    assert body_start.place("pdf", 12, None)["anchor"]["page"] == 12


# --- found on the project's own books (dry run, 2026-11-15) ---------------------------------------------------------

def test_an_outline_from_text_headings_takes_its_page_from_the_chunk():
    """A PDF with no outline gets books.toc from its chapter headings: chunk_index and block_id, no page."""
    toc = [{"title": "CONTENTS", "chunk_index": 2, "block_id": "2.0"}, {"title": "PREFACE", "chunk_index": 5, "block_id": "5.1"},
           {"title": "CHAPTER ONE From Zero to One", "chunk_index": 26, "block_id": "26.4"}]
    found = body_start.detect("pdf", toc, [], {26: 29, 5: 21})
    assert found["source"] == "outline" and found["body_start"]["page"] == 29


def test_for_book_reads_the_chunks_page_from_their_anchors():
    from backend.tests.memory_db import MemoryDb
    db = MemoryDb()
    db.tables["chunks"] = [{"book_id": "b", "chunk_index": 26, "anchors": {"kind": "pdf", "pages": [29, 30]}},
                           {"book_id": "b", "chunk_index": 3, "anchors": {"kind": "epub", "start": {"spine_index": 4}}}]
    db.tables["page_regions"] = []
    pdf = {"id": "b", "file_type": "pdf", "toc": [{"title": "Preface", "chunk_index": 1}, {"title": "Chapter 1", "chunk_index": 26}]}
    assert body_start.for_book(db, pdf)["body_start"]["page"] == 29
    epub = {"id": "b", "file_type": "epub", "toc": [{"title": "Chapter One", "chunk_index": 3}]}
    assert body_start.for_book(db, epub)["body_start"]["spine_index"] == 4


def test_page_numbers_and_a_running_head_do_not_make_a_contents_page():
    """A single chapter's PDF: "Chapter 14" on every page and its folio; the body is its first page."""
    regions = [region(1, "Chapter 14: Operational Amplifiers"), region(1, "1", 1), region(1, "Chapter 14 :\nOperational", 2),
               region(1, "14.1 Introduction", 3), region(1, PROSE, 4), region(2, "Chapter 14: Operational Amplifiers"),
               region(2, PROSE, 1)]
    assert body_start.detect("pdf", [], regions) == {"source": "prose", "body_start": body_start.place("pdf", 1, None)}


def test_a_numbered_list_item_is_not_a_chapter_heading():
    regions = [region(44, "Some text before"), region(44, "More text"), region(44, "Still more"),
               region(44, "1. Guaranteed by design.", 3), region(44, PROSE, 4)]
    assert body_start.detect("pdf", [], regions)["source"] == "prose"
    regions = [region(9, "9"), region(9, "1 Springs", 1), region(9, PROSE, 2)]
    assert body_start.detect("pdf", [], regions)["body_start"] == body_start.place("pdf", 9, "1 Springs")


def test_the_prose_step_starts_after_the_first_contents_pages_not_a_later_list():
    listing = [region(30, "Chapter 2 Rivers"), region(30, "Chapter 3 Lakes", 1), region(30, "Chapter 4 Seas", 2)]
    regions = [region(2, "Contents"), region(3, "Chapter 1 Springs"), region(3, "Chapter 2 Rivers", 1),
               region(3, "Chapter 3 Lakes", 2), region(4, PROSE), *listing, region(31, PROSE)]
    assert body_start.detect("pdf", [], regions)["body_start"]["page"] == 4


def test_measurements_are_not_contents_lines_but_numbered_titles_with_pages_are():
    page = [region(12, "26 mV"), region(12, "1 k 8.2 k 3REk", 1), region(12, "10 V", 2), region(12, PROSE, 3)]
    assert body_start.detect("pdf", [], page)["body_start"]["page"] == 12
    listing = [region(2, "1 Springs ..... 7"), region(2, "2 Rivers 19", 1), region(2, "3 Deltas 31", 2), region(3, PROSE)]
    assert body_start.detect("pdf", [], [region(1, PROSE), *listing])["body_start"]["page"] == 3
