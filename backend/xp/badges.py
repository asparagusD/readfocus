"""The badge catalogue (C24.2, docs/GAMIFICATION.md Badges). Pure: no I/O. Each badge has an id, a name, a
description in plain words, a rule over a reader's Facts, a one-time XP reward, the triggers that check it and
the shelf it sits on (wax seals for habits, bookplates for books). badge_award.py gathers the facts and awards."""

from collections.abc import Callable
from dataclasses import dataclass

from backend.agents import policy

HOUR = 3600
TRIGGERS = ("focus", "note", "steve", "place")


@dataclass(frozen=True)
class Facts:
    passed_sessions: int = 0  # focus sessions whose quiz passed (F12)
    focus_seconds: int = 0  # their final active time
    perfect_quiz: bool = False  # this session's bookmark quiz had every answer right
    streak_days: int = 0  # the stored streak (G7)
    text_notes: int = 0
    drawings: int = 0
    steve_answers: int = 0
    first_chapter: bool = False  # this session's quiz covered the end of chapter 1
    finished_book: bool = False  # this place or bookmark is on the book's last page or spine item
    technical_book: bool = False  # this session's book is technical (TECH_BOOK_SHARE)


@dataclass(frozen=True)
class Badge:
    id: str
    name: str
    description: str
    rule: Callable[[Facts], bool]
    xp_reward: int
    triggers: tuple[str, ...]
    kind: str  # "seal" (a habit) or "bookplate" (a book)


def _hours(n: int) -> Callable[[Facts], bool]:
    return lambda f: f.focus_seconds >= n * HOUR


def _streak(n: int) -> Callable[[Facts], bool]:
    return lambda f: f.streak_days >= n


FOCUS = ("focus",)
CATALOGUE: tuple[Badge, ...] = (
    Badge("first_focus", "First focus session", "Finish a focus session and pass its quiz.",
          lambda f: f.passed_sessions >= 1, 20, FOCUS, "seal"),
    Badge("first_chapter", "First chapter", "Pass a focus session that reaches the end of a book's first chapter.",
          lambda f: f.first_chapter, 30, FOCUS, "bookplate"),
    Badge("focus_10h", "10 focused hours", "Spend 10 hours in focus sessions you passed.", _hours(10), 100, FOCUS,
          "seal"),
    Badge("focus_50h", "50 focused hours", "Spend 50 hours in focus sessions you passed.", _hours(50), 250, FOCUS,
          "seal"),
    Badge("focus_100h", "100 focused hours", "Spend 100 hours in focus sessions you passed.", _hours(100), 500,
          FOCUS, "seal"),
    Badge("perfect_quiz", "Perfect quiz", "Answer every question of a bookmark quiz correctly.",
          lambda f: f.perfect_quiz, 25, FOCUS, "seal"),
    Badge("streak_7", "7-day streak", "Meet your daily goal 7 days running.", _streak(7), 50, FOCUS, "seal"),
    Badge("streak_30", "30-day streak", "Meet your daily goal 30 days running.", _streak(30), 150, FOCUS, "seal"),
    Badge("streak_100", "100-day streak", "Meet your daily goal 100 days running.", _streak(100), 500, FOCUS, "seal"),
    Badge("first_note", "First note", "Write your first typed note.", lambda f: f.text_notes >= 1, 10, ("note",),
          "seal"),
    Badge("first_drawing", "First drawing", "Save your first drawing.", lambda f: f.drawings >= 1, 10, ("note",),
          "seal"),
    Badge("first_steve", "First Ask Steve", "Get your first answer from Steve.", lambda f: f.steve_answers >= 1, 10,
          ("steve",), "seal"),
    Badge("finished_book", "Finished a book", "Reach the last page of a book.", lambda f: f.finished_book, 200,
          ("focus", "place"), "bookplate"),
    Badge("technical_reader", "Technical-book reader",
          "Pass a focus session in a book where at least a fifth of the page regions are math or code.",
          lambda f: f.technical_book, 50, FOCUS, "bookplate"),
)
_BY_ID = {b.id: b for b in CATALOGUE}


def by_id(badge_id: str) -> Badge:
    return _BY_ID[badge_id]


def earned(facts: Facts, held: set[str], trigger: str) -> list[Badge]:
    """The badges this trigger checks that the facts satisfy and the reader does not hold, in catalogue order."""
    return [b for b in CATALOGUE if trigger in b.triggers and b.id not in held and b.rule(facts)]


def chapter_one_last_chunk(toc: list[dict], body_start: dict | None, last_chunk: int) -> int | None:
    """The last chunk of chapter 1: chapter 1 is the first contents entry at or after the body start (else the first
    entry); it ends before the next entry that starts a later chunk, else at the book's last chunk. None when the
    contents carry no chunk indices or nothing lies at or after the body start."""
    entries = [e for e in toc or [] if isinstance(e.get("chunk_index"), int)]
    if not entries:
        return None
    start = entries[0]
    if body_start:
        key = "page" if body_start.get("kind") == "pdf" else "spine_index"
        at = body_start.get(key)
        start = next((e for e in entries if at is not None and e.get(key) is not None and e[key] >= at), None)
        if start is None:
            return None
    later = next((e for e in entries[entries.index(start) + 1:] if e["chunk_index"] > start["chunk_index"]), None)
    return max(start["chunk_index"], later["chunk_index"] - 1) if later else max(start["chunk_index"], last_chunk)


def reaches_end(file_type: str, unit: int | None, page_count: int | None, last_spine: int | None) -> bool:
    """A place on a PDF's last page, or in an EPUB's last spine item with text (G: "Finished a book")."""
    end = page_count if file_type == "pdf" else last_spine
    return unit is not None and end is not None and unit >= end


def technical(math_code: int, total: int) -> bool:
    return total > 0 and math_code / total >= policy.TECH_BOOK_SHARE
