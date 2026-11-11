# Design audit (C10.1)

Audit of the current frontend and of the Claude Design handoff, written
2026-11-11 at the start of C10 on `chunk/C10-design-system`, before any
C10 code. It feeds C10.2–C10.6 and the screen chunks C11–C13.

Order of authority when they disagree: **accessibility > handoff
(`design/HANDOFF_SUMMARY.md`, decisions D1–D6) > fallback direction >
skill suggestions.**

## How it was run

- **App:** backend and Vite from `.claude/launch.json`, signed in as dev
  test user A. A fixture book (`sample.pdf`, "Audit sample") was uploaded
  through the API, then the full flow was walked once: library,
  calibration, reading, test (5 answers), results, dashboard. Each page
  was checked at 1440 x 900 and 375 x 812. Login was judged signed out,
  before the flow.
- **impeccable critique**, two isolated assessments as the skill requires:
  A, a design review (heuristics, cognitive load, personas); B, the
  detector (`impeccable detect --json frontend/src`) plus the live
  overlay injected on Library, Dashboard and Results, and an in-page
  contrast and accessible-name check.
- **ui-ux-pro-max:** the design-system query and the UX guideline search
  (labels, focus, contrast, reduced motion), used as a checklist.
- **Handoff:** every token pair recomputed for contrast (below), and the
  handoff read for consistency and missing states.

Claims in A's review that were checked again by hand: `--red-mid` is used
in `Library.jsx:198,216,231` and defined nowhere; `Layout.css:125-127`
hides the nav links under 640 px with no replacement; `Library.jsx:220`
always prints "Ch. 1 of N"; `outline: none` in `Login.css:126`,
`ComprehensionTest.css:223` and `Modal.css:25`; `Results.jsx` has no
heading element; the two modals have fixed inline widths (440 and 400 px).

## Current UI

**Verdict.** Heuristic score 19/40 (Poor band). The palette and the reading
column (Lora 19/1.85, 640 px, drop cap) are a real attempt at the brief;
everything around them is category-generic: an upload zone over a card
list, stat tiles over a line chart, a split-screen quote login, and an
ink-black exam bar with a monospace countdown on the test. There is no
dusk theme, no book object (cover, spine, title on the reading page), and
amber is spent on links, buttons, chart lines, scores, verdicts and the
drag state, so it is not a single muted accent.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Reading opens on a blank screen (`.page` at opacity 0 while loading); Library's load error is set but never rendered |
| 2 | Match with the real world | 2 | "Session d9012d · ? words", "chunks", "FACTUAL", "14.3% complete"; no book title on the reading page |
| 3 | User control and freedom | 2 | Reading's back arrow skips the abandon confirmation; distraction-free mode hides Pause and Done |
| 4 | Consistency and standards | 2 | 720 vs 840 px containers, three focus treatments, three score colourings, inline styles beside CSS files |
| 5 | Error prevention | 2 | Multiple-choice options printed in the question, answered in a free-text box; `alert`/`window.confirm` |
| 6 | Recognition over recall | 2 | "Start next session" names no book or section; dashboard quotes have no question |
| 7 | Flexibility and efficiency | 2 | No shortcuts; timer started by hand; dashboard book cards look clickable and are not |
| 8 | Aesthetic and minimalist design | 3 | Calm overall; a one-point chart fills the fold, about 145 px of chrome above the text on mobile |
| 9 | Error recovery | 1 | Failures go to `alert()` (10 places), raw `err.message`, or a silent redirect (`Results.jsx:65,69`) |
| 10 | Help and documentation | 1 | Nothing explains pacing, the timer or the score |

### Detector and overlay

- `impeccable detect`: 2 findings, both `side-tab` (a thick coloured left
  border as an accent): `Dashboard.css:209`, `Results.css:190`.
- Overlay: low contrast on every page checked (Library 4 pairs, Dashboard
  4, Results 4), line length about 95 to 100 characters in the results
  feedback, 10 em dashes on Results (mostly generated feedback, not UI
  copy), and `cream-palette` on every page. **`cream-palette` is a false
  positive here:** warm paper is the brief.
