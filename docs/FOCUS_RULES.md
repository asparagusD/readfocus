# Focus rules

How focus mode times reading, scores it and closes it with the bookmark
quiz. This file is the single source of truth for later chunks; numbers
are policy defaults, tunable in `backend/agents/policy.py`. Written in
C16.3, before any code. Anchors and chunk mapping: `docs/ANCHORS.md`.

## Defaults

| Name | Default | Rule |
|---|---|---|
| `FOCUS_POINTS_PER_MINUTE` | 10 | F4 |
| `FOCUS_HEARTBEAT_S` | 15 | F3 |
| `FOCUS_MAX_GAP_S` | 45 | F3 |
| `FOCUS_MIN_HEARTBEAT_GAP_S` | 5 | F3 |
| `FOCUS_HEARTBEAT_RATE_S` | 25 | F3 |
| `FOCUS_EVENT_RATE_S` | 2 | F3 |
| `FOCUS_ABANDON_AFTER_MIN` | 120 | F1 |
| `FOCUS_IDLE_PROMPT_MIN` | 10 | F6 |
| `FOCUS_IDLE_ANSWER_S` | 60 | F6 |
| `FOCUS_PAGE_CAP_MIN` | 30 | F7 |
| `FOCUS_SESSION_CAP_MIN` | 180 | F8 |
| `QUIZ_WORDS_PER_QUESTION` | 400 | F10 |
| `QUIZ_MIN_QUESTIONS`, `QUIZ_MAX_QUESTIONS` | 3, 15 | F10 |
| `QUIZ_POINTS_PER_CORRECT` | 20 | F11 |
| `QUIZ_PASS_SCORE` | 0.40 | F12 |

## Rules

**F1. Toggle.** Focus mode can be turned on or off at any time from the
reader. Turning it off pauses the stopwatch; turning it on again resumes
the same focus session until a bookmark ends it (F9). An open
session with no event for `FOCUS_ABANDON_AFTER_MIN` minutes is abandoned and
earns 0 (checked when the server starts and whenever the session is read;
C23.4, open question 2).

**F2. Body start.** The stopwatch runs only in focus mode and only at or
after the book's body start: the first block of chapter 1 as found by the
structure parser (`books.toc`), or, when a book has no chapters, the first
page whose region map shows prose after the front matter. Before body
start the reader sees "The stopwatch starts at chapter 1".

**F3. Server time.** The client sends events (heartbeat every
`FOCUS_HEARTBEAT_S` with a `had_input` flag, page turn, hidden and visible,
pause and resume, idle answer, bookmark), each with an id. The server
timestamps them on arrival, ignores duplicates, and accrues active time from
its own clock, only between two heartbeats at most `FOCUS_MAX_GAP_S` apart;
a heartbeat sooner than `FOCUS_MIN_HEARTBEAT_GAP_S` after the last one
counted is ignored. The client's own timestamps are never scored (C23.3).
The API stores at most one heartbeat per `FOCUS_HEARTBEAT_RATE_S` and one
other event of the same kind per `FOCUS_EVENT_RATE_S`; a resent or extra
event is not stored, only counted on the session (C23.4).

**F4. Points.** Each active minute earns `FOCUS_POINTS_PER_MINUTE`
points, provisionally; they become final only when the session's quiz
passes (F12).

**F5. Hidden tab.** While the tab is hidden (Page Visibility API), the
stopwatch pauses; it resumes when the tab is visible again.

**F6. Idle.** After `FOCUS_IDLE_PROMPT_MIN` minutes with no input
(scroll, key, pointer, page turn), a gentle "Still with the book?" prompt
appears. If it is not answered within `FOCUS_IDLE_ANSWER_S` seconds, the
stopwatch pauses from the moment the prompt appeared; answering resumes
it. The prompt never blocks reading.

**F7. Page cap.** Active time on one page beyond `FOCUS_PAGE_CAP_MIN`
minutes without a page turn earns 0 points (voided); the first
`FOCUS_PAGE_CAP_MIN` minutes still count. Time is active time on that page
visit, not the clock, so a tab closed on a page and reopened later is not
voided for the time it was closed. (A page is a PDF page, or an EPUB screen
page between two turns.) Decided at C23.3 (open question 1).

**F8. Session cap.** At `FOCUS_SESSION_CAP_MIN` minutes of active time
the stopwatch stops and the bookmark quiz starts (F9-F10); no further
time accrues in that session.

**F9. Ending.** A focus session ends when the reader places a bookmark
(or at the cap, F8, at the current position). The bookmark is a point
anchor (ANCHORS A3).

**F10. Bookmark quiz.** The quiz covers the text from the session's start
position to the bookmark, mapped to chunks (ANCHORS A6), with questions
from the existing question bank for those chunks. Number of questions:
`clamp(round(words / QUIZ_WORDS_PER_QUESTION), QUIZ_MIN_QUESTIONS,
QUIZ_MAX_QUESTIONS)`, where `words` counts the covered text. Graded by the
existing algorithmic grader. Steve is unavailable during the quiz.

**F11. Bonus.** Each correct answer earns `QUIZ_POINTS_PER_CORRECT`
points.

**F12. Pass mark.** If the quiz score is below `QUIZ_PASS_SCORE`, the
whole session earns 0 (time points and bonus). At or above it, time
points (F4-F8) plus the bonus (F11) are final and become XP
(`docs/GAMIFICATION.md`).

**F13. Outside focus mode.** The reader can ask "Quiz me" on the text
read since the last bookmark; same questions and grading, no points, no
XP, no badge, no streak credit.

**F14. Server is the source of truth.** Only the server computes time,
points, quiz scores and XP, from the events in F3 and the stored quiz;
the client never sends a number it computed. Each session's points are
written once (idempotent per session, as mastery is per event since
C7.4).

## Open questions

1. ~~F7: the whole page's time earns 0, or only the minutes beyond the
   cap?~~ Only the minutes beyond (C23.3 prompt, 2026-11-15).
2. ~~F1/F9: a focus session left open without a bookmark resumes on the
   next visit; should it instead close after some hours?~~ Abandoned after
   two hours with no event (C23.4 prompt, 2026-11-15).
3. F2: may the reader correct a wrongly detected body start?
