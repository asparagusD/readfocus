# Claude Design handoff, phase 2: summary (CD2.2)

Two files from Claude Design, received 2026-11-12:

1. `design_phase_2.html` (7,607,201 bytes, SHA-256 `7e123533…ae36cfd2`):
   one self-contained page that unpacks 12 boards from an embedded,
   gzipped manifest. Saved unchanged as
   [`handoff-phase2/design_phase_2.html`](handoff-phase2/design_phase_2.html)
   (hash matched after copying). The two phase-2 sources worth reading are
   also saved decoded, byte for byte, under
   [`handoff-phase2/extracted/`](handoff-phase2/extracted/).
2. `readfocus_phase_2_images.zip`: the same 12 boards as PNGs at 1x. The
   phase-2 boards are 13 to 23 MB each, so they are not committed whole;
   each artboard was cropped into
   [`screens/phase2/`](screens/phase2/) (see [Screen images](#screen-images)).

Reference only: nothing in `design/` is imported by the app. The phase-1
decisions D1–D6 in [`HANDOFF_SUMMARY.md`](HANDOFF_SUMMARY.md) still apply
and override these files, as do the specs `docs/ANCHORS.md`,
`docs/FOCUS_RULES.md` and `docs/GAMIFICATION.md` until a decision says
otherwise ([Gaps](#gaps-and-conflicts)).

## What the bundle contains

| Board | Size (px) | Phase | Source |
|---|---|---|---|
| Foundations — style guide | 1440 x 3700 | 1 | Same as `handoff/foundations-style-guide/Main.dc.html` apart from serialization (compared after normalizing) |
| Components — paper & lamplight | 2960 x 3900 | 1 | Already cut in CD.3; not compared |
| Prototype — Login → … → Dashboard | 1440 x 900 | 1 | Already cut in CD.3; not compared |
| Desktop 1440 · screens 1–5, 6–10 | 3088 x 5400 each | 1 | Already cut in CD.3; not compared |
| Mobile 375 · all screens | 4240 x 2000 | 1 | Already cut in CD.3; not compared |
| Phase 2 prototype — technical book → highlight → Steve → note → focus → bookmark quiz → XP & league | 1440 x 900 | 2 | `Study.dc.html`, live (`still` off) |
| Phase 2 components — paper & lamplight | 2960 x 4300 | 2 | `PhaseTwoComponents.dc.html` |
| Phase 2 · desktop · original view & Steve | 3088 x 6400 | 2 | `Study.dc.html`, screens 11–16 |
| Phase 2 · desktop · highlights, notes, focus | 3088 x 6400 | 2 | `Study.dc.html`, screens 17–22 |
| Phase 2 · desktop · quiz, points, progress, league | 3088 x 6400 | 2 | `Study.dc.html`, screens 23–28 |
| Phase 2 · mobile 375 · all screens | 7560 x 2000 | 2 | `Study.dc.html`, screens 11–28 |

All five phase-2 screen boards render one Design Component,
`Study.dc.html` (113,075 bytes; the four board copies are byte-identical,
SHA-256 `71437700…`). Its props: `stage` (the 18 screen ids below),
`theme` (`paper`, `lamplight`), `accent` (`terracotta`, `sage`), `still`
(frozen frame for the boards) and `frameH`. Its `initState()` says which
state each screen shows; its `renderVals()` holds the copy, the sample
book (*Signals, Gently*, §4.2 "The coefficients", pp. xi–xii and 44–47),
quiz questions, points rows, league rows and badges. The prototype page is
the same component compiled to `sc-camel-*` attributes. Each page also
carries the dc-runtime, React 18.3.1 and Google Fonts files, none of them
part of the design.

## Screen images

75 files in `screens/phase2/`, 44 MB in total, largest 1,359,617 bytes.
Names are `<screen>-<theme>-<width>.png`.

| Set | Files | Pixel size | Cut from |
|---|---|---|---|
| Desktop | 18 screens x Paper/Lamplight, `-1440.png` | 1440 x 900 | The three desktop boards: x = 64 (Paper) and 1584 (Lamplight), rows every 1040 px from y = 124 |
| Mobile | 18 screens x Paper/Lamplight, `-375.png` | 375 x 812 (1x; the boards have no 2x) | Mobile board: x = 64 + 415 n, y = 148 (Paper) and 1108 (Lamplight) |
| Components | `components-phase2-paper-sheet.png`, `components-phase2-lamplight-sheet.png` | 1384 x 3476 | Components board, x = 64 and 1512, y = 64 to 3540 |
| Prototype | `prototype-phase2-original-pdf-paper-1440.png` | 1440 x 941 | The prototype PNG, whole (its first frame, screen 11) |

All images use the terracotta accent; sage is not rendered anywhere.
The zip also holds the six phase-1 boards again at 1x; they were not
re-cut (CD.3 crops at 2x stay).

| No. | Screen id | Board title |
|---|---|---|
| 11 | `original-pdf` | Original view · PDF spread, equation affordances |
| 12 | `original-epub` | Original view · EPUB layout, figure and code affordances |
| 13 | `steve-consent` | Steve · first-use consent |
| 14 | `steve-empty` | Steve · empty state with suggestions |
| 15 | `steve-answer` | Steve · streaming answer with citations, math, code |
| 16 | `steve-paused` | Steve · paused for today |
| 17 | `steve-key` | Steve · use your own key |
| 18 | `highlight` | Highlights · selection toolbar and Ask Steve chip |
| 19 | `notes` | Notepad beside the book · margin markers |
| 20 | `focus-locked` | Focus · stopwatch locked before Chapter 1 |
| 21 | `focus` | Focus · 2:45, fifteen minutes left |
| 22 | `bookmark` | End of session · ribbon set, ready for questions |
| 23 | `quiz` | Bookmark quiz · one question at a time |
| 24 | `results` | Results · points breakdown |
| 25 | `results-low` | Results · under 40%, no points, explained kindly |
| 26 | `progress` | Progress · XP, daily goal, candle streak, badge shelf |
| 27 | `league` | Weekly league · tiers, zones, promotion banner |
| 28 | `celebrate` | Promotion · calm celebration |

## New tokens

The components sheet says phase 2 "adds to the phase 1 sheet · same
tokens and motion scale". Every phase-1 colour, accent and motion value in
`Study.dc.html` equals `frontend/src/styles/tokens.css` and D3 (long
easing names, `--dur-1..6`). New:

| Token | Paper | Lamplight | Use |
|---|---|---|---|
| `--hl-honey` | `#F4E2A8` | `rgba(233,182,94,.30)` | Highlight |
| `--hl-sage` | `#DCE6CF` | `rgba(168,193,152,.26)` | Highlight |
| `--hl-sky` | `#D5E2EC` | `rgba(130,170,205,.28)` | Highlight |
| `--hl-rose` | `#F0D6D0` | `rgba(222,140,128,.28)` | Highlight |
| `--hl-lilac` | `#E4DCEC` | `rgba(182,160,212,.28)` | Highlight |
| `--code-bg` | `#F3EDE3` | `#1A1612` | Code blocks |
| `--grain` | `.05` | `.06` | Opacity of the SVG noise overlay (multiply on Paper, screen on Lamplight) |
| `--drop` | `rgba(40,25,10,.35)` | `rgba(0,0,0,.6)` | Shadow colour (phase 1 inlined it) |

- Swatch dots in the picker are fixed hex, not tokens: honey `#D9B84F`,
  sage `#8FAE7E`, sky `#7FA3C2`, rose `#D08A7E`, lilac `#A892C6`. Each
  has a name for screen readers ("Honey highlight").
- Fonts: **Caveat 500** (labels in drawings) and **JetBrains Mono 400/500**
  (code at 11.5–12.5 px, line height 1.65; LaTeX source lines). Math is
  hand-built HTML in Lora; the sheet says "KaTeX output inherits Lora".
- Container breakpoint: `@container rf (max-width: 760px)` switches to the
  one-page, pull-up-sheet layout.
- Reduced motion: every animation and transition drops to 1 ms; the
  streaming answer and the XP count-up show their final state at once.

Contrast, recomputed with the WCAG formula:

| Pair | Paper | Lamplight |
|---|---|---|
| `--ink` on each highlight (Lamplight: over `--page`) | 11.11–11.88 | 6.59 (honey)–7.90 |
| `--accent-text` on `--accent-soft` (citation chips, counts) | 5.12 terracotta, 5.47 sage | 7.00, 7.86 |
| `--accent-text` on `--code-bg` (code keywords) | 5.54, 5.78 | 8.92, 10.27 |
| `--ink-3` on `--code-bg` (code comments) | 4.53 | 6.04 |
| `--ink-3` on `--accent-soft` (league "you" row rank) | **4.19, 4.29** | 4.74, 4.62 |
| Swatch dot on `--surface` (non-text, 3:1) | **1.89–2.72** | 5.84–8.39 |
| `--line-2` field border on `--paper` (non-text, 3:1) | **1.50** | **1.73** |

## New components

Variants and states as drawn; prototype-only controls ("Jump to 2:45",
"Preview Sunday's promotion") are not part of the product.

| Component | Variants and states |
|---|---|
| Reader toolbar | Back to Library; book title (Lora italic + chapter); segmented **Original / Reading view**; PDF zoom −/+ (90–120 %, steps of 10, value shown); EPUB smaller/larger text "A"; Focus switch; Notes with count badge; Steve; theme toggle. Pressed state for the open panel. Under 760 px labels and title hide and the bar scrolls sideways. |
| Original-view spread | Two pages with a gutter shadow, or one page under 760 px. Running header, folio (EPUB: "p. 44 of 380"), "Previous / pp. 44–45 · Chapter 4 / Next" footer. PDF text Lora 15.5 px x zoom, line 1.62, justified; EPUB Lora 16.5 px, line 1.7, section heads in DM Sans caps. Front matter (preface, contents) shown with "Front matter · the focus clock starts at Chapter 1". Page flash (2 px accent inset, 800 ms) when a citation or note jumps to it. |
| Block affordances | Equation: "Explain this equation", "Copy as LaTeX". Figure: "Explain this figure", "Add to notes". Code: "Copy code", "Explain this code". Hidden; shown on hover or keyboard focus (fade + 4 px rise, 200 ms, block tinted `--paper-2`); on touch, hidden until the block is tapped. |
| Selection toolbar | Five swatches, Underline, Ask Steve, Note. Appears 8 px above the selection (fade + rise, 200 ms); picking a colour closes it. |
| Highlight, underline, selection | `.hl-<colour>` behind ink; underline 2 px accent, offset 4 px; live selection in `--accent-soft`. Hover or focus on a highlight shows the **Ask Steve chip** above its end. |
| Margin marker | 26 px circle with the note count, in the outer margin (44 px out); accent border on hover; 35 % opacity in focus mode; 22 px at the right edge on mobile. Opens Notes. |
| Study panel | 380 px right panel, tabs **Steve** and **Notes (count)**, close button; slides in (24 px, 400 ms). Under 760 px: pull-up sheet, 64 % high, radius 18, grab handle, rises 600 ms. Hidden in focus mode. |
| Steve: consent | "Before Steve reads along": sends the passage and nearby pages to Google's Gemini; notes and highlights stay unless added; turn off any time in Settings, for one book or all. "Turn on Steve" / "Not now"; link "Use your own Gemini key". |
| Steve: empty | "Ask Steve about these pages", "He's read §4.2 and the pages around it."; four suggestion buttons (Lora); tip to select a sentence. |
| Steve: answer | Question bubble (prefix + quoted passage); "Steve · from pages 44–45"; answer in Lora 15 px built block by block (one block per 700 ms) with a blinking caret, "Steve is writing…" and **Stop**; citation chips "p. 44" that jump to the page; display math and code blocks; then "Add to notes" (becomes "Added to notes", disabled) and "Copy". |
| Steve: paused | Lamp illustration, "Steve is resting until tomorrow", "You've used today's shared questions. They come back at midnight, your time." "Use your own key" / "Keep reading". Sheet note: "No countdowns, no upsell." |
| Steve: own key | Back to Steve; "Use your own Gemini key"; masked key field; link to Google AI Studio; "Save key" and "Test it"; "Kept on this device only. Remove it any time."; switch "Send book text to Gemini" ("Off turns Steve off for every book"). |
| Steve composer | Placeholders: "Ask about these pages…", "Turn on Steve to ask" (disabled), "Steve is back tomorrow" (disabled); also disabled when the Gemini switch is off. Fine print "Answers by Gemini · book text leaves this device · Settings". |
| Note card | Reference button (bookmark icon, "p. 45 · Figure 4.2") and kind label: **Text** (Lora 15 px), **Equation** (rendered + LaTeX source in mono), **Drawing** (sketch on `--surface` with a pen/box/arrow/text tool strip; the sheet labels it "Drawing · Excalidraw"), **Code**. New note: accent border, rises 600 ms. List header "Chapter 4 · N notes / Newest last". |
| Add bar | Dashed pills: Text, Drawing, Equation, Code. |
| Focus bar | Stopwatch pill running ("0:52:14", breathing accent dot) or locked (lock, "0:00:00 · starts at Chapter 1", opens a popover). "Focus · notes, Steve and badges are tucked away". **Pause focus**, **End session**. |
| Session notice | Top-centre card: "15 minutes left in this session", "Sessions stop at three hours so the reading stays fresh." plus a suggested stopping point; OK. |
| Ribbon bookmark | Resting: 18 x 120 accent ribbon at the page top. Placing: 22 x 150 draggable ribbon with two 10 px nudges, hint bar "Drag the ribbon to the page where you stopped.", a "Set ribbon on p. N" button on each page; keyboard: arrows choose a page, Enter sets it. |
| Ready modal | Scrim; "Ribbon set on p. 45", "Ready for your questions?", "Three short questions on what you read tonight, about four minutes."; points preview; "Not now, keep my place" / "Start questions". |
| Quiz | Eyebrow "§4.2 · from the pages you just read", progress dots (current scaled 1.4), "Question 2 of 3", Lora 25 px question, option cards A–D (radio; selected = accent border and soft fill, settle bounce); "Save and finish later" / "Next" → "See results". No Steve. |
| Results | Big Playfair "+92 XP" counting up (800 ms, after 300 ms); one-line verdict; points table rows rising 60 ms apart; "See your league" / "Back to the book". Low variant: "0 XP", dashed "Why no points this time" box, "Go over §4.2 with Steve". |
| Progress | "Your reading, lately": Level panel (XP bar grows 800 ms), daily goal ring in minutes, candle streak (flickering flame) with streak-freeze bell jars (saved / used), **badge shelf**: wax seals (habits) and bookplates (books, league), earned or locked (dashed, 45 %). Earning stamps in once (scale 1.25 → 1, slight turn, 600 ms). |
| League | Tier chips (done, current, next dashed, later); standings rows (rank, initials, name, XP), "you" row tinted with "↑ up 3" and a rise-in; promotion and demotion zone rows; "· · ·" gap; promotion banner (seal stamps in); "How leagues work" panel. |
| Celebration | Full page: soft glow, 160 px seal stamping in, "Welcome to Folio" in Playfair italic, tier chips, "Back to my shelf". "No confetti, no sound." |
| App bar | Brand, nav Library / Dashboard / League (accent underline), "Level 7" mini XP bar, theme toggle. |
| Toast | Ink background, check icon, dismiss; auto-hides after 5 s; bottom left. |

## Screen notes

- **11–12 Original view.** PDF: two-page spread at 100 %, eq. (4.4)
  affordances showing, margin markers beside noted passages, ribbon on
  p. 45. EPUB: same pages in the EPUB style, figure and code affordances
  showing. Mobile: one page, toolbar scrolls, panel as a sheet.
- **13–17 Steve.** All in the right panel over the PDF spread; a honey
  highlight on the asked passage (13, 15). 15 cites pp. 44–45 and mixes
  prose, an orthogonality formula and a Python snippet.
- **18 Highlight.** Honey and sky highlights, one underline, the Ask Steve
  chip on a highlight and the selection toolbar over a live selection.
- **19 Notes.** Notes tab with five notes (text, equation, drawing, code,
  the new one from Steve), markers on the spread.
- **20–22 Focus.** 20: front matter, locked stopwatch with its popover.
  21: 2:45:03 with the 15-minute notice. 22: ribbon set on p. 45 and the
  ready modal over the reader.
- **23–25 Quiz and results.** 23: question 2 of 3, option C selected.
  24: +92 XP (52 focused, +30 quiz, +10 ribbon). 25: 1 of 3, 0 XP.
- **26–28 Gamification.** 26: Level 7, 1,240 of 1,500 XP, goal 30 of 45
  minutes, 13 evenings, 2 freezes, 4 of 6 badges. 27: Hardcover league,
  you 4th, "up 3". 28: promotion to Folio.
- **Imagery.** No photos. Line illustrations in the phase-1 style (lamp
  for "paused"), SVG wax seals and bookplates, candle and bell jars, a
  generated Fourier figure. Grain overlay on every screen.

## Mapping to chunks

The CD2.2 prompt lists C17 original view, C20 Steve, C21 annotations,
C22 notepad, C23 focus mode, C24 gamification. `docs/PROGRESS.md` (C16.4)
numbers them differently: C18 region map, C19 anchors and highlights,
C20 notepad, C21 Steve backend, C22 Steve in the reader. This table
follows `docs/PROGRESS.md`; [question 1](#questions) asks which is right.
The PROGRESS.md column uses the numbers after the C19 renumbering
(2026-11-13: C19 became converted sources, so the stubs C19-C25 moved to
C20-C26); the paragraph above and the questions keep the old numbers.

| Screens / components | Chunk (PROGRESS.md) | Prompt's chunk |
|---|---|---|
| 11, 12; reader toolbar, spread, front matter, page flash | C17 original view | C17 |
| Block affordances (which block allows what) | C18 region map (affordance UI with C20/C23) | not listed |
| 18; selection toolbar, highlight/underline styles, `--hl-*` | C20 anchors, highlights and underlines | C21 |
| 19; note cards, add bar, margin markers, study panel Notes tab | C21 notepad | C22 |
| Consent record, own-key storage, quota behind 16 | C22 Steve backend | C20 |
| 13–17; Steve panel states, composer, Ask Steve chip, citations | C23 Steve in the reader | C20 |
| 20–23; focus bar, notice, ribbon, ready modal, quiz | C24 focus mode | C23 |
| 24–28; results points, progress, badges, league, celebration, app bar | C25 XP, streaks, badges and leagues | C24 |

## Gaps and conflicts

Conflicts with the project's rules and specs (the specs win until decided):

1. **Own key storage.** The design says "Kept on this device only"; CLAUDE.md
   says readers' keys are stored encrypted on our server, never returned in
   full, and C23 shows the last 4 only. The design shows a masked full key
   and no "remove" control despite "Remove it any time".
2. **Points.** Design: 1 XP per focused minute, up to 180; quiz bonus +30
   for 2 of 3 ("grows with your score"); +10 "Finished with the ribbon".
   FOCUS_RULES: 10 points per minute (F4), 20 per correct answer (F11), no
   ribbon bonus. The 40 % pass mark matches F12.
3. **Streak credit after a failed quiz.** Design: "Your 52 minutes still
   count toward your streak". GAMIFICATION G7 counts a day only when the
   daily goal, in XP, is met; a 0-point session earns no XP.
4. **Daily goal unit.** Design: minutes ("30 of 45 minutes", "set by the
   reader"); G5: XP, default 50, range 10–500.
5. **Badges.** Design shows six (Seven evenings, First book finished,
   Good questions = asked Steve 30 times, Fifty margin notes, A hundred
   evenings, A week in Folio); GAMIFICATION lists 14 others, overlapping
   only on 7-day and 100-day streaks and finishing a book. Which catalogue
   badges are seals and which are bookplates is not specified.
6. **Leagues.** Design: 20 readers, top 5 up, bottom 5 down, week ends
   Sunday 20:00. G11–G13: about 30, top 7 up, bottom 5 down, Monday 00:00
   UTC. The leaderboard opt-out (G14) and the opted-out results screen are
   not designed.
7. **Quiz length and deferral.** Design: always three questions, "about
   four minutes", with "Save and finish later" and "Not now, keep my
   place". F10: `clamp(round(words / 400), 3, 15)`; deferring the quiz is
   not in FOCUS_RULES.
8. **Reading view.** The toolbar keeps "Reading view" ("reflows the text,
   as in the phase 1 reader"); CLAUDE.md and C17 retire the book view.
9. **Notes order.** Design: "Newest last", scoped to a chapter; C21:
   reading order by the sortable position (ANCHORS A4).
10. **Steve's reset time.** "Back at midnight, your time"; the free tier's
    daily limit resets at midnight Pacific (C16.4) and the per-reader
    limit's reset is not specified.
11. **Monospace font.** JetBrains Mono is new; phase 1 dropped DM Mono for
    system monospace (tokens.css A15) and D6 bundles fonts. Caveat and
    JetBrains Mono load from Google Fonts in the mock.
12. **Contrast.** `--ink-3` on `--accent-soft` (league rank in the "you"
    row) is 4.19/4.29 on Paper, against rule A2. Paper swatch dots are
    1.89–2.72 against `--surface` (below 3:1). The key field uses
    `--line-2` (1.50 / 1.73) where the app uses `--line-field` (A1).

Not specified in the design:

13. Focus-mode rules without UI: the idle prompt "Still with the book?"
    (F6), hidden-tab pause (F5), page cap (F7), what happens at 3:00 (F8
    starts the quiz), correcting a wrong body start (FOCUS_RULES question 3),
    "Quiz me" outside focus mode (F13).
14. Steve: the per-book off switch the consent copy promises (only a
    global switch is drawn); the Settings page the fine print links to;
    errors (Gemini 503, timeouts, 429 circuit breaker, offline); a
    question about text the book does not cover; whether "Explain this
    figure" sends the image (`GEMINI_MODEL_VISION`); what "Test it" does
    (in the mock it equals Save).
15. Annotations: editing, recolouring or deleting a highlight; orphaned
    anchors (C20); affordances for tables (region type in C18); where
    "Copy as LaTeX" gets LaTeX for a PDF equation.
16. Notes: the text, equation and drawing editors (only finished cards and
    the tool strip are drawn); editing and deleting notes.
17. Original view: real PDF pages (the mock sets the text in Lora; a PDF
    keeps its own type); whether an EPUB keeps its own CSS or takes Lora;
    zoom beyond 90–120 %, fit to width, page thumbnails; how a book opens
    from the library (the mock's Library button shows a toast).
18. Gamification: notifications (G15); the daily-goal and opt-out
    settings; whether Progress replaces the phase-1 dashboard (nav says
    "Dashboard", the page says "Your reading, lately"); frozen days in the
    streak (G8).
19. Sage accent: no screen is rendered with it.

Visible in the images (mock defects, not intent): at 375 px the reader
toolbar shows a horizontal scrollbar and clips its last buttons, page
text runs past the right edge, and the selection toolbar runs off screen
(`highlight-paper-375.png`); on desktop the locked-stopwatch popover
covers the Preface heading (`focus-locked-paper-1440.png`).

## Questions

1. Chunk numbers: the prompt's list (C20 Steve, C21 annotations, C22
   notepad) or `docs/PROGRESS.md` (C19 highlights, C20 notepad, C21–C22
   Steve)?
2. Own key: server-side encrypted with last 4 shown (CLAUDE.md), so the
   copy changes, or something else?
3. Points, pass mark and streak credit: FOCUS_RULES and GAMIFICATION
   numbers, or the design's (1 per minute, +30, +10 ribbon, minutes goal)?
4. Leagues: 30 / top 7 / Monday UTC (spec) or 20 / top 5 / Sunday 20:00?
5. Badges: the spec's 14, the design's 6, or a merge?
6. Keep a "Reading view" toggle in the original view, or remove it?
7. Notes: reading order or newest last; whole book or per chapter?
8. Quiz: fixed three questions or F10's clamp; may the quiz be deferred?
9. Fonts: bundle Caveat and JetBrains Mono (`@fontsource`), or system
   fallbacks?