- No `prefers-reduced-motion` rule in any stylesheet; 15 elements on
  Results animate or transition.
- Fonts come from `fonts.googleapis.com` (`index.html:8-10`); DM Mono and
  Lora are requested on pages that never use them. Body is DM Sans 300.

### Issues, ranked

Severity: P0 blocks a task, P1 major, P2 minor, P3 polish. "Fix in" is
the subchunk or chunk that owns it; C10 changes no behaviour, so content
and flow issues go to the screen chunks.

| # | Sev | Issue | Evidence | Fix in |
|---|---|---|---|---|
| U1 | P0 | Muted text fails AA everywhere: `--ink-faint` `#9a918a` is 2.92:1 on paper, 2.62:1 on `--paper-dark` (subtitles, meta, labels, nav email, Sign out, "/ 50") | `index.css:5`; overlay and JS check, 18 elements on two pages | C10.2b (alias to `--ink-3`, 4.93:1) |
| U2 | P0 | Amber as text is 2.94:1 ("Continue", "or click to browse", "Start next session →", "Needs review", "6 / 10"); white on the amber button 3.12:1 | `index.css:9`, `Button.css:57-60` | C10.2b (alias to `--accent`, 5.37:1), C10.5a (`--accent-ink` on fills, D1) |
| U3 | P0 | No navigation at 375: Library and Dashboard links are hidden with no replacement | `Layout.css:125-127` | C10.6 (the nav is edited there for the toggle); full redesign C11 |
| U4 | P0 | Dashboard scrolls sideways at 375 (scrollWidth 385), a stat label is clipped | `Dashboard.css:53-58` plus nested padding | C13 |
| U5 | P1 | Modals are wider than a phone (440 and 400 px inline) | `Library.jsx:243`, `ReadingSession.jsx:257` | C10.5c |
| U6 | P1 | Form fields have no accessible name: login labels lack `htmlFor` (`Login.jsx:95,107,118`), upload modal labels (`Library.jsx:249,258`), test textarea has a placeholder only (`ComprehensionTest.jsx:221`) | a11y tree: unnamed textboxes | C10.5b components; adopted in C11, C12 |
| U7 | P1 | Icon buttons without a name: reading back arrow (`ReadingSession.jsx:175`), test back arrow (`ComprehensionTest.jsx:161`), Delete (title only, 24 x 24 px, `Library.jsx:227`) | a11y tree | C11, C12 (IconButton in C10.5a) |
| U8 | P1 | `Modal` has no `role="dialog"`, `aria-modal`, label, focus trap or focus return | `Modal.jsx` | C10.5c |
| U9 | P1 | Focus on inputs is a border-colour change only (`outline: none`); three different focus styles in all | `Login.css:126`, `ComprehensionTest.css:223`, `Modal.css:25` | C10.3 (one ring), C10.5b |
| U10 | P1 | No reduced-motion handling (infinite sweeps, score count-up, page fades) | grep; overlay | C10.4 |
| U11 | P1 | Results has no headings; every route's title is "ReadFocus" | DOM; `index.html:7` | C13; titles per screen in C11–C13 |
| U12 | P1 | Reading shows a session id and "? words" instead of the book and section; drop cap lands on PDF running-header text; broken hyphenation ("opera- tions") | `ReadingSession.jsx:176-180`, `157-162` | C12 (display); text cleaning is backend, outside C10 |
| U13 | P1 | Multiple-choice options are inline text answered in a free-text box; "couldn't judge" scored 0/10; metadata words ("licensee mdpi") in questions | test and results pages | C12 (option cards), backend question quality (outside C10) |
| U14 | P1 | Library always shows "Ch. 1 of N" | `Library.jsx:220` | C11 |
| U15 | P2 | Errors through `alert()`/`window.confirm` (10 places); raw `err.message` on Dashboard; Results redirects on failure without a word | `Library.jsx:45,51,100,117,144`, `ReadingSession.jsx:67,128`, `ComprehensionTest.jsx:41,46,96` | Toast in C10.5c; adopted in C11–C13 |
| U16 | P2 | `--red-mid` used but never defined, so failed uploads show no error colour | `Library.jsx:198,216,231` | C10.2b (alias to `--warn`) |
| U17 | P2 | Primary actions styled as secondary: "Done reading" equals Pause; "Start next session" is a text link | `ReadingSession.jsx:215`, `Results.jsx:176` | C12, C13 |
| U18 | P2 | Test and reading chrome reads as an exam: black bar, large mono countdown, black timer pill | test and reading screenshots | C12 |
| U19 | P2 | Containers disagree (720 px layout, 840 px dashboard with its own padding) | `Dashboard.css:9-13`, `Layout.css` | C13 |
| U20 | P2 | Side-tab accent borders | `Dashboard.css:209`, `Results.css:190` | C13 (handoff quote block on `--paper-2`) |
| U21 | P2 | Dashboard book cards hover like links but are not; chart has no text alternative | `Dashboard.css:132-134`, `Dashboard.jsx:58-108` | C13 |
| U22 | P2 | Abandon modal puts the destructive button first with punitive copy | `ReadingSession.jsx:257-264` | C12 |
| U23 | P3 | Body text is DM Sans 300 (thin on paper); long questions set in Playfair | `index.css:35`, test page | C10.3, C12 |
| U24 | P3 | Small copy faults: "Sign In" vs "Sign in", "C10.1 ·" trailing dot, "14.3%", straight quotes around answers, capital "Continuing" mid-sentence | `Login.jsx:81,136`, `Library.jsx:206`, `Dashboard.jsx:40`, `Results.jsx:160`, `ReadingSession.jsx:228` | C11–C13 |
| U25 | P3 | Calibration flow: "I am done reading" is a `div`, not a button | a11y tree (`generic`) | C12 |

