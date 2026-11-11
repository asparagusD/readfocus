# Image and asset register

Every image, illustration or other visual asset the app ships, with where
it came from and its licence (C11). Allowed: original work drawn in this
repo, CC0, or the Unsplash License. No AI-generated images, stock
subscriptions or paid services. Fonts are listed in `design/HANDOFF_SUMMARY.md`
(D6, OFL) and are not repeated here.

A third-party file gets its source URL, author and the changes made. An
original file says "original".

| File | What | Source | Author | Licence | Added | Changes |
|---|---|---|---|---|---|---|
| `frontend/src/illustrations/svg/ReadingLamp.svg` | Reading lamp, glow disc, light cone | original, drawn to the handoff's illustration style (`design/screens/components-*-sheet.png`) | ReadFocus | original | 2026-11-11, C11.1 | svgo 4.1.0 |
| `frontend/src/illustrations/svg/BookStack.svg` | Stack of four books | original, as above | ReadFocus | original | 2026-11-11, C11.1 | svgo 4.1.0 |
| `frontend/src/illustrations/svg/TeaCup.svg` | Tea cup with three steam wisps | original, as above | ReadFocus | original | 2026-11-11, C11.1 | svgo 4.1.0 |
| `frontend/src/illustrations/svg/DuskWindow.svg` | Arched window at dusk | original, as above | ReadFocus | original | 2026-11-11, C11.1 | svgo 4.1.0 |
| `frontend/src/illustrations/svg/EmptyShelf.svg` | Empty bookcase | original, as above | ReadFocus | original | 2026-11-11, C11.1 | svgo 4.1.0 |
| `frontend/src/illustrations/svg/OpenBook.svg` | Open book with ribbon bookmark | original, as above | ReadFocus | original | 2026-11-11, C11.1 | svgo 4.1.0 |
| `frontend/src/illustrations/svg/CrescentMoon.svg` | Crescent moon with three stars | original, as above | ReadFocus | original | 2026-11-11, C11.1 | svgo 4.1.0 |
| `frontend/src/illustrations/svg/Candle.svg` | Candle in a holder, flame and glow (the dashboard's streak) | original, drawn to the same style | ReadFocus | original | 2026-11-11, C13.7a | svgo 4.1.0 |
| `frontend/public/og.png` | 1200 x 630 share image (Open Graph, Twitter): wordmark, headline, DuskWindow, ReadingLamp and OpenBook on a sill | original, rendered by `frontend/scripts/make-og.mjs` from the app's tokens, bundled OFL fonts and the illustrations above | ReadFocus | original | 2026-11-11, C13.10e | sharp 0.35.5 palette PNG, 23.2 KB |

## Text on the landing page (C13.10)

| File | What | Source | Licence | Added | Changes |
|---|---|---|---|---|---|
| `frontend/src/pages/landing/passages.js`, `WordDemo.jsx` | Marcus Aurelius, *Meditations*, Book IV, III (hero spread) and Book I, XV (word demo), translated by Meric Casaubon (1634) | Project Gutenberg eBook #2680 (https://www.gutenberg.org/ebooks/2680), plain text, checked verbatim | Public domain (in the USA, per Project Gutenberg); the Gutenberg name and licence are not used, only the text, cited with a link | 2026-11-11, C13.10b, C13.10c | Soft hyphens added to long words in the spread |
| `frontend/src/pages/landing/demoDefinitions.json` | Six dictionary entries (Betimes, odious, whosoever, kinsman, incur, reproachful) and one Wikipedia summary (Quadi) | Fetched once with `backend/services/lookup.py` from the Free Dictionary API (https://dictionaryapi.dev/, Wiktionary content) and the Wikipedia REST summary of "Quadi" | Wiktionary: CC BY-SA 3.0; Wikipedia: CC BY-SA 4.0. Credited on the card ("Wiktionary, via Free Dictionary"; "Summary from Wikipedia" with the article link) and in the file's `_sources` | 2026-11-11, C13.10c | Audio and thumbnail links removed (no network calls) |

## Book covers (per book, not in the repo)

| Files | What | Source | Licence | Added | Changes |
|---|---|---|---|---|---|
| Supabase Storage, public bucket `covers`, `ol/<cover_id>-M.jpg` | One cover per Open Library cover ID, for books readers upload | Open Library Covers API (`covers.openlibrary.org/b/id/<id>-M.jpg`, served from archive.org), found by `backend/services/covers.py` | **Not CC0.** Cover art belongs to its publishers; Open Library offers the covers for free use in book listings. Used under handoff decision D5 (user-approved), only as the cover of a book the reader uploaded, credited "Cover image · Open Library" where shown (C11.3) | 2026-11-11, C11.2 | None: copied unchanged (re-encoding planned for C11.5) |

## Vite template files (from `create-vite`, added in `f107f08`)

Scaffolding the project with `create-vite` (MIT licence) added these. Only
the favicon reaches readers; the others are imported nowhere and are not in
the production build.

| File | What | Source | Licence | Used | Changes |
|---|---|---|---|---|---|
| `frontend/public/favicon.svg` | Vite logo, the browser-tab icon | create-vite React template | MIT (template code); the Vite logo is the Vite project's mark | Yes, `index.html` | None. To be replaced by an original mark (C11 plan, not done) |
| `frontend/public/icons.svg` | Sprite of social icons (Bluesky and others) | create-vite React template | MIT (template); the brand icons are their owners' marks | No | None |
| `frontend/src/assets/hero.png` | Template hero image, 343 x 361, 13.1 KB | create-vite React template | MIT (template) | No | None |
| `frontend/src/assets/react.svg` | React logo (Iconify `logos`) | create-vite React template | MIT (template); the React logo is Meta's mark | No | None |
| `frontend/src/assets/vite.svg` | Vite wordmark | create-vite React template | MIT (template); the Vite logo is the Vite project's mark | No | None |
