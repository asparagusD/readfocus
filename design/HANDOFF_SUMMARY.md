# Claude Design handoff: summary (CD.2, CD.3)

Two exports from Claude Design, both received 2026-11-11:

1. **CD.2** `Foundations — style guide-html.zip` (212,824 bytes): the
   foundations artboard as HTML, unpacked unchanged into
   [`handoff/foundations-style-guide/`](handoff/foundations-style-guide/)
   (SHA-256 of each file matched the archive after copying).
2. **CD.3** `ReadFocus-png.zip`: six PNG boards (Components, Desktop 1440
   screens 1–5 and 6–10, Foundations, Mobile 375, Prototype). The boards
   are 2 to 62 MB each, so they are **not** committed whole; each artboard
   was cropped out and saved under [`screens/`](screens/) (see
   [Screen images](#screen-images)).

The design files are reference only. The app rebuilds them as React
components with Tailwind v4 theme tokens and Motion (C10–C13); nothing in
`design/` is imported by the app.

## Decisions (2026-11-11, CD.4)

These six decisions **override anything the design files show**. Contrast
ratios below were recomputed with the WCAG formula.

### D1. Text on accent fills uses `--accent-ink`

Every text or icon on an accent fill uses `--accent-ink`, never `--ink`:
primary buttons, the theme-toggle knob, the selected option letter.

| Theme · accent | Text on fill | Contrast |
|---|---|---|
| Paper · terracotta | `#FFFDF9` on `#A64B2A` | 5.65:1 |
| Paper · sage | `#FFFDF9` on `#506A4A` | 5.90:1 |
| Lamplight · terracotta | `#1D1915` on `#E59A6C` | 7.63:1 |
| Lamplight · sage | `#1D1915` on `#A8C198` | 8.94:1 |

Dark ink `#2A2420` on terracotta (2.67:1, as the screens show) fails AA
and is not used.

### D2. The ribbon never covers text

- It hangs from the page's top edge inside the outer margin, outside the
  text area.
- The running header ends before the ribbon; it reserves that room, so a
  long chapter name truncates instead of running under it.
- On mobile it is shortened and stays in the outer margin; if it still
  cannot sit clear, it is hidden.

### D3. Motion tokens: the long names, durations on the scale

- Easings: `--ease-settle` `cubic-bezier(.22,.61,.36,1)`,
  `--ease-arrive` `cubic-bezier(.16,1,.3,1)`, `--ease-breathe`
  `cubic-bezier(.45,0,.55,1)`. The short names `--ease`, `--arrive`,
  `--breathe` are dropped.
- Durations snap to `--dur-1` 150, `--dur-2` 200, `--dur-3` 250,
  `--dur-4` 400, `--dur-5` 600, `--dur-6` 800 ms:

| Was | Now |
|---|---|
| Question slide 450 ms | 400 ms, `--dur-4` |
| Page turn 650, book arriving 650, library → reader 700 ms | 600 ms, `--dur-5` |
| Option settle 260, toast and modal 300 ms | 250 ms, `--dur-3` |
| Score count-up, chart draw, mastery bars 900 ms | 800 ms, `--dur-6` |

- Kept as they are: ambient loops (steam 3.2 s, candle 3.2 s, lamp
  brighten 6 s and breathe 4 s, lamp pulse 1.4 s, skeleton shimmer
  1.6 s), the 60 ms chip stagger, and behaviour delays that are not
  animations (380 ms hover before a word card, 450 ms long-press, 2.6 s
  toolbar fade-out delay, 5 s toast lifetime).
- Only transform and opacity animate. Under `prefers-reduced-motion`
  everything becomes near-instant and loops stop.

### D4. Account menu and reader Contents

- **Initials** are a `<button aria-haspopup="menu">` showing the user's
  real initials. It opens a small account menu: name and email (not
  clickable), Reading settings (default text size, daily session length,
  theme), Sign out. Esc and clicking outside close it; focus returns to
  the button.
- **Contents** opens a popover listing the book's chapters, from the EPUB
  table of contents (PDF outline, or detected headings as a fallback).
  Today's chapter carries a quiet "today" label. Picking a chapter jumps
  to its first page; if that is outside today's planned pages, a one-line
  note says "This is beyond today's reading" without blocking the jump.
  The toolbar stays visible while it is open. Esc or clicking outside
  closes it. On mobile it is a sheet.

### D5. Book covers: Open Library, else a deterministic typographic cover

- Try Open Library first: by ISBN from the file's metadata, otherwise a
  title + author search for an Open Library ID.
  `https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false`
  (`?default=false` makes a missing cover a 404 instead of a blank
  image). Cache the result per book.
- Show the typographic cover at once and cross-fade the real image in
  when it loads (250 ms). With no match or a failed image, the
  typographic cover stays for good.
- Typographic colour is deterministic: FNV-1a hash of title + author,
  modulo 5, into moss `#3F4B3B`, oxblood `#5C2F27`, ink `#2E2A27`, ochre
  `#7A5C2E`, slate `#38434A`. Title and author in `#F6EFE3` (5.41:1 on
  ochre, the lowest; 8.06, 9.72, 12.44 and 8.88 on the others). The chosen
  colour is saved on the book record so it never changes, even if the
  title is edited.

### D6. Fonts are bundled, not loaded from Google Fonts

- `@fontsource-variable/playfair-display`, `@fontsource-variable/lora`,
  `@fontsource-variable/dm-sans`, plus the italic styles for Playfair and
  Lora. `font-display: swap`. Preload Lora and DM Sans.
- Fallbacks: Playfair Display → `Georgia, serif`; Lora → `Georgia, serif`;
  DM Sans → `system-ui, sans-serif`. Both licences (OFL) allow bundling.

### What the decisions need outside the frontend

Found in the code on 2026-11-11; to be planned in the chunk that builds
each piece.

| Decision | Exists today | Needed |
|---|---|---|
| D4 account menu | `profiles.display_name`; email from Supabase Auth; pace (`focus_duration_minutes`) used by the planner | Somewhere to keep default text size, daily session length and theme (not specified: profile columns or browser storage) |
| D4 Contents | `backend/services/book_ingestor.py` splits EPUBs into chapter texts but stores no chapter list; PDFs have no outline handling | Store each book's chapters (title, first chunk) at ingestion (additive migration), an endpoint to read them, and a backfill for books already ingested |
| D5 covers | `books` has `title`, `author`; no ISBN, cover URL or colour columns | Additive migration for ISBN, Open Library result and the saved cover colour; ISBN read from EPUB/PDF metadata; Open Library is a free, keyless API not yet used in the repo, so it goes through the `free-intelligence` check. Where the lookup runs (backend at ingestion, or the browser) is not specified |
| D6 fonts | `frontend/index.html` loads DM Mono, DM Sans, Lora and Playfair Display from Google Fonts at runtime (preconnect + stylesheet) | Three `@fontsource-variable/*` packages (frontend dependencies only) and removal of the Google Fonts links. DM Mono is used today and is not in the design: whether it goes is not specified (the error screen's monospace line can use `ui-monospace`) |

## What the HTML bundle contains (CD.2)

| File | Size | What it is |
|---|---|---|
| `Main.dc.html` | 22,694 B | The foundations artboard, 1440 px wide. Tokens live in its `<helmet><style>` block and inline styles; lists (palettes, spacing, radii, motion moments) live in the `renderVals()` script at the bottom. |
| `README.md` | 907 B | Export note: treat as a reference mockup, replicate values, do not copy markup. |
| `support.js` | 46,105 B | Claude Design runtime (`dc-runtime`), generated. Not part of the design. |
| `vendor/react.js`, `vendor/react-dom.js` | 10,751 B, 131,835 B | React production builds used by the runtime. Not part of the design. |

## Screen images

44 files in `design/screens/`, each under 5 MB (35 MB in total).
Names are `<screen>-<theme>-<width>.png`.

| Set | Files | Pixel size | Source |
|---|---|---|---|
| Desktop | `<screen>-paper-1440.png`, `<screen>-lamplight-1440.png`, 10 screens each | 1440 x 900 (the 2x artboard scaled to 1x) | Desktop boards, artboards 2880 x 1800 |
| Mobile | `<screen>-paper-375.png`, `<screen>-lamplight-375.png`, 10 screens each | 750 x 1624 (kept at 2x so text stays legible) | Mobile board, artboards 750 x 1624 |
| Components | `components-paper-sheet.png`, `components-lamplight-sheet.png` | 2768 x 7672 (2x) | Components board, one panel each |
| Prototype | `prototype-sign-in-paper-1440.png` | 1440 x 900 | Prototype board: a single frame, the sign-in screen |
| Foundations | `foundations-paper-1440.png` | 1440 x 6538 | CD.2 render of `Main.dc.html` (the PNG board's foundations export is 3700 px tall at 1x and cuts off sections 04–05, so the CD.2 render is kept) |

Screens: `sign-in`, `warming-up`, `library-processing`, `library-empty`,
`library-loading`, `reading-word-card`, `test`, `results`, `dashboard`,
`error`.

Full-resolution boards stay outside git. The desktop artboards were cut at
2880 x 1800 from x = 128 (Paper) and x = 3168 (Lamplight), rows every
2080 px from y = 248; mobile at 750 x 1624 from x = 128 every 830 px,
rows at y = 296 (Paper) and y = 2216 (Lamplight).

## Design tokens

All values are copied from `Main.dc.html`. Contrast ratios are the design's
own figures ("against each theme's ground"); they were not re-measured here
except where a gap below says so.

### Colour: neutrals and status

| Token | Paper (light) | Lamplight (dark) | Role | Contrast P / L |
|---|---|---|---|---|
| `--paper` | `#FAF7F2` | `#1D1915` | Ground | |
| `--paper-2` | `#F3EDE3` | `#161310` | Sunken, skeletons | |
| `--surface` | `#FFFDF9` | `#25201B` | Raised surfaces | |
| `--page` | `#FBF8F2` | `#231E19` | Book page | |
| `--ink` | `#2A2420` | `#EEE5D5` | Text | 14.3:1 / 14.0:1 |
| `--ink-2` | `#5C534A` | `#C4B8A5` | Secondary text | 7.0:1 / 8.9:1 |
| `--ink-3` | `#756A5F` | `#A09481` | Captions, folios | 4.9:1 / 5.9:1 |
| `--line` | `#E6DED2` | `#383029` | Hairline | |
| `--line-2` | `#D6CBBB` | `#4A4037` | Strong hairline, inputs | |
| `--warn` | `#8C5A00` | `#E9B65E` | Timer last 30 s, input errors, warning toast | 5.5:1 / 9.4:1 |
| `--warn-soft` | `#F6E9CF` | `#3A2E1C` | Warn wash (timer pill, warning toast; seen on the components sheet) | |

### Colour: accents (theme class x accent class)

The accent is a **reader setting** (decided 2026-11-11); terracotta is the
default.

| Token | Paper · terracotta | Paper · sage | Lamplight · terracotta | Lamplight · sage |
|---|---|---|---|---|
| `--accent` | `#A64B2A` (5.4:1) | `#506A4A` (5.6:1) | `#E59A6C` (7.6:1) | `#A8C198` (8.9:1) |
| `--accent-ink` (text on accent) | `#FFFDF9` | `#FFFDF9` | `#1D1915` | `#1D1915` |
| `--accent-soft` (wash) | `#F3E2D7` | `#E3EADD` | `#3A271C` | `#26301F` |
| `--accent-text` (accent as text) | `#9A4526` | `#4A6244` | `#EDA77B` | `#B3CBA3` |
| `--glow` | `rgba(166,75,42,0)` (none) | `rgba(80,106,74,0)` (none) | `rgba(229,154,108,.28)` | `rgba(168,193,152,.24)` |

Theme classes are `.t-paper` / `.t-lamplight`; accent classes
`.a-terracotta` / `.a-sage`. Global links in the HTML: `a { color:
#A64B2A }`, `a:hover { color: #7E3820 }` (hard-coded, not themed).

### Colour: typographic book covers

Title colour `#F6EFE3` (cream) on:

| Name | Hex | Contrast with title |
|---|---|---|
| Moss | `#3F4B3B` | 8.1:1 |
| Oxblood | `#5C2F27` | 9.7:1 |
| Ink | `#2E2A27` | 12.4:1 |
| Ochre | `#7A5C2E` | 5.4:1 |
| Slate | `#38434A` | 8.9:1 |

### Type

Fonts (Google Fonts link in the artboard): Playfair Display (400, 500,
600, italic 400, 500), Lora (400, 500, 600, italic 400), DM Sans (opsz
9–40, 400, 500, 600). Fallbacks: `Georgia, serif` for both serifs,
`system-ui, sans-serif` for DM Sans; code uses `ui-monospace, Menlo,
monospace`.

| Role | Font, weight | Size / line height | Other |
|---|---|---|---|
| Display | Playfair Display 500 | 56 / 60 | letter-spacing −1% |
| Heading 1 | Playfair Display 500 | 44 / 48 | |
| Heading 2 | Playfair Display 500 | 28 / 36 | |
| Chapter title | Playfair Display italic 400 | 44 / 52 | |
| Reading | Lora 400 | 18 / 31 (1.72) | justified, `hyphens: auto`, 60–70 character measure; user sizes 16.5 / 18 / 19.5 |
| Question | Lora 500 | 26 / 36 | |
| Quote, small reading | Lora italic 400 | 15 / 24 | `--ink-2` |
| UI | DM Sans 500 | 15 / 20 | buttons use `500 15px/1` |
| Label | DM Sans 400–500 | 13 / 18 | |
| Eyebrow | DM Sans 600 | 12 / 16 | +12% tracking, uppercase, `--ink-3` |
| Figures | Playfair Display 500 | 40 | lining, tabular numerals |
| Drop cap | Playfair Display | 4.1em, line-height .82 | floated, `--accent-text`, padding 6 10 0 0 |
| Running head | DM Sans | 11 | +16% tracking, uppercase, `--ink-3` |
| Folio | Lora | Not specified | centred, "p. 13 of 212" (components sheet) |
| Error code | Monospace | Not specified | "Error 503 · request 7f3a-21c4" (error screen) |

Used on the foundations artboard but not listed as a type role: page title
64/1.05, section heading 34/1.15. Icons: "lucide-style 1.75 px icons"
(components sheet header).

### Spacing (`--space-*`)

4, 8, 12, 16, 24, 32, 48, 64, 96 px ("a 4-based scale that leans
generous"). Token names per step (for example `--space-1`): not specified.

### Radii (`--radius-*`)

| Value | Use |
|---|---|
| 3 px | Covers (cover swatches use `3px 6px 6px 3px`) |
| 6 px | Skeletons |
| 8 px | Inputs |
| 10 px | Buttons |
| 12 px | Options, cards |
| 14 px | Surfaces |
| 999 px | Chips, toggle |

Also used on the foundations artboard but not in the scale: 4 px (book
page), 16 px (panels), 2 px (pacing bar, spacing bars).

### Surfaces and shadows

"Surfaces separate with 1 px hairlines; the only real shadows sit under
book covers and the open book."

| Surface | Style |
|---|---|
| Raised | `--surface`, 1 px `--line`, radius 14 |
| Sunken | `--paper-2`, no line, radius 14 |
| Book page | `--page`, 1 px `--line`, radius 4, `box-shadow: 0 24px 48px -32px rgba(40,25,10,.35)` |
| Book page, Lamplight | `box-shadow: 0 0 60px -24px var(--glow)` |
| Primary button, Lamplight | `box-shadow: 0 0 24px var(--glow)` |
| Book cover, word card, toast, modal | Visible soft drop shadows on the boards; values not specified |

### Motion

"Only transform and opacity move." With `prefers-reduced-motion`,
"everything becomes an instant cross-fade and loops stop".

| Token | Value | Used for |
|---|---|---|
| `--dur-1` | 150 ms | Hover, press scale (0.98) |
| `--dur-2` | 200 ms | Focus ring, word card in, option settle |
| `--dur-3` | 250 ms | Theme toggle knob, toolbar, toast |
| `--dur-4` | 400 ms | Question slide, chip stagger (60 ms apart) |
| `--dur-5` | 600 ms | Page turn, book arrives, library → reading |
| `--dur-6` | 800 ms | Score count-up, chart draw, lamp pulse |

| Easing | Curve | Used for |
|---|---|---|
| `--ease-settle` | `cubic-bezier(.22,.61,.36,1)` | Default ease-out for UI |
| `--ease-arrive` | `cubic-bezier(.16,1,.3,1)` | Things arriving: books, questions, chips |
| `--ease-breathe` | `cubic-bezier(.45,0,.55,1)` | Slow loops only: steam, candle, lamp |

Signature moments (the prototype board in CD.3 holds one still frame, so
these remain text-only):

| # | Moment | Description (from the artboard) | Timing |
|---|---|---|---|
| 1 | A book arrives on the shelf | Spine shimmer while pages are read; then it slides up 28 px, overshoots 3 px and settles | 600 ms, arrive |
| 2 | Library opens into the book | Reader swings in from a slight 10° turn; each later page turns on a leaf hinged at the spine | 650 ms, settle |
| 3 | Pacing and the lamp | Hairline pacing bar fills as pages turn; on the last page the lamp glow pulses once | 800 ms, 1.2 s pulse |
| 4 | Questions, one at a time | Each question slides in 32 px from the right; a chosen option settles 0.985 → 1 | 450 ms, 260 ms |
| 5 | The score reveal | Score counts up with ease-out cubic, then concept chips appear 60 ms apart | 900 ms, 400 ms |
| 6 | Dashboard draws itself | Trend line draws left to right; mastery bars grow from zero; streak candle flickers slowly | 900 ms, 3 s loop |
| 7 | Warming up the room | Lamp brightens over 6 s, steam rises from the tea, copy rotates every 2.6 s | 6 s, 3.2 s loop |

Other timings from the components sheet: reader toolbar fades to 0 and
lifts 8 px after 2.6 s without pointer movement, returns on move, hover or
keyboard focus; desktop word card loading state appears after 380 ms of
hover; mobile word card opens on a 450 ms tap-and-hold; toasts stay 5 s;
tea steam loops every 3.2 s.

## Component inventory

From the components sheet (CD.3) and the foundations artboard (CD.2).

| Component | Variants | States | Values and notes |
|---|---|---|---|
| Button | Primary (`--accent`), Secondary (`--surface`, `--line-2` border), Ghost (no fill) | Default, hover (primary darker; ghost gets a `--paper-2` fill; secondary border darkens), focus-visible, disabled (faded), loading (spinner + "Grading…", "Uploading…", "Saving…") | min-height 44, padding 0 20, radius 10, DM Sans 500 15. "Press: scale 0.98 over 150 ms. Focus ring: 2 px accent, 3 px offset, on every interactive element. Minimum target 44 px." |
| Text input | Default, focused, error | Focus: accent ring; error: `--warn` border and a warn message with an alert icon ("That password doesn't match this email.") | radius 8, `--line-2` border, `--surface` fill |
| Text area | Written answer | Default | Placeholder "Two or three sentences in your own words…", resizable |
| Segmented tabs | Sign in / Create account | Selected tab is a raised `--surface` pill | Sign-in screen |
| Theme toggle | Paper, Lamplight | Knob moves; in Lamplight the knob glows | Sun and moon icons, radius 999 |
| Reader toolbar | One | Visible, auto-hidden after 2.6 s | Back to Library, book · chapter (Lora italic), small A / large A, Contents, "Look up" switch, theme toggle |
| Test chrome | Question dots, timer pill | Timer normal; timer in last 30 s turns `--warn` on `--warn-soft` ("0:24") | Current dot is accent |
| Option card | Unselected, selected | Selected: accent border and wash, filled letter; settles 0.985 → 1 over 260 ms | Letter badge A–D, Lora answer text, radius 12 |
| Chip | Strengthened (accent wash, check icon), To revisit (dashed border, rotate-back icon) | Stagger in 60 ms apart | "Chip states differ by fill, border style and icon, not hue alone." |
| Score badge | Filled wash (earlier session), outlined (current session) | | "86% Session 5", "72% Session 6"; Playfair figure + DM Sans label |
| Progress ring | One | | "Progress ring · concept mastery per book", e.g. 64% |
| Tooltip | Dark | | "4 pages left in today's reading", with a pointer |
| Skeleton | Text lines, cover blocks | Shimmer (library loading screen) | `--paper-2`, radius 6 |
| Book cover | Typographic (moss, oxblood, ink, …), real cover image, processing | Processing: spine shimmer + "Reading the pages… 64%"; arrive animation (moment 1) | 2:3; title Playfair italic top-left, author spaced caps bottom-left over a short rule, inner hairline frame. Real cover: "image slot, 2:3, covers crop", label "Cover image · Open Library" |
| Drop zone | Idle (dashed border, "Drop a PDF or EPUB here", Browse files), drag-over (accent wash, accent border, "Release to add 'Meditations.epub'", upload icon) | | |
| Word card, desktop | Dictionary (word, IPA, part of speech, numbered senses, example quote, source "Wiktionary"), place (name, kind · location in accent caps, Wikipedia summary, "Wikipedia ↗" link), loading (skeleton lines, "appears after 380 ms of hover"), not found ("No definition found for this phrase…", "Nothing in Wiktionary or Wikipedia", "Search ↗") | Close button | "In the margin beside the line" |
| Word card, mobile | Compact sheet below the word (grab handle, word, IPA, part of speech, one sense, "Wiktionary", "Tap outside to close"); phrase selection shows a small "Look up" chip above the selection | Tap and hold 450 ms | Looked-up word gets an accent wash highlight |
| Modal | Confirm | | "Leave this test?" / "Your answers so far are kept. You can come back and finish it any time today." / Keep going (secondary), Leave test (primary). Grey scrim |
| Toast | Success (check, action link "Plan sessions"), neutral (bookmark, "Place saved at page 15."), warning (`--warn-soft`, alert icon, "This PDF is scanned images, so we can't read its words yet.", "Try another") | Close button; 5 s | Bottom left; success and neutral are dark (`--ink` fill) in Paper and light in Lamplight |
| Ribbon bookmark, page furniture | One | | Running header in spaced caps, folio in Lora centred ("p. 13 of 212") |
| Empty state | Library | | Shelf illustration, "Your shelf is waiting", "Add a book you mean to read properly.", primary "Add a PDF or EPUB" |
| Top navigation | One | Active link underlined in accent | Logo (open book icon + "ReadFocus"), Library, Dashboard; right: theme toggle, round initials badge ("FR") |
| Pacing bar | One | Fills via `scaleX`; lamp pulse on last page | 120 x 2 px (foundations) |
| Streak pill | One | Candle flickers (3 s loop) | "12 evenings in a row" |
| Stat row | Four figures | | Playfair figures, DM Sans labels, hairline dividers |
| Line chart | Test scores | Draws left to right (900 ms) | Accent line, hollow points, last point filled, accent-soft area fill, 0–100 axis at 25s |
| Mastery bar | Per concept | Grows from zero | Accent bar on `--line` track, percentage; weak concepts get "Needs revisiting" in accent text |
| Tabs (underline) | Book tabs on dashboard | Active underlined in accent | Walden / Meditations / Middlemarch |

## Screen-by-screen notes

Desktop artboards are 1440 x 900 and stop at the fold; content below
(rest of the shelf, results list, mastery list) is not shown. Mobile
artboards are 375 x 812 and also stop at the fold.

| # | Screen | Layout (1440) | Key components | Motion | Imagery |
|---|---|---|---|---|---|
| 01 | Sign in | Split 50/50. Left: `--paper-2`-tinted panel with logo, illustration, and "Read slowly. / Keep what you read." (Display) with an italic Lora subline. Right: "Welcome back", "Sign in to return to your shelf.", segmented Sign in / Create account, Email, Password + "Forgot password?" link, full-width primary "Sign in", note "First visit of the evening? The room may take a moment to warm up." | Segmented tabs, inputs, primary button, link | Not specified | Window at dusk, stack of books, tea, reading lamp in one scene |
| 02 | Warming up | Centred: lamp + tea illustration left, text right: eyebrow "ReadFocus", italic Playfair "Warming up the reading room…", body "The reading room has been resting. Waking it can take up to a minute the first time. Thanks for waiting.", short accent progress line | Pacing-style hairline | Moment 7 (lamp brightens 6 s, steam, rotating copy every 2.6 s) | Reading lamp with glow disc, tea with steam |
| 03 | Library, processing and toast | Top nav. "Your shelf" (H1) + "5 books · Walden is in today's reading". Today's reading card (open-book illustration, eyebrow, "Walden — 'Economy', pages 12–17", "About 18 minutes. We'll revisit *opportunity cost*; you missed it twice last session.", primary "Begin reading →"). "On your shelf" eyebrow + secondary "Add a book" (upload icon). Row of 2:3 covers with title, author, mastery bar and line ("62% mastered · in today's…", "New · 1 session", "Reading the pages… 64%") | Nav, card, covers, mastery bars, toast | Moment 1 for the processing book; toast in | Open book with ribbon; typographic covers; one real cover (Meditations, Open Library) |
| 04 | Library, empty | Nav, "Your shelf", one large raised card: shelf illustration, "Your shelf is waiting", copy, primary "Add a PDF or EPUB", "or drop a file anywhere on this page" | Empty state, drop target | Not specified | Empty shelf |
| 05 | Library, loading | Nav, skeleton title, skeleton card, five skeleton covers and lines | Skeleton | Shimmer | None |
| 06 | Reading, two-page spread with word card | Floating reader toolbar top centre. Open book, two pages: left page running head "Walden", today's note box (bookmark icon, "Today: pages 12–17, about 18 minutes. We're revisiting opportunity cost…"), "Chapter I", "Economy" (chapter title + short accent rule), first paragraph; right page running head "Economy", ribbon, justified Lora text. Looked-up words have a dotted underline (obtrude, impertinent, Walden Pond) | Reader toolbar, book page, ribbon, word card (mobile frame shows the "Walden Pond" card as a bottom sheet) | Moments 2 and 3; toolbar auto-hide | None besides the ribbon |
| 07 | Comprehension test | Minimal chrome: "× Leave test" left; "Walden · session 6" + question dots centre; timer pill right. Eyebrow "Question 1 of 5 · Multiple choice", question (Lora 500), four option cards, ghost "← Back", primary "Next →" | Test chrome, option cards | Moment 4 | None |
| 08 | Results | Nav. Left: eyebrow "Walden · Session 6 · Results", huge Playfair "72%" with a small "%", summary chip "3 correct · 1 partial · 1 to revisit", Lora line "A good session. Opportunity cost is starting to hold."; "Question by question" list: status icon (check / rotate-back), label (Correct / Not quite), question, "You answered …", feedback, quote block on `--paper-2` with page ref. Right column: "Concepts from this session" card (Strengthened chips, To revisit chips) and "Next session · Tomorrow" card ("'Economy', continued · pages 18–25", copy, primary "See your dashboard", ghost "Back to library") | Chips, cards, quote block | Moment 5 | None |
| 09 | Dashboard | Nav. Eyebrow "Wednesday evening", H1 "Good evening.", streak pill. Stat row: 18,420 words read this week · 72% last test score · 6 sessions this week · 3 books in progress. "Test scores" line chart ("Last 8 sessions · all books"). "Concept mastery" with book tabs, "Weakest first", rows of concept + mastery bar + %. Right: "Recommended for tonight" card (lamp illustration, "Walden, 'Economy' continued", copy, primary "Begin reading", note "Middlemarch is waiting too: *Dorothea's idealism* sits at 30%.") | Stat row, chart, tabs, mastery bars, card, streak pill | Moment 6 | Candle, reading lamp |
| 10 | Error | Nav. Centred: empty tea cup illustration left; eyebrow "Something went quiet", H1 "The reading room didn't answer.", "We couldn't reach ReadFocus just now. Nothing is lost: your place in Walden and your last test are saved.", primary "↻ Try again", ghost "Back to sign in", mono "Error 503 · request 7f3a-21c4" | Buttons | Not specified | Tea cup, no steam |

Mobile (375): every screen stacks to one column. Sign in puts the
illustration and tagline above the form. Library shows covers three
across and "Today's reading" as a full-width card with a full-width
button. Reading drops the two-page spread for one page, the toolbar
becomes icons only, and the word card opens as a sheet at the bottom
(the "Walden Pond" card). Test and results keep their order; the
results and dashboard right-hand cards are not visible above the fold,
so where they go is not specified. The dashboard stat row becomes 2 x 2.
The toast sits bottom left over the shelf.

## Illustrations and book covers

- **Illustrations** (components sheet: "one line weight (1.6), palette
  fills only"): reading lamp (glow disc, light cone), stack of books, tea
  ("steam loops 3.2 s"), window at dusk (arched, two small dots, a sun
  low on a hill). Second row, labels cut off at the board's edge: empty
  shelf, open book with ribbon, crescent moon with stars, candle. The
  error screen uses a tea cup without steam; sign-in combines window,
  books, tea and lamp. Line colour is `--ink-2`-like; fills use
  `--accent-soft`, `--paper-2` and the accent. Lamplight swaps fills to
  the dark palette.
- **Book covers:** 2:3. Typographic covers use the five cover colours,
  cream title in Playfair italic top-left, author in spaced caps
  bottom-left over a short rule, inner hairline frame, radius
  `3px 6px 6px 3px`, soft shadow. A real cover image fills the same slot
  ("covers crop") and is labelled "Cover image · Open Library", so covers
  come from Open Library when found. How a book is assigned a cover
  colour: not specified.

## Mapping to the current frontend

| Design screen or element | Existing file | Note |
|---|---|---|
| 01 Sign in | `frontend/src/pages/Login.jsx` (+ `.css`) | Route `/login` |
| 02 Warming up | None | New: shown while the backend wakes (Render Free cold start) |
| 03–05 Library (shelf, processing, toast, empty, loading) | `frontend/src/pages/Library.jsx` (+ `.css`) | Route `/` |
| 06 Reading, word card | `frontend/src/pages/ReadingSession.jsx` (+ `.css`) | Route `/read/:bookId`. No word lookup component or endpoint exists |
| 07 Test | `frontend/src/pages/ComprehensionTest.jsx` (+ `.css`) | Route `/test/:sessionId` |
| 08 Results | `frontend/src/pages/Results.jsx` (+ `.css`), `frontend/src/components/ui/ScoreBadge.jsx` | Route `/results/:sessionId` |
| 09 Dashboard | `frontend/src/pages/Dashboard.jsx` (+ `.css`) | Route `/dashboard`; uses recharts today |
| 10 Error | None | New |
| Top nav, theme toggle, initials badge | `frontend/src/components/Layout.jsx` (+ `.css`) | No theme switching exists today |
| Calibration | `frontend/src/components/CalibrationFlow.jsx` | Not in the design |
| Button | `frontend/src/components/ui/Button.jsx` | |
| Surfaces, cards | `frontend/src/components/ui/Card.jsx` | |
| Modal | `frontend/src/components/ui/Modal.jsx` | |
| Skeleton | `frontend/src/components/ui/Skeleton.jsx` | |
| Chip, toast, option card, cover, drop zone, word card, reader toolbar, illustrations | None | New |
| Tokens | `frontend/src/index.css` | Defines its own older `--paper-*` palette; Tailwind v4 is installed but not wired into Vite |

## Gaps and ambiguities

1. **Primary button label colour.** The PNG screens and components sheet
   show dark ink labels on the Paper terracotta button ("Begin reading",
   "Sign in", "Start test"), while the foundations CSS sets
   `--accent-ink: #FFFDF9`. Dark ink `#2A2420` on `#A64B2A` is about
   2.7:1 (computed here), which fails WCAG AA; `#FFFDF9` is about 5.6:1.
   **Resolved by D1.**
2. **Reader page layout in the mock.** In `reading-word-card-*-1440.png`
   the left page's first paragraph is squeezed into a narrow column inside
   a dashed box, with "Walden Pond" floating beside it and words
   (", and earned my") stranded below. It looks like a rendering fault in
   the mock, not a design. No desktop word card is drawn on the reading
   screen itself; the components sheet shows it.
3. **Desktop and mobile artboards stop at the fold**, so the rest of the
   shelf, the results list and the mastery list are not shown.
4. **Ribbon overlaps the running head** ("Economy") on the foundations
   artboard and the reading screen. **Resolved by D2.**
5. **Easing names differ** between the motion table (`--ease-settle`,
   `--ease-arrive`, `--ease-breathe`) and the CSS (`--ease`, `--arrive`,
   `--breathe`); `--dur-*` exists only in the table. **Resolved by D3.**
6. **Moment timings are off-scale:** 450, 650, 900 and 260 ms (and 380,
   450 ms on the components sheet) are not `--dur-*` values.
   **Resolved by D3** (380 and 450 ms are behaviour delays and stay).
7. **Radii off-scale:** 4 px (book page) and 16 px (panels).
8. **Links are not themed** in the HTML (`#A64B2A`, hover `#7E3820`); the
   boards show links in `--accent-text`-like colours in both themes.
9. **Initials badge** ("FR"): what it opens (account menu, sign out) is
   not specified. **Resolved by D4.**
10. **Reader toolbar:** what "Contents" opens is not specified; font-size
    buttons presumably step through 16.5 / 18 / 19.5 (inferred).
    **Contents resolved by D4**; the font-size steps are still inferred.
11. **Second illustration row** labels are cut off on the components
    board; names above are inferred from the drawings.
12. **Word card sources:** the cards cite Wiktionary and Wikipedia;
    `CLAUDE.md` lists the Free Dictionary API (whose data comes from
    Wiktionary) and Wikipedia. Cover images cite Open Library, a free API
    not yet used in the repo; it needs the `free-intelligence` check.
    **Covers: Open Library confirmed by D5** (the check still applies).
13. The prototype board holds one still frame (sign in); the prototype's
    transitions are not in the export.
14. Not specified: shadow values for covers, cards, toasts and modal;
    Tailwind token names; breakpoints between 375 and 1440. (Font loading
    resolved by D6.)

## Questions

All six earlier questions are answered by D1–D6 above, and the accent is
a reader setting (2026-11-11). Still open, to settle in the chunk that
needs them:

1. Where reading settings live (default text size, daily session length,
   theme, accent): profile columns or browser storage (D4).
2. Where the Open Library lookup runs: the backend at ingestion, or the
   browser (D5).
3. Whether DM Mono, loaded today, is dropped (D6).
4. Gaps 2, 3, 7, 8, 11, 13 and 14 above.