Strengths to keep: the reading column's type and measure; one warm,
restrained palette family; kind copy in places ("Revisiting difficult
material is how mastery is built") and written empty states.

## Handoff issues

Every text and boundary pair in the handoff tokens was recomputed with the
WCAG 2.x formula, for all four theme x accent combinations (scratchpad
script `handoff_contrast.py`; the C10.2a contrast check will make this a
repo script).

### Contrast

What passes, everywhere: `--ink`, `--ink-2`, `--accent-text`, `--accent`
and `--warn` as text on every ground (`--paper`, `--paper-2`, `--surface`,
`--page`, `--accent-soft`, `--warn-soft`); `--accent-ink` on `--accent`
(5.65, 5.90, 7.63, 8.94, as D1 records); the five cover colours under cream
(5.41 to 12.44); a 2 px `--accent` focus ring against `--paper` and
`--surface` (5.37 to 8.94, need 3:1).

| # | Pair | Ratio | Needs | Where it would show |
|---|---|---|---|---|
| H1 | `--line-2` on `--surface` / `--paper` | 1.58 / 1.50 (Paper), 1.60 / 1.73 (Lamplight) | 3:1 (WCAG 1.4.11, input boundary) | Text inputs, text area and secondary button borders are drawn in `--line-2`; an empty input has no other visible edge |
| H2 | `--line` on `--surface` | 1.31 / 1.25 | 3:1 only where the line is the only cue | Surfaces' hairlines: decorative, allowed; but the "To revisit" chip's dashed border and the mastery-bar track are information |
| H3 | `--ink-3` on `--accent-soft` | 4.19 (Paper terracotta), 4.29 (Paper sage) | 4.5:1 | Captions inside the selected option card, accent-wash chips, today's-reading card |
| H4 | `--ink-3` on `--warn-soft` | 4.39 (Paper), 4.44 (Lamplight) | 4.5:1 | Secondary text in the warning toast and the timer pill |
| H5 | Links hard-coded `#A64B2A`, hover `#7E3820` | 3.05 and 2.06 on Lamplight `--paper` | 4.5:1 | Every link in Lamplight (gap 8) |
| H6 | Primary button labels in dark ink on terracotta (screens) | 2.67 | 4.5:1 | Already resolved by D1 |

### Consistency

| # | Issue | Evidence |
|---|---|---|
| H7 | Radii off the scale: 4 px book page, 16 px panels, 2 px bars | Foundations artboard (gap 7) |
| H8 | Two type sizes used but not in the scale: page title 64/1.05, section heading 34/1.15 | Foundations artboard |
| H9 | Two uppercase tracking values for near-identical roles: eyebrow +12 %, running head +16 % | Type table |
| H10 | Easing and duration names differ between table and CSS, timings off the scale | Resolved by D3 |
| H11 | Shadow values for covers, cards, word card, toast and modal not given | Gap 14 |
| H12 | Hover colours are words, not values ("primary darker", "border darkens") | Component inventory |
| H13 | No breakpoints between 375 and 1440 | Gap 14; the current CSS uses 639, 767 and 1024 px |

### Missing states

| # | Component or screen | Missing |
|---|---|---|
| H14 | Button, option card, chip, tabs | Focus-visible drawn only once (the 2 px ring rule); disabled colours not given; no pressed state for option cards |
| H15 | Text input | Disabled and read-only; error state in Lamplight not drawn |
| H16 | Dashboard | No empty state (new reader, no sessions) and no loading state |
| H17 | Results | No loading state ("Grading…" exists only as a button label); no state for a test with zero questions |
| H18 | Reading | No loading state for the page, no end-of-today state, no error state |
| H19 | Test | No timer-expired state, no "submitting" state beyond the button, no state for a question that failed to load |
| H20 | Calibration (first reading session) | Not designed at all; it exists in the app (`CalibrationFlow.jsx`) |
| H21 | Toasts | Lamplight values for the "light" toast not given; stacking of several toasts not given |
| H22 | Long content | Long book titles and author names on covers and in the toolbar; 3-digit page counts in the folio; very long answers in results |
| H23 | Sign in | Create-account form, forgot-password flow and their errors not drawn |

### Skill suggestion not taken

`ui-ux-pro-max --design-system` for "reading app book calm warm dark mode"
proposed cyan `#0891B2` with Lora + Raleway and an app-store landing
pattern. It conflicts with the handoff (paper, ink, terracotta or sage;
Playfair, Lora, DM Sans) and is not used. Its UX checklist (labels, focus,
4.5:1, reduced motion, 44 px targets, 375 to 1440) is used below.

## Decisions

These resolve the issues above. A1–A3 change handoff values for
accessibility; the rest fill gaps the handoff leaves open. D1–D6 in
`design/HANDOFF_SUMMARY.md` still hold.

| # | Decision | Resolves | Lands in |
|---|---|---|---|
| A1 | New token `--line-field` for every boundary that is the only cue (input, text area, secondary button border, "To revisit" dashed chip, mastery-bar track): Paper `#8F8273` (3.69 on `--surface`, 3.50 on `--paper`, 3.22 on `--paper-2`), Lamplight `#7A6E60` (3.25, 3.52, 3.72). `--line` and `--line-2` stay for decorative hairlines. | H1, H2 | C10.2a |
| A2 | `--ink-3` is never set on `--accent-soft` or `--warn-soft`; text on a wash uses `--ink-2` (5.97 or more). The contrast check fails on that pair. | H3, H4 | C10.2a |
| A3 | Links use `--accent-text` in both themes, hover adds an underline instead of a darker hex. | H5 | C10.3 |
| A4 | Old names become aliases of the new tokens: `--ink-light` → `--ink-2`, `--ink-faint` → `--ink-3`, `--paper-dark` → `--paper-2`, `--paper-mid` → `--line-2`, `--amber` → `--accent`, `--amber-pale` → `--accent-soft`, `--red-soft` and the undefined `--red-mid` → `--warn`, `--green-soft` → `--accent-text`. Every page passes AA and follows the theme without edits; aliases are removed after C13. | U1, U2, U16 | C10.2b |
| A5 | Radii added to the scale: `--radius-page` 4 px, `--radius-panel` 16 px, `--radius-hair` 2 px. | H7 | C10.2a |
| A6 | Type roles added: `--text-title` 64/1.05 and `--text-section` 34/1.15 (Playfair 500). Eyebrow (+12 %) and running head (+16 %) keep their tracking as two named tokens. | H8, H9 | C10.3 |
| A7 | Shadows defined, two levels only, as the handoff says shadows are rare: `--shadow-page` (the handoff's `0 24px 48px -32px rgba(40,25,10,.35)`, glow in Lamplight) and `--shadow-lift` for cover, word card, toast and modal (soft, low, values set and checked by eye in C10.2a). | H11 | C10.2a |
| A8 | Hover values: primary `color-mix(in oklab, var(--accent) 88%, var(--ink))`, secondary border `--line-field` → `--ink-3`, ghost fill `--paper-2`. Each hover pair goes through the contrast check. | H12 | C10.2a, C10.5a |
| A9 | Two breakpoints: 640 px and 1024 px (Tailwind `sm`, `lg`). New CSS uses only these; the old 639/767 px queries go when their pages are rebuilt. | H13 | C10.2b |
| A10 | One focus ring everywhere: 2 px `--accent`, 3 px offset, on `:focus-visible`; no `outline: none` without it. | U9, H14 | C10.3 |
| A11 | Global reduced-motion rule (animations and transitions near-instant, loops stopped) and `MotionConfig reducedMotion="user"`. | U10 | C10.4 |
| A12 | Every C10 component ships default, hover, focus-visible, disabled, and where it applies loading and error, in both themes; the gallery shows them all. Screen-level missing states (H16–H23) are designed in the chunk that builds the screen, in the handoff's voice. | H14, H15 | C10.5a–d; C11–C13 |
| A13 | Modal panel width is `min(<width>, 100vw - 32px)`; the two inline widths become `maxWidth`. | U5 | C10.5c |
| A14 | Nav links stay visible at 375 (smaller, wrapped under the wordmark) until the C11 top-nav redesign. | U3 | C10.6 |
| A15 | Body text DM Sans 400; DM Mono dropped (`--font-mono` → `ui-monospace, Menlo, monospace`), as agreed at plan time. | U23 | C10.3 |
| A16 | Rejected: the `ui-ux-pro-max` palette and fonts (cyan, Raleway), and the detector's `cream-palette` warning. | | |

## Handoff → code mapping

### Tokens

All in `frontend/src/styles/tokens.css` (C10.2a) on
`:root[data-theme][data-accent]`, mapped to Tailwind with `@theme inline`
in `frontend/src/index.css` (C10.2b).

| Handoff | CSS variable | Tailwind | Notes |
|---|---|---|---|
| Neutrals: paper, paper-2, surface, page, ink, ink-2, ink-3, line, line-2 | `--paper` … `--line-2` | `bg-paper`, `bg-surface`, `text-ink-2`, `border-line` … | `data-theme="paper"` / `"lamplight"` |
| (new) field boundary | `--line-field` | `border-line-field` | A1 |
| warn, warn-soft | `--warn`, `--warn-soft` | `text-warn`, `bg-warn-soft` | |
| accent, accent-ink, accent-soft, accent-text, glow | `--accent` … `--glow` | `bg-accent`, `text-accent-ink`, `text-accent-text` … | `data-accent="terracotta"` / `"sage"` |
| Cover colours (5) and cream | `--cover-moss` … `--cover-slate`, `--cover-title` | `bg-cover-moss` … | D5 |
| Spacing 4 … 96 | `--space-1` … `--space-9` | Tailwind spacing scale left as is; tokens for CSS files | |
| Radii 3, 6, 8, 10, 12, 14, 999 (+ 2, 4, 16) | `--radius-cover`, `-skeleton`, `-input`, `-control`, `-card`, `-surface`, `-pill`, `-hair`, `-page`, `-panel` | `rounded-control` … | A5 |
| Shadows | `--shadow-page`, `--shadow-lift` | `shadow-page`, `shadow-lift` | A7 |
| Type roles | `--text-display` … `--text-folio`, `--font-display`, `--font-reading`, `--font-ui`, `--font-mono` | `text-display`, `font-reading` … | C10.3, A6 |
| Durations 150 … 800 | `--dur-1` … `--dur-6` | `duration-1` … `duration-6` | D3 |
| Easings | `--ease-settle`, `--ease-arrive`, `--ease-breathe` | `ease-settle` … | D3; mirrored in `src/lib/motion.js` (C10.4) |

### Old tokens

| Old (`index.css`) | Becomes | Contrast on paper, old → new |
|---|---|---|
| `--ink` `#1a1714` | `--ink` | 16.83 → 14.33 |
| `--ink-light` `#4a4540` | `--ink-2` | 8.93 → 7.04 |
| `--ink-faint` `#9a918a` | `--ink-3` | 2.92 → 4.93 |
| `--paper` `#faf8f4` | `--paper` | ground |
| `--paper-dark` `#f0ece4` | `--paper-2` | ground |
| `--paper-mid` `#e8e2d8` | `--line-2` | used for borders and fills |
| `--amber` `#c8832a` | `--accent` | 2.94 → 5.37 |
| `--amber-pale` `#f5e9d6` | `--accent-soft` | ground |
| `--red-soft` `#c0392b`, `--red-mid` (undefined) | `--warn` | 5.13 → 5.49 |
| `--green-soft` `#2d7a4f` | `--accent-text` | 4.94 → 6.04 |
| `--font-mono` DM Mono | `ui-monospace, Menlo, monospace` | A15 |

### Components

| Handoff component | Code | When |
|---|---|---|
| Button (primary, secondary, ghost) + danger, icon button | `components/ui/Button.jsx` | C10.5a |
| Raised / sunken surface | `components/ui/Card.jsx` | C10.5a |
| Text input, text area, segmented tabs | `components/ui/TextInput.jsx`, `TextArea.jsx`, `SegmentedTabs.jsx` | C10.5b |
| Modal, toast, skeleton | `components/ui/Modal.jsx`, `Toast.jsx`, `Skeleton.jsx` | C10.5c |
| Chip, score badge, mastery bar, progress ring | `components/ui/Chip.jsx`, `ScoreBadge.jsx`, `MasteryBar.jsx`, `ProgressRing.jsx` | C10.5d |
| Theme toggle | `components/ThemeToggle.jsx`, `theme/ThemeProvider.jsx` | C10.6 |
| Top nav, account menu (D4) | `components/Layout.jsx` | C11 |
| Book cover (D5), drop zone, illustrations, empty and loading library, warming up, error screen | new under `components/` and `pages/` | C11 |
| Reader toolbar, Contents (D4), ribbon (D2), page furniture, pacing bar, word card, option card, test chrome | new under `components/reader/`, `components/test/` | C12 |
| Stat row, line chart, mastery list, streak pill, tooltip, underline tabs | new under `components/dashboard/` | C13 |

### Screens

| Handoff screen | Page | Chunk |
|---|---|---|
| 01 Sign in | `pages/Login.jsx` | C11 |
| 02 Warming up | new | C11 |
| 03–05 Library (shelf, processing, toast, empty, loading) | `pages/Library.jsx` | C11 |
| 10 Error | new | C11 |
| 06 Reading, word card | `pages/ReadingSession.jsx` (+ `CalibrationFlow.jsx`, not designed: H20) | C12 |
| 07 Test | `pages/ComprehensionTest.jsx` | C12 |
| 08 Results | `pages/Results.jsx` | C13 |
| 09 Dashboard | `pages/Dashboard.jsx` | C13 |

### Planned in C10, changed by this audit

- C10.2a adds `--line-field`, three radii and two shadows (A1, A5, A7)
  and the wash rule in the contrast check (A2).
- C10.2b also aliases the undefined `--red-mid` (A4).
- C10.5c also makes the two modal widths responsive (A13).
- C10.6 also keeps the nav links visible at 375 (A14).
- `App.css` (unimported Vite template) is deleted in C10.2b, not here:
  this subchunk changes docs only.
