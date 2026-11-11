# Claude Design handoff: summary (CD.2)

Source: `Foundations — style guide-html.zip` (212,824 bytes), received
2026-11-11, unpacked unchanged into
[`handoff/foundations-style-guide/`](handoff/foundations-style-guide/)
(SHA-256 of each file matched the archive after copying).

## What the bundle contains

| File | Size | What it is |
|---|---|---|
| `Main.dc.html` | 22,694 B | The only artboard: "ReadFocus foundations", 1440 px wide. Tokens live in its `<helmet><style>` block and inline styles; lists (palettes, spacing, radii, motion moments) live in the `renderVals()` script at the bottom. |
| `README.md` | 907 B | Export note: treat as a reference mockup, replicate values, do not copy markup. |
| `support.js` | 46,105 B | Claude Design runtime (`dc-runtime`), generated. Not part of the design. |
| `vendor/react.js`, `vendor/react-dom.js` | 10,751 B, 131,835 B | React production builds used by the runtime. Not part of the design. |

**The bundle holds the foundations style guide only.** It has no screen
artboards (library, reader, word card, test, results, dashboard, login),
no illustrations, no image assets and no component code. The artboard
itself refers to "screen artboards" with an "Accent tweak" and to "the
prototype" for the signature moments; neither is in the bundle. Everything
below that is not on the foundations artboard is marked **not specified**.

## Screen images

