"""Awarding badges (C24.2, docs/GAMIFICATION.md Badges, G2): evaluate_badges(user, trigger) on an in-memory database
that enforces user_badges' and xp_events' keys. Each badge once, with one 'badge' XP row; facts read from the
reader's own rows; badge XP adds to the total but never to the day's goal or the streak."""

import json
from types import SimpleNamespace

import pytest

from backend.xp import award, badge_award
from backend.xp.badges import by_id

USER, OTHER, BOOK = "user-1", "user-2", "book-1"
HOUR = 3600


class UniqueViolation(Exception):
    code = "23505"


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.action = db, name, [], ("select", None)
        self.orders, self.cap, self.counting = [], None, False

    def select(self, columns="*", count=None):
        self.counting = count == "exact"
        return self

    def insert(self, values):
        self.action = ("insert", values)
        return self

    def update(self, values):
        self.action = ("update", values)
        return self

    def eq(self, column, value):
        self.filters.append(lambda r: r.get(column) == value)
        return self

    def in_(self, column, values):
        self.filters.append(lambda r: r.get(column) in values)
        return self

    def is_(self, column, value):
        assert value == "null"
        self.filters.append(lambda r: r.get(column) is None)
        return self

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def limit(self, count):
        self.cap = count
        return self

    def execute(self):
        if self.name in self.db.broken:
            raise RuntimeError(f"{self.name} is down")
        rows = self.db.tables.setdefault(self.name, [])
        kind, values = self.action
        if kind == "insert":
            row = json.loads(json.dumps(values))
            for keys in self.db.unique.get(self.name, ()):
                if any(all(r.get(k) == row.get(k) for k in keys) for r in rows):
                    raise UniqueViolation(f"duplicate key on {self.name}")
            rows.append(row)
            return SimpleNamespace(data=[row], count=None)
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if kind == "update":
            for r in matched:
                r.update(json.loads(json.dumps(values)))
        for column, desc in reversed(self.orders):
            matched.sort(key=lambda r: r[column], reverse=desc)
        total = len(matched)
        if self.cap is not None:
            matched = matched[:self.cap]
        return SimpleNamespace(data=json.loads(json.dumps(matched)), count=total if self.counting else None)


