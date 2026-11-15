"""The badge catalogue and its pure rules (C24.2, docs/GAMIFICATION.md Badges): each rule at its edge, the badges a
trigger can award, the first chapter's last chunk, a place at the end of a book, the technical-book share."""

import pytest

from backend.agents import policy
from backend.xp.badges import (
    CATALOGUE,
    Facts,
    by_id,
    chapter_one_last_chunk,
    earned,
    reaches_end,
    technical,
)

IDS = ["first_focus", "first_chapter", "focus_10h", "focus_50h", "focus_100h", "perfect_quiz", "streak_7",
       "streak_30", "streak_100", "first_note", "first_drawing", "first_steve", "finished_book", "technical_reader"]


def test_the_catalogue_is_gamifications_fourteen_badges_with_rewards():
    assert [b.id for b in CATALOGUE] == IDS
    for badge in CATALOGUE:
        assert badge.name and badge.description and callable(badge.rule)
        assert isinstance(badge.xp_reward, int) and badge.xp_reward > 0
        assert badge.triggers and set(badge.triggers) <= {"focus", "note", "steve", "place"}
        assert badge.kind in ("seal", "bookplate")
    assert by_id("streak_7").name == "7-day streak"


HOUR = 3600


@pytest.mark.parametrize(("badge", "facts", "holds"), [
    ("first_focus", Facts(), False),
    ("first_focus", Facts(passed_sessions=1), True),
    ("first_chapter", Facts(first_chapter=True), True),
    ("first_chapter", Facts(passed_sessions=3), False),
    ("focus_10h", Facts(focus_seconds=10 * HOUR - 1), False),
    ("focus_10h", Facts(focus_seconds=10 * HOUR), True),
    ("focus_50h", Facts(focus_seconds=50 * HOUR - 1), False),
    ("focus_50h", Facts(focus_seconds=50 * HOUR), True),
    ("focus_100h", Facts(focus_seconds=100 * HOUR - 1), False),
    ("focus_100h", Facts(focus_seconds=100 * HOUR), True),
    ("perfect_quiz", Facts(perfect_quiz=True), True),
    ("perfect_quiz", Facts(passed_sessions=1), False),
    ("streak_7", Facts(streak_days=6), False),
    ("streak_7", Facts(streak_days=7), True),
    ("streak_30", Facts(streak_days=29), False),
    ("streak_30", Facts(streak_days=30), True),
    ("streak_100", Facts(streak_days=99), False),
    ("streak_100", Facts(streak_days=100), True),
    ("first_note", Facts(text_notes=0), False),
    ("first_note", Facts(text_notes=1), True),
    ("first_note", Facts(drawings=1), False),  # a drawing is not a typed note
    ("first_drawing", Facts(drawings=1), True),
    ("first_drawing", Facts(text_notes=4), False),
    ("first_steve", Facts(steve_answers=0), False),
    ("first_steve", Facts(steve_answers=1), True),
    ("finished_book", Facts(finished_book=True), True),
    ("finished_book", Facts(), False),
    ("technical_reader", Facts(technical_book=True), True),
    ("technical_reader", Facts(passed_sessions=1), False),
])
def test_each_rule_at_its_edge(badge, facts, holds):
    assert by_id(badge).rule(facts) is holds


def test_earned_returns_new_badges_for_the_trigger_in_catalogue_order():
    facts = Facts(passed_sessions=1, focus_seconds=60 * HOUR, perfect_quiz=True, streak_days=7, text_notes=1)
    assert [b.id for b in earned(facts, set(), "focus")] == [
        "first_focus", "focus_10h", "focus_50h", "perfect_quiz", "streak_7"]
    assert [b.id for b in earned(facts, {"first_focus", "focus_10h"}, "focus")] == [
        "focus_50h", "perfect_quiz", "streak_7"]
    assert [b.id for b in earned(facts, set(), "note")] == ["first_note"]  # the note trigger checks notes only
    assert earned(facts, set(IDS), "focus") == []


@pytest.mark.parametrize(("trigger", "ids"), [
    ("note", {"first_note", "first_drawing"}),
    ("steve", {"first_steve"}),
    ("place", {"finished_book"}),
])
def test_what_each_trigger_can_award(trigger, ids):
    assert {b.id for b in CATALOGUE if trigger in b.triggers} == ids


def test_the_focus_trigger_covers_every_focus_badge():
    focus = {b.id for b in CATALOGUE if "focus" in b.triggers}
    assert focus == {"first_focus", "first_chapter", "focus_10h", "focus_50h", "focus_100h", "perfect_quiz",
                     "streak_7", "streak_30", "streak_100", "finished_book", "technical_reader"}


# --- the first chapter: the chunks from chapter 1 (the body start) to the next contents entry ------------------------

PDF_TOC = [{"title": "Preface", "page": 3, "chunk_index": 0}, {"title": "Chapter 1", "page": 7, "chunk_index": 2},
           {"title": "Chapter 2", "page": 19, "chunk_index": 6}, {"title": "Chapter 3", "page": 30, "chunk_index": 9}]


@pytest.mark.parametrize(("toc", "body_start", "last_chunk", "expected"), [
    (PDF_TOC, {"kind": "pdf", "page": 7}, 12, 5),
    (PDF_TOC, {"kind": "pdf", "page": 6}, 12, 5),  # the first entry at or after the body start
    (PDF_TOC, None, 12, 1),  # no body start: the first entry is chapter 1
    ([*PDF_TOC[:2]], {"kind": "pdf", "page": 7}, 12, 12),  # chapter 1 is the last entry: to the book's end
    ([{"title": "Ch 1", "page": 7, "chunk_index": 2}, {"title": "1.1", "page": 7, "chunk_index": 2},
      {"title": "Ch 2", "page": 12, "chunk_index": 4}], {"kind": "pdf", "page": 7}, 9, 3),  # same-chunk entries skipped
    ([{"title": "One", "spine_index": 2, "chunk_index": 1}, {"title": "Two", "spine_index": 3, "chunk_index": 4}],
     {"kind": "epub", "spine_index": 2}, 8, 3),
    ([{"title": "Chapter 1", "page": 2}], {"kind": "pdf", "page": 2}, 5, None),  # no chunk indices
    ([], {"kind": "pdf", "page": 2}, 5, None),
    (PDF_TOC, {"kind": "pdf", "page": 40}, 12, None),  # nothing at or after the body start
])
def test_chapter_one_last_chunk(toc, body_start, last_chunk, expected):
    assert chapter_one_last_chunk(toc, body_start, last_chunk) == expected


# --- the end of a book -------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("file_type", "unit", "page_count", "last_spine", "done"), [
    ("pdf", 240, 240, None, True),
    ("pdf", 239, 240, None, False),
    ("pdf", 241, 240, None, True),
    ("pdf", 240, None, None, False),  # page count unknown
    ("epub", 14, None, 14, True),  # in the last spine item with text
    ("epub", 13, None, 14, False),
    ("epub", None, None, 14, False),  # a CFI without a spine step
    ("epub", 14, None, None, False),
])
def test_reaches_end(file_type, unit, page_count, last_spine, done):
    assert reaches_end(file_type, unit, page_count, last_spine) is done


@pytest.mark.parametrize(("math_code", "total", "is_technical"), [
    (20, 100, True), (19, 100, False), (199, 1000, False), (200, 1000, True), (0, 0, False), (5, 5, True),
])
def test_technical_share(math_code, total, is_technical):
    assert policy.TECH_BOOK_SHARE == 0.20
    assert technical(math_code, total) is is_technical
