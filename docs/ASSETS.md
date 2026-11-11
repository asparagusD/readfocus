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
