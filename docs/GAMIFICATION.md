# Gamification

XP, the daily goal, streaks, badges and weekly leagues. This file is the
single source of truth for later chunks; numbers are policy defaults,
tunable in `backend/agents/policy.py`. Written in C16.3, before any code.
Points come from `docs/FOCUS_RULES.md`.

## Principles

- **G1. No dark patterns.** No guilt or loss-framed notifications ("your
  streak is about to die"), no fake urgency, no fake users or bots in
  leagues, nothing for sale: freezes are earned, never bought.
- **G2. Server only.** Only the server writes XP, streaks, badges and
  league standings, from final focus points (FOCUS_RULES F14); each award
  is idempotent per source event.
- **G3. Privacy.** Leaderboards show display name and XP only, never an
  email, book title or reading detail.

## XP and daily goal

- **G4.** XP = final focus points (FOCUS_RULES F12), credited to the day
  the focus session ended. Nothing else earns XP; "Quiz me" outside focus
  mode earns none.
- **G5.** Daily goal: `DAILY_GOAL_XP` = 50 by default (five active
  minutes). The reader can change it in settings, within
  `DAILY_GOAL_MIN_XP` 10 and `DAILY_GOAL_MAX_XP` 500.
- **G6.** Days are the reader's local calendar days, from the time zone
  stored in their profile (taken from the browser, editable).

## Streaks

- **G7.** A day counts towards the streak when the reader meets the daily
  goal that day. The streak is the number of consecutive counted days
  ending today or yesterday.
- **G8.** Streak freezes: the reader holds at most `STREAK_FREEZE_MAX` = 2.
  One is earned at every `STREAK_FREEZE_EVERY_DAYS` = 7 consecutive
  counted days, while fewer than 2 are held. A missed day uses one held
  freeze automatically and keeps the streak (the day is shown as frozen,
  not counted); with none held, the streak resets to 0.
- **G9.** Freezes cannot be bought, gifted or earned any other way.

## Badges

Each badge is awarded once, by the server, when its condition first
holds. "Passed focus session" means a focus session whose quiz reached
the pass mark (FOCUS_RULES F12).

| Badge | Condition |
|---|---|
| First focus session | the first passed focus session |
| First chapter | a passed focus session whose covered text reaches the end of the book's first chapter |
| 10 focused hours | 10 h of final active focus time in total |
| 50 focused hours | 50 h |
| 100 focused hours | 100 h |
| Perfect quiz | a bookmark quiz with every answer correct |
| 7-day streak | a streak of 7 (G7) |
| 30-day streak | a streak of 30 |
| 100-day streak | a streak of 100 |
| First note | the first typed note saved |
| First drawing | the first drawing saved |
| First Ask Steve | the first answered Ask Steve request |
| Finished a book | the reader's bookmark or reading position reaches the book's last body page (PDF) or last spine item's end (EPUB) |
| Technical-book reader | a passed focus session in a book whose region map has at least `TECH_BOOK_SHARE` = 20% of its regions typed math or code |

## Weekly leagues

- **G10. Tiers**, lowest to highest: Pamphlet, Paperback, Hardcover,
  Folio, First Edition, Illuminated. A reader's first league week is in
  Pamphlet.
- **G11. Week.** Monday 00:00 UTC to the next Monday 00:00 UTC, for
  everyone (leagues ignore G6). The rollover runs on the server from a
  scheduled call authenticated with `CRON_SECRET`.
- **G12. Groups.** Readers who earn XP in a week are placed, on their
  first XP of that week, in a group of about `LEAGUE_GROUP_SIZE` = 30
  readers of the same tier. Only real readers; a group may be smaller
  than 30 when few readers are active.
- **G13. Promotion and demotion.** At rollover the top
  `LEAGUE_PROMOTE` = 7 move up a tier and the bottom `LEAGUE_DEMOTE` = 5
  move down. In a group smaller than 30 these scale to
  `round(n * 7 / 30)` and `round(n * 5 / 30)`. No promotion from
  Illuminated, no demotion from Pamphlet. Ties are broken by who reached
  the XP first. A reader with no XP in a week keeps their tier and joins
  no group.
- **G14. Opt-out.** A reader can opt out of leaderboards in settings: they
  are placed in no group and shown nowhere; XP, streaks and badges still
  work. Opting back in starts at their last tier the next week.

## Notifications

- **G15.** Off by default. A reader may turn on one daily reminder at a
  time they choose, worded neutrally ("Your book is where you left
  it."). No streak warnings, no league taunts, no badges teased.

## Open questions

1. G8: is "one freeze per 7 counted days" the right way to earn them?
2. G13: when a group is smaller than 30, scale promotion and demotion (as
   written) or keep 7 and 5?
3. Badges: should "Finished a book" also require passed quizzes, so
   skimming to the end does not earn it?