| File | What | How made |
|---|---|---|
| [`screens/foundations-paper-1440.png`](screens/foundations-paper-1440.png) | Whole foundations artboard, 1440 x 6538 px, Paper theme with terracotta (the artboard's own theme; it shows Lamplight inside its panels) | Headless Edge screenshot of `Main.dc.html` served on `127.0.0.1` |

The artboard's `$preview` says 1440 x 3700, but the rendered content is
6538 px tall (measured with `document.documentElement.scrollHeight`); a
3700 px capture cuts off sections 04 and 05, so the full height was used.

No lamplight-only render and no 375 px render were made: the artboard is a
fixed 1440 px page in one theme. Screens that exist: **foundations only**.

## Design tokens

All values are copied from `Main.dc.html`. Contrast ratios are the design's
own figures ("against each theme's ground"); they were not re-measured here.

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
| `--warn` | `#8C5A00` | `#E9B65E` | Timer, last 30 s | 5.5:1 / 9.4:1 |
| `--warn-soft` | `#F6E9CF` | `#3A2E1C` | Not specified (in CSS only, not in the swatch table) | |

### Colour: accents (theme class x accent class)

| Token | Paper · terracotta | Paper · sage | Lamplight · terracotta | Lamplight · sage |
|---|---|---|---|---|
| `--accent` | `#A64B2A` (5.4:1) | `#506A4A` (5.6:1) | `#E59A6C` (7.6:1) | `#A8C198` (8.9:1) |
| `--accent-ink` (text on accent) | `#FFFDF9` | `#FFFDF9` | `#1D1915` | `#1D1915` |
| `--accent-soft` (wash) | `#F3E2D7` | `#E3EADD` | `#3A271C` | `#26301F` |
| `--accent-text` (accent as text) | `#9A4526` | `#4A6244` | `#EDA77B` | `#B3CBA3` |
| `--glow` | `rgba(166,75,42,0)` (none) | `rgba(80,106,74,0)` (none) | `rgba(229,154,108,.28)` | `rgba(168,193,152,.24)` |

Terracotta is the default. Theme classes are `.t-paper` / `.t-lamplight`;
accent classes `.a-terracotta` / `.a-sage`. Global links: `a { color:
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

Used on the artboard but not listed as a type role: page title 64/1.05
(the artboard's own `h1`), section heading 34/1.15.

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

Also used on the artboard but not in the scale: 4 px (book page), 16 px
(panels), 2 px (pacing bar, spacing bars).

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
| Book cover shadow | Not specified |

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

Signature moments (the artboard says "see them in the prototype"; the
prototype is not in the bundle):

| # | Moment | Description (from the artboard) | Timing |
|---|---|---|---|
| 1 | A book arrives on the shelf | Spine shimmer while pages are read; then it slides up 28 px, overshoots 3 px and settles | 600 ms, arrive |
| 2 | Library opens into the book | Reader swings in from a slight 10° turn; each later page turns on a leaf hinged at the spine | 650 ms, settle |
| 3 | Pacing and the lamp | Hairline pacing bar fills as pages turn; on the last page the lamp glow pulses once | 800 ms, 1.2 s pulse |
| 4 | Questions, one at a time | Each question slides in 32 px from the right; a chosen option settles 0.985 → 1 | 450 ms, 260 ms |
| 5 | The score reveal | Score counts up with ease-out cubic, then concept chips appear 60 ms apart | 900 ms, 400 ms |
| 6 | Dashboard draws itself | Trend line draws left to right; mastery bars grow from zero; streak candle flickers slowly | 900 ms, 3 s loop |
| 7 | Warming up the room | Lamp brightens over 6 s, steam rises from the tea, copy rotates every 2.6 s | 6 s, 3.2 s loop |

## Component inventory

Only what is drawn or named on the foundations artboard.

| Component | Drawn? | Variants | States | Values |
|---|---|---|---|---|
| Button | Yes | Primary (`--accent` / `--accent-ink`, glow in Lamplight); Secondary (`--surface`, `--ink`, 1 px `--line-2`) | Press scale 0.98 at 150 ms; hover, focus, disabled, loading: not specified | min-height 44, padding 0 20, radius 10, gap 8, DM Sans 500 15 |
| Chip | Yes | Filled (`.chip.str`: `--accent-soft`, check icon, "Opportunity cost"); Dashed (`.chip.rev`: 1 px dashed `--ink-3`, `--ink-2`, rotate-back icon, "Necessaries vs. luxuries") | Stagger in 60 ms apart; others not specified | padding 7 14, radius 999, 14 px 500, 15 px stroke icons (2 px) |
| Pacing bar | Yes | One | Fill via `scaleX`; lamp pulse on last page | 120 x 2 px, `--line-2` track, `--accent` fill, label "2 pages left" (13 px `--ink-3`) |
| Book page (reader) | Yes, as a mini page | Paper / Lamplight x terracotta / sage | Page turn 600 ms (prototype only) | `--page`, radius 4, padding 28 36, running head (book left, chapter right), ribbon bookmark, drop cap, justified Lora |
| Ribbon bookmark | Yes | One | Not specified | 16 x 86, `--accent`, top −6, right 44, notched clip-path |
| Typographic cover | Swatches only | 5 colours | Arrive animation (moment 1); shimmer while reading | Playfair italic 18 cream title, bottom-left, radius 3 6 6 3 |
| Surface / card | Yes | Raised, sunken, book page | Not specified | See surfaces table |
| Skeleton | Named | | | `--paper-2`, radius 6 |
| Input | Named | | | radius 8, `--line-2` border; everything else not specified |
| Option (test answer) | Named | | Chosen: 0.985 → 1 settle | radius 12; everything else not specified |
| Theme toggle | Named | | Knob 250 ms | radius 999; everything else not specified |
| Toolbar, toast | Named | | 250 ms | Not specified |
| Word card | Named | | In at 200 ms | Not specified |
| Score count-up, trend chart, mastery bars, streak candle, lamp, tea steam | Named in moments | | See moments | Not specified |

## Screen-by-screen notes

There are no screen artboards in the bundle. What the foundations page
says about each screen:

| Screen | Layout | Key components | Motion | Imagery |
|---|---|---|---|---|
| Library ("Your shelf") | Not specified | Typographic covers | Moment 1, moment 2 | Typographic covers only; no cover art specified |
| Reader / book | Mini page only: running head, ribbon, drop cap, justified Lora, chips, Start test + Contents, pacing bar | Book page, ribbon, chips, buttons, pacing bar | Moments 2 and 3; page turn 600 ms | Lamp glow (Lamplight) |
| Word card | Not specified | Not specified | In at 200 ms | Not specified |
| Test | Not specified | Question type (Lora 500 26/36), options (radius 12), timer (`--warn` in last 30 s) | Moment 4 | Not specified |
| Results | Not specified | Score, concept chips | Moment 5 | Not specified |
| Dashboard | Not specified | Figures type (e.g. "18,420 words this week"), trend line, mastery bars, streak candle | Moment 6 | Candle |
| Loading / "warming up" | Not specified | Rotating copy | Moment 7 | Lamp, tea with steam |
| Login | Not specified | Not specified | Not specified | Not specified |

## Illustrations and book covers

- **Illustrations:** none in the bundle. Named only in motion copy: lamp,
  tea cup with steam, streak candle. Style: not specified.
- **Book covers:** typographic. Five ground colours (table above), cream
  title `#F6EFE3` in Playfair Display italic, bottom-left, radius
  `3px 6px 6px 3px` (spine side tighter), a real shadow (value not
  specified). How a book is assigned a colour, cover size/aspect ratio,
  author line, and whether uploaded cover images are ever used: not
  specified.

## Mapping to the current frontend

"Inferred" means the design screen is known only from a name on the
foundations page.

| Design screen or element | Existing file | Note |
|---|---|---|
| Library / shelf | `frontend/src/pages/Library.jsx` (+ `Library.css`) | Route `/` |
| Reader / book page, pacing bar, ribbon | `frontend/src/pages/ReadingSession.jsx` (+ `.css`) | Route `/read/:bookId`; current progress bar is `rf-chunk-progress-bar` |
| Word card | None | No word lookup component exists in `frontend/src` |
| Test, question, options, timer | `frontend/src/pages/ComprehensionTest.jsx` (+ `.css`) | Route `/test/:sessionId` |
| Results, score reveal, concept chips | `frontend/src/pages/Results.jsx` (+ `.css`), `frontend/src/components/ui/ScoreBadge.jsx` | Route `/results/:sessionId` |
| Dashboard | `frontend/src/pages/Dashboard.jsx` (+ `.css`) | Route `/dashboard` |
| Login | `frontend/src/pages/Login.jsx` (+ `.css`) | Not in the design |
| Calibration | `frontend/src/components/CalibrationFlow.jsx` | Not in the design |
| App shell, theme toggle, toolbar | `frontend/src/components/Layout.jsx` (+ `.css`) | No theme switching exists today |
| Button | `frontend/src/components/ui/Button.jsx` | |
| Surfaces, cards | `frontend/src/components/ui/Card.jsx` | |
| Skeleton | `frontend/src/components/ui/Skeleton.jsx` | |
| Modal | `frontend/src/components/ui/Modal.jsx` | Not in the design |
| Chip, pacing bar, cover, toast | None | |
| Tokens | `frontend/src/index.css` | Currently defines its own `--paper-*` variables |

## Gaps and ambiguities

1. **No screens.** Only the foundations artboard was exported; screen
   artboards and the prototype it refers to are missing.
2. **Easing names differ.** The motion table names `--ease-settle`,
   `--ease-arrive`, `--ease-breathe`; the CSS defines `--ease`,
   `--arrive`, `--breathe`. Duration tokens `--dur-1..6` exist only in the
   table, not in the CSS.
3. **Moment timings are off-scale:** 450, 650, 900 and 260 ms are not
   `--dur-*` values.
4. **Radii off-scale:** 4 px (book page) and 16 px (panels) are used but
   not listed.
5. **Links are not themed:** `#A64B2A` / hover `#7E3820` are hard-coded;
   `#7E3820` is not in the palette, and Lamplight and sage link colours are
   not specified.
6. Tokens in CSS but missing from the swatch table: `--warn-soft`,
   `--accent-ink`, `--accent-text`, `--glow`.
7. **Ribbon overlaps the running head:** in the render, the ribbon sits on
   top of the chapter name ("Economy") in all four mini pages.
8. Chip meanings: the classes are `str` and `rev`; what each means
   (strength / to review?) is not specified.
9. Not specified at all: breakpoints and a 375 px layout, focus ring
   style, hover/disabled/error states, inputs, toasts, empty and error
   states, icon set (only two inline SVG paths), font loading (Google
   Fonts CDN or self-hosted), Tailwind v4 token names.
10. Contrast ratios are as stated by the design and were not re-measured.

## Questions for you

1. Can you export the screen artboards (and the prototype) from Claude
   Design? Without them C10–C13 have tokens but no layouts.
2. Is the accent (terracotta / sage) a reader setting, or a design-time
   choice with terracotta shipped?
3. Should the ribbon overlap the running head, or move clear of it?
4. Which easing names win: `--ease-settle` (table) or `--ease` (CSS)? And
   should the moment timings snap to the `--dur-*` scale?
5. What colour should links use in Lamplight and with sage?
6. How should a book get its cover colour (hash of title, genre, user
   choice)?
7. Fonts: load from Google Fonts or self-host in the bundle?
