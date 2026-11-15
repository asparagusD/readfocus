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
  the focus session ended, plus each badge's one-time reward (changed in
  C24.2, at the prompt's request: until then nothing else earned XP).
  Badge XP adds to the total only: the daily goal (G5) and the streak
  (G7) count focus XP alone. "Quiz me" outside focus mode earns none.
- **G5.** Daily goal: `DAILY_GOAL_XP` = 50 by default (five active
  minutes). The reader can change it in settings, within
  `DAILY_GOAL_SET_MIN_XP` 20 and `DAILY_GOAL_SET_MAX_XP` 200 (C24.5); the
  database accepts `DAILY_GOAL_MIN_XP` 10 to `DAILY_GOAL_MAX_XP` 500.
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
- **G12. Groups.** At the start of each week (the rollover), readers with
  XP in the `LEAGUE_ACTIVE_DAYS` = 14 days before it are placed in groups
  of about `LEAGUE_GROUP_SIZE` = 30 readers of the same tier, in the order
  they joined (their first XP), the groups of a tier as even as possible.
  Only real readers; a group may be smaller than 30 when few readers are
  active. A reader whose first XP comes mid-week joins at the next
  rollover. (Changed in C24.3, at the prompt's request: until then readers
  were placed on their first XP of the week.)
- **G13. Promotion and demotion.** At rollover each group is ranked by the
  week's XP, ties going to who reached it first. The top
  `LEAGUE_PROMOTE` = 7 move up a tier and the bottom `LEAGUE_DEMOTE` = 5
  move down; in a group smaller than 30 these scale to `n * 7 / 30` and
  `n * 5 / 30`, rounded half up. Only a reader with at least 1 XP that
  week moves up, and a group smaller than `LEAGUE_DEMOTE_MIN_GROUP` = 10
  demotes nobody (C24.3). No promotion from Illuminated, no demotion from
  Pamphlet. A reader not active in the last 14 days keeps their tier and
  joins no group.
- **G14. Opt-out.** A reader can opt out of leaderboards in settings: they
  keep their group, tier and movement but are shown on nobody else's board
  (ranks keep their true numbers); they still see their own. XP, streaks
  and badges still work. (Changed in C24.3, at the prompt's request: until
  then opted-out readers were placed in no group.)

## Notifications

- **G15.** Off by default. A reader may turn on one daily reminder at a
  time they choose, worded neutrally ("Your book is where you left
  it."). No streak warnings, no league taunts, no badges teased.

## As built

- **C24.1 XP, goal and streaks.** `xp_events` (migration 031) is the
  ledger: one row per source event, unique `(source, source_id)`, so a
  retried award writes nothing (G2). Sources `focus`, `badge` and
  `adjustment`; only `focus` writes in C24.1 (G4). Each row keeps
  `earned_at` (the focus session's end) and `local_day`, that moment's day
  in the reader's time zone at award time (G6; an unknown zone counts as
  UTC). `user_progress` holds the total, the goal, the zone and the stored
  streak (days, freezes held, last goal day), which moves only when a day's
  XP first reaches the goal (`backend/xp/streaks.py on_goal_day`). On any
  other day `view()` works out the missed days since without writing:
  today is never missed, freezes cover the rest or the streak shows 0,
  quietly. A frozen day is not counted, so the next freeze takes 7 more
  counted days (G8). A session graded late for a day before the last goal
  day adds XP but does not move the streak. Code: `backend/xp/`.
- **C24.5 APIs.** `GET /me/progress` (total XP, today's focus XP against
  the goal in the reader's zone, the streak as of today with frozen days,
  this week's tier or the carried one, badges held; writes nothing),
  `PUT /me/progress` (`daily_goal` 20-200, `display_name` or null,
  `leaderboard_opt_out`, `timezone` an IANA name; anything else refused),
  `GET /badges` (the 14 with earned and when), `GET /leagues/current`
  (runs a due rollover first; the reader's group ranked by this week's XP
  from the ledger, zone markers, opted-out readers left off others'
  boards). A row names a reader by a per-week pseudonym (12 hex of
  sha256 of the week's id and the user id; the week id never leaves the
  server) and their display name, else "Reader" and the pseudonym's first
  4; the sign-in's name and emails are never used. Display names
  (`backend/xp/names.py`): 1-40 characters after trimming, no control
  characters, links or emails, no staff, ReadFocus or Steve names, and a
  small local profanity check per word that undoes digit, "ph" and
  spelled-out disguises.
- **C24.4 Rollover.** `POST /internal/leagues/rollover` with
  `Authorization: Bearer <CRON_SECRET>` (constant-time compare; 503 when
  the secret is unset or under 32 characters, 401 otherwise) runs
  `league_store.roll_over`, idempotent: a second call closes and forms
  nothing. Called by `.github/workflows/league-rollover.yml` (Mondays 00:05
  UTC, chosen over Supabase Cron: no extensions or Vault secret in the
  database, and curl retries through Render's cold start where pg_net's 2 s
  default would time out). Streaks need no daily job: they are worked out
  on read (C24.1).
- **C24.2 Badges.** The 14 above, in `backend/xp/badges.py` (id, name,
  description, rule, XP reward, the triggers that check it, seal or
  bookplate); held in `user_badges` (migration 032), one row per reader and
  badge. `badge_award.evaluate_badges(user, trigger)` runs after a focus
  quiz passes, a note is created, Steve answers and a reading place with an
  anchor is saved; it reads only what the trigger's unheld badges need and
  never fails the request (errors are logged). Rewards: first focus 20,
  first chapter 30, 10/50/100 h 100/250/500, perfect quiz 25, 7/30/100-day
  streak 50/150/500, first note, drawing and Ask Steve 10 each, finished a
  book 200, technical-book reader 50. As read: "first chapter" is the quiz
  range reaching the last chunk before the contents entry after chapter 1
  (the entry at the body start); "finished a book" is a PDF's last page by
  `page_count` (back matter counts as body) or an EPUB's last spine item
  with text (being in it, not its last character); "passed" is a scored
  session with points (or the one being scored); a typed note is kind
  `text`; "First Ask Steve" is a saved Steve answer.

## Open questions

1. G8: is "one freeze per 7 counted days" the right way to earn them?
2. G13: when a group is smaller than 30, scale promotion and demotion (as
   written) or keep 7 and 5?
3. Badges: should "Finished a book" also require passed quizzes, so
   skimming to the end does not earn it?