class Db:
    def __init__(self):
        self.tables = {name: [] for name in ("user_badges", "xp_events", "user_progress", "focus_sessions", "books",
                                             "sessions", "chunks", "page_regions", "note_blocks", "steve_messages")}
        self.unique = {"user_badges": [("user_id", "badge_id")], "xp_events": [("source", "source_id")],
                       "user_progress": [("user_id",)]}
        self.broken = set()

    def table(self, name):
        return Query(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = Db()
    monkeypatch.setattr(badge_award, "supabase", fake)
    monkeypatch.setattr(award, "supabase", fake)
    fake.tables["books"].append({"id": BOOK, "user_id": USER, "file_type": "pdf", "page_count": 40, "toc": [],
                                 "body_start": None})
    return fake


def pdf(page):
    return {"kind": "pdf", "page": page, "quads": [[50, 100, 60, 110]], "text": ""}


def scored(db, sid="fs-1", seconds=600, points=160, correct=2, total=3, end_page=6, user=USER):
    row = {"id": sid, "user_id": user, "book_id": BOOK, "status": "scored", "active_seconds": seconds,
           "points_total": points, "quiz_correct": correct, "quiz_total": total, "end_anchor": pdf(end_page),
           "ended_at": "2026-11-15T10:00:00+00:00"}
    db.tables["focus_sessions"].append(row)
    return dict(row)


def held(db, user=USER):
    return sorted(r["badge_id"] for r in db.tables["user_badges"] if r["user_id"] == user)


def badge_xp(db, user=USER):
    return sorted((r["source_id"], r["amount"]) for r in db.tables["xp_events"]
                  if r["user_id"] == user and r["source"] == "badge")


# --- once each ---------------------------------------------------------------------------------------------------

def test_the_first_passed_session_earns_first_focus_with_its_xp(db):
    assert badge_award.evaluate_badges(USER, "focus", session=scored(db), passed=True) == ["first_focus"]
    assert held(db) == ["first_focus"]
    reward = by_id("first_focus").xp_reward
    assert badge_xp(db) == [(f"{USER}:first_focus", reward)]
    row = db.tables["xp_events"][0]
    assert row["earned_at"] and len(row["local_day"]) == 10  # awarded now, on the reader's day
    assert db.tables["user_progress"][0]["total_xp"] == reward


def test_evaluating_again_awards_nothing_twice(db):
    session = scored(db)
    badge_award.evaluate_badges(USER, "focus", session=session, passed=True)
    for _ in range(3):
        assert badge_award.evaluate_badges(USER, "focus", session=session, passed=True) == []
    assert held(db) == ["first_focus"] and len(badge_xp(db)) == 1


def test_a_badge_refused_by_the_key_gets_no_second_xp_row(db, monkeypatch):
    """Two evaluations racing: both think the badge is new; the primary key refuses the second."""
    session = scored(db)
    badge_award.evaluate_badges(USER, "focus", session=session, passed=True)
    monkeypatch.setattr(badge_award, "_held", lambda user_id: set())
    assert badge_award.evaluate_badges(USER, "focus", session=session, passed=True) == []
    assert held(db) == ["first_focus"] and len(badge_xp(db)) == 1


def test_a_failed_or_unscored_session_awards_nothing(db):
    session = scored(db, points=0)
    assert badge_award.evaluate_badges(USER, "focus", session=session, passed=False) == []
    assert badge_award.evaluate_badges(USER, "focus", session={**session, "status": "awaiting_quiz"}, passed=True) == []
    assert badge_award.evaluate_badges(USER, "focus", session=None, passed=True) == []
    assert held(db) == [] and db.tables["xp_events"] == []


def test_an_unknown_trigger_is_refused(db):
    with pytest.raises(ValueError):
        badge_award.evaluate_badges(USER, "lunch")


# --- focus facts from the reader's own sessions ----------------------------------------------------------------------

def test_focused_hours_add_up_over_passed_sessions_only(db):
    scored(db, "a", seconds=6 * HOUR)
    scored(db, "b", seconds=3 * HOUR, points=0)  # failed: its time is not final
    scored(db, "c", seconds=40 * HOUR, user=OTHER)  # another reader's
    last = scored(db, "d", seconds=4 * HOUR - 1)
    assert "focus_10h" not in badge_award.evaluate_badges(USER, "focus", session=last, passed=True)
    last = scored(db, "e", seconds=1)
    assert badge_award.evaluate_badges(USER, "focus", session=last, passed=True) == ["focus_10h"]


def test_a_perfect_quiz_is_every_answer_right(db):
    assert "perfect_quiz" not in badge_award.evaluate_badges(USER, "focus", session=scored(db, "a"), passed=True)
    perfect = scored(db, "b", correct=3, total=3)
    assert badge_award.evaluate_badges(USER, "focus", session=perfect, passed=True) == ["perfect_quiz"]


@pytest.mark.parametrize(("days", "ids"), [(6, []), (7, ["streak_7"]), (30, ["streak_7", "streak_30"]),
                                           (100, ["streak_7", "streak_30", "streak_100"])])
def test_streak_badges_read_the_stored_streak(db, days, ids):
    db.tables["user_progress"].append({"user_id": USER, "total_xp": 0, "daily_goal": 50, "timezone": "UTC",
                                       "streak_days": days, "streak_freezes": 0, "last_goal_day": "2026-11-15"})
    got = badge_award.evaluate_badges(USER, "focus", session=scored(db), passed=True)
    assert [i for i in got if i.startswith("streak")] == ids


def test_the_first_chapter_is_reached_when_the_quiz_covers_its_last_chunk(db):
    db.tables["books"][0].update(toc=[{"title": "Chapter 1", "page": 3, "chunk_index": 1},
                                      {"title": "Chapter 2", "page": 12, "chunk_index": 4}],
                                 body_start={"kind": "pdf", "page": 3})
    db.tables["chunks"] = [{"book_id": BOOK, "chunk_index": i, "block_paths": None} for i in range(8)]
    db.tables["sessions"].append({"id": "a", "user_id": USER, "chunk_start_index": 1, "chunk_end_index": 2})
    assert "first_chapter" not in badge_award.evaluate_badges(USER, "focus", session=scored(db, "a"), passed=True)
    db.tables["sessions"].append({"id": "b", "user_id": USER, "chunk_start_index": 2, "chunk_end_index": 3})
    assert "first_chapter" in badge_award.evaluate_badges(USER, "focus", session=scored(db, "b"), passed=True)


def test_a_technical_book_has_a_fifth_of_its_regions_math_or_code(db):
    kinds = ["math"] * 15 + ["code"] * 4 + ["prose"] * 81  # 19%
    db.tables["page_regions"] = [{"id": n, "book_id": BOOK, "kind": k} for n, k in enumerate(kinds)]
    assert "technical_reader" not in badge_award.evaluate_badges(USER, "focus", session=scored(db, "a"), passed=True)
    db.tables["page_regions"].append({"id": 999, "book_id": BOOK, "kind": "code"})  # 20 of 101: 19.8%
    db.tables["page_regions"] = [r for r in db.tables["page_regions"] if r["id"] != 50]  # 20 of 100
    assert "technical_reader" in badge_award.evaluate_badges(USER, "focus", session=scored(db, "b"), passed=True)


# --- notes, Steve and the reading place ------------------------------------------------------------------------------

def test_notes_earn_first_note_and_first_drawing_by_kind(db):
    db.tables["note_blocks"].append({"id": "n1", "user_id": USER, "kind": "equation"})
    assert badge_award.evaluate_badges(USER, "note") == []
    db.tables["note_blocks"].append({"id": "n2", "user_id": USER, "kind": "drawing"})
    assert badge_award.evaluate_badges(USER, "note") == ["first_drawing"]
    db.tables["note_blocks"].append({"id": "n3", "user_id": OTHER, "kind": "text"})
    assert badge_award.evaluate_badges(USER, "note") == []
    db.tables["note_blocks"].append({"id": "n4", "user_id": USER, "kind": "text"})
    assert badge_award.evaluate_badges(USER, "note") == ["first_note"]


def test_an_answered_ask_steve_earns_first_steve(db):
    db.tables["steve_messages"].append({"id": "m1", "user_id": USER, "role": "reader"})
    assert badge_award.evaluate_badges(USER, "steve") == []
    db.tables["steve_messages"].append({"id": "m2", "user_id": USER, "role": "steve"})
    assert badge_award.evaluate_badges(USER, "steve") == ["first_steve"]


@pytest.mark.parametrize(("page", "done"), [(39, False), (40, True)])
def test_a_place_on_a_pdfs_last_page_finishes_the_book(db, page, done):
    got = badge_award.evaluate_badges(USER, "place", book_id=BOOK, anchor=pdf(page))
    assert got == (["finished_book"] if done else [])


@pytest.mark.parametrize(("cfi", "done"), [("epubcfi(/6/28!/4/2/1:0)", False), ("epubcfi(/6/30!/4/2/1:0)", True)])
def test_a_place_in_an_epubs_last_spine_item_with_text_finishes_the_book(db, cfi, done):
    db.tables["books"][0].update(file_type="epub", page_count=None)
    db.tables["chunks"] = [{"book_id": BOOK, "chunk_index": 0, "block_paths": [{"spine_index": 3}]},
                           {"book_id": BOOK, "chunk_index": 1, "block_paths": [{"spine_index": 13},
                                                                               {"spine_index": 14}]}]
    got = badge_award.evaluate_badges(USER, "place", book_id=BOOK, anchor={"kind": "epub", "cfi": cfi})
    assert got == (["finished_book"] if done else [])


def test_another_readers_book_finishes_nothing(db):
    db.tables["books"].append({"id": "book-2", "user_id": OTHER, "file_type": "pdf", "page_count": 3})
    assert badge_award.evaluate_badges(USER, "place", book_id="book-2", anchor=pdf(3)) == []


def test_the_focus_bookmark_on_the_last_page_finishes_the_book(db):
    assert "finished_book" in badge_award.evaluate_badges(USER, "focus", session=scored(db, end_page=40), passed=True)


# --- badge XP and the day's goal -----------------------------------------------------------------------------------

def test_badge_xp_adds_to_the_total_but_not_to_the_days_goal(db):
    session = {**scored(db, points=40), "points_total": 40}
    award.award_focus_xp(session)  # 40 of a 50 goal
    badge_award.evaluate_badges(USER, "focus", session=session, passed=True)  # + first_focus's reward
    progress = db.tables["user_progress"][0]
    assert progress["total_xp"] == 40 + by_id("first_focus").xp_reward
    assert progress["streak_days"] == 0 and progress["last_goal_day"] is None
    out = award.award_focus_xp({**session, "id": "fs-2"})  # the day's focus XP: 80, the goal met now
    assert out["day_xp"] == 80 and out["goal_met"] is True
