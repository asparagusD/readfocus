# ReadFocus 2.0 — project rules

ReadFocus is a book comprehension app: upload a PDF or EPUB, read it in paced
sessions, take a short test after each one, and the next session adapts to
your score.

## Product goal

- **Intelligent**: planning, question generation, grading and pacing adapt to
  the reader.
- **Blazing fast**: reading, tests and grading never wait on a remote model.
- **$0 API cost**: algorithmic or local; Steve uses Gemini's free tier or a reader's key.
- **Cozy and sophisticated UI** that feels like reading a real book.
- Built in a **27-hour sprint**, split into chunks (C0, C1, ...) and
  subchunks (C1.1, C1.2, ...).

## Hard constraints

1. Gemini is the only generative AI allowed: only for Steve, only through
   our backend, only after the reader's consent, on the free tier (no
   billing account) or the reader's own key. Everything else stays
   algorithmic and local: no other LLM or embedding API (Groq, OpenAI,
   Anthropic, Cerebras, SambaNova, OpenRouter), no scraping, no paid APIs
   or services, no payment methods. Free-tier prompts and responses may be
   used by Google to improve its products, so Steve shows a consent notice
   before first use and can be turned off. Never send more book text than
   Steve's context builder allows.
2. Supabase migrations are additive only. Never drop tables or columns.
   Dev and production share one Supabase project (`lvfhuszvuiowyeizstru`,
   decided at Gate G4): treat it as production. Reading it is allowed:
   selects, `--dry-run`, `migration list`, a script's `--dry-run`. Writing
   to it needs explicit approval for that specific action: a migration, a
   backfill, a bench or script run that uploads or deletes, creating or
   resetting test users. The database has no automatic backup (Supabase
   Free), so a write that changes the schema or existing rows also needs a
   fresh `supabase db dump` first, confirmed by the user. Anything a run
   creates (books, sessions, users) is deleted by that same run.
3. Never claim something works unless it was run. Never invent file paths.
4. Secrets never go in git or the frontend bundle. The service-role key stays
   server-side.
5. Render Free has tight RAM/CPU: measure memory (psutil RSS) before adding
   any model or heavy dependency.

## Phase 2 (C16–C25, 31-hour budget)

Adds Steve, highlights and underlines, a notepad, focus mode, gamification
and the original view. English only: Bengali/Bangla books are out of scope.

- **Original view**: PDF and EPUB renderers show each book as published (images, figures, math, code); the book view is retired (C17).
- **Region map**: each page split into prose, math, code, figure and table regions (`docs/ANCHORS.md`, written in C16.3).
- **Anchors**: highlights, notes and drawings point at PDF quads or an EPUB CFI range, plus a text quote (`docs/ANCHORS.md`).
- **Body start**: where the book's body (chapter 1) begins after front matter; focus mode unlocks there (`docs/FOCUS_RULES.md`, C16.3).
- **Focus session**: a server-timed stopwatch with server-scored points, a bookmark quiz and a 3-hour cap (`docs/FOCUS_RULES.md`).
- **Gamification** (`docs/GAMIFICATION.md`, C16.3): no dark patterns: streak freezes, no guilt notifications, no fake users, a leaderboard opt-out. Only the server writes points and XP.
- **Readers' own Gemini keys** are stored encrypted on our server, never logged, never returned in full.
- **New env vars** (names only): `GEMINI_API_KEY`, `GEMINI_MODEL_CHAT`, `GEMINI_MODEL_VISION`, `STEVE_DAILY_LIMIT_PER_USER`, `KEY_ENCRYPTION_SECRET`, `CRON_SECRET`.

## Working method

- **Skills first.** Every prompt names the skills to load (see
  [Project skills](#project-skills)).
- **Small commits.** One subchunk = one focused, working change = one commit,
  at most ~200 changed lines excluding lockfiles, migrations and generated
  graph files; split into a/b if larger. Tests go in the same commit. Never
  commit failing checks. Stage files explicitly; never `git add -A` or
  `git add .`.
- **Repo graph.** Before editing a file, run
  `python tools/repo_graph/query.py <file>`. After adding, removing or
  rewiring files, run `make graph` and include `docs/repo-graph/` in the same
  commit.
- **Standard checks** before every commit (see [below](#standard-checks)).
- **Debug protocol** on any failure: the ten steps of the `debug-protocol`
  skill (log in `docs/DEBUG_LOG.md`, reproduce, ranked hypotheses, minimal
  root-cause fix, regression test, `fix(<scope>): ...`; stop after 3 tries).
- **Progress.** Tick each subchunk in `docs/PROGRESS.md`
  (Step | Commit | Change | Verified by | Time | Open issues).
- **Ask, don't assume** before anything irreversible, writing to the
  Supabase project (see constraint 2), or removing user-facing features.
- **Scope.** If a chunk runs more than 50% over its hours, stop and propose
  cuts. Each chunk lists what is safe to cut.

## Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn (`backend/`) |
| Frontend | React + Vite, plain JavaScript (`frontend/`) |
| Data | Supabase: Postgres, pgvector, Storage, Auth, RLS (`supabase/migrations/`) |
| Agents | LangGraph with five algorithmic agents: orchestrator, planner, test generator, evaluator, optimizer (`backend/agents/`) |
| Embeddings | Local fastembed models, cached under `FASTEMBED_CACHE` |
| Study assistant | Steve: Gemini through the backend, opt-in (from C21) |
| Word lookup | Free Dictionary API and Wikipedia |
| Hosting | Render Free (backend), Vercel (frontend) |

Since C8.8 no backend code, dependency or config uses an LLM or embedding
API. `backend/tests/test_no_paid_ai.py` still bans Gemini too; Steve's
backend chunk narrows it to his module, test first (constraint 1).

Python: `.venv`, the Docker image and CI are 3.11 (CI since C14.5);
`pyrightconfig.json` still says 3.14. Write code that runs on 3.11. Dev and
CI tools (pytest, ruff, psutil) are pinned in `requirements-dev.txt`.

## Branch model

- `readfocus-2.0` is the sprint branch.
- Each chunk gets `chunk/C<n>-<slug>`, created from `readfocus-2.0`.
- When a chunk is done, merge it back with `git merge --no-ff`.
- `main` is touched only at release: CI deploys to Render on every push to
  `main`.

## Run commands

Activate the virtualenv first (`.\.venv\Scripts\Activate.ps1`); `uvicorn`,
`ruff` and `pytest` live in `.venv` and are not on PATH otherwise.

```bash
make dev-backend    # FastAPI on http://127.0.0.1:8000, health check at /health
make dev-frontend   # Vite on http://localhost:5173
```

Local configuration lives in `.env` and `frontend/.env` (both ignored); the
variables are listed in `.env.example` and `frontend/.env.example`.

## Standard checks

Run from the repo root, with the virtualenv active, before every commit:

```bash
ruff check backend/
pytest backend/tests -q
npm --prefix frontend run lint
npm --prefix frontend run build
python -c "import backend.main"
pytest tools/repo_graph/tests -q
npm --prefix frontend run check:contrast
npm --prefix frontend run check:images
npm --prefix frontend run test:unit
npm --prefix frontend run test:e2e
```

Baseline when this file was written (C1.1; the last four rows were added in C10.2, C11.5, C12.3 and C12.10):

| Check | Result |
|---|---|
| `ruff check backend/` | fails: 27 errors in existing code (28 until C14.3, 30 until C9.4, 31 until C9.1b, 32 until the issue 29 fix, 36 until C8.8, 40 until C8.5, 84 until C3.4, 83 until C4.5, 82 until C5.5, 81 until C6.4, 64 until C8.3, 63 until C8.4a, 48 until C8.4b) |
| `pytest backend/tests -q` | passes: 913 tests, offline (895 until C18.2b, 878 until C18.2a, 858 until C18.1, 857 until the C17.6 backfill fix, 849 until C17.6, 829 until C17.5a, 823 until C17.1c, 812 until C17.1a, 811 until C16.4, 809 until C15.3, 806 until the C15.2 issue 17 fix, 804 until the C14.5 requirements fix, 795 until C14.3, 787 until C14.1, 783 until C13.3a, 782 until the C12.6 cache-key fix, 775 until the second C12.6 follow-up, 772 until the C12.6 follow-up, 743 until C12.6, 735 until C12.4, 728 until C12.3b, 712 until C12.2, 689 until the C12.1 chapter fix, 678 until C12.1c, 673 until C12.1b, 652 until C12.1a, 650 until the C11.2 backfill fix, 608 until C11.2, 606 until the C9.3 preload fix, 605 until the C9.5 bench fix, 593 until C9.4, 584 until C9.3, 582 until C9.2, 568 until C9.1b, 551 until C9.1a, 548 until C9.0a, 546 until the issue 34 fix, 543 until the issue 33 fix, 542 until the issue 29 fix, 541 until the C8.G fix, 538 until C8.8, 527 until C8.7, 525 until the C8.5 fix of issue 32, 524 until the C8.5 fix of issue 31, 516 until C8.6, 495 until C8.5, 485 until C8.4b, 472 until C8.4a, 30 until C4.1, 156 until C5.1, 263 until C6.1, 268 until C6.2, 339 until C7.1, 346 until C7.2, 368 until C7.3, 400 until C7.4, 409 until C8.1, 433 until C8.2, 466 until C8.3) |
| `npm --prefix frontend run lint` | fails: 4 errors, 0 warnings in existing code (6 until C13.8b, 7 until C13.7a, 8 until C13.6a, 12 errors and 2 warnings until C13.5a, 13 until the C13.5 auto-submit fix, 17 until C13.3a, 18 until C13.1b, 19 until C12.5a, 20 until C12.3b, 21 until C10.6, 22 until C10.5b) |
| `npm --prefix frontend run build` | passes |
| `python -c "import backend.main"` | passes |
| `pytest tools/repo_graph/tests -q` | passes: 62 tests (61 until C8.5) |
| `npm --prefix frontend run check:contrast` | passes: 204 pairs across 4 theme x accent combinations, 0 failing (200 until C10.3) |
| `npm --prefix frontend run check:images` | passes: 2 rasters (36.3 KB; 1 raster, 13.1 KB, until C13.10e), 8 illustrations (7 until C13.7a), 1 `<img>`, 0 failing |
| `npm --prefix frontend run test:unit` | passes: 116 tests, 110 until C17.6, 120 until C17.5d, 114 until C17.5b, 109 until C17.4b, 99 until C17.4a, 89 until C17.3c, 83 until C17.3a, 73 until C17.2a, 70 until C17.1b, 62 until C14.2, 60 until C13.10a, 55 until C13.8a, 54 until C13.7b, 50 until C13.7a, 45 until C13.6a, 42 until C13.2a, 37 until C12.9, 27 until C12.8a, 18 until C12.7, 15 until C12.5a, 12 until C12.4 (Node's built-in runner over `frontend/src/**/*.test.js`; needs Node 22 or later) |
| `npm --prefix frontend run test:e2e` | passes: 126 tests, 124 until the C17 close, 122 until C17.6, 113 until C17.5c, 104 until C17.5b, 103 until C17.1b, 102 until the C15.1 closing-page fix, 97 until C13.10e, 94 until C13.10d, 90 until C13.10c, 87 until C13.10b, 82 until C13.10a, 77 until C13.9, 74 until C13.8b, 67 until C13.8a, 64 until C13.7c, 62 until C13.7b, 58 until C13.7a, 56 until C13.6b, 50 until C13.6a, 48 until C13.5b, 42 until C13.5a, 41 until the C13.5 auto-submit fix, 37 until C13.4, 36 until the C13.4 Start test fix, 32 until C13.3c, 27 until C13.3b, 22 until C13.3a, 18 until C13.2b, 14 until C13.2a, 8 until C13.1b (Playwright on the installed Microsoft Edge, no browser download; builds the app (since C13.10e the build also prerenders the landing page) and serves it with `vite preview` on port 4174, every API call mocked; about 90 s; port 4174 must be free) |

Until a chunk brings ruff and ESLint to zero, "never commit failing checks"
means: the eight passing checks stay green and the two error counts never go
up. Update this table when a baseline changes, and the matching
`RUFF_BASELINE` and `ESLINT_*_BASELINE` values in `.github/workflows/ci.yml`,
which fails a push whose ruff or ESLint count rises above them.

pytest runs offline (`backend/tests/conftest.py` blocks every non-loopback
connection) and e2e mocks every API call and fakes or aborts every Supabase
request (`frontend/e2e/fixtures.js`), so the standard checks never touch
the Supabase project and need no approval under constraint 2.

## Commit format

```
<type>(<scope>): <subject>

Chunk: C<n>.<m>

What:
- what changed, file by file

Why:
- the reason for the change

How verified:
- the exact commands run and what they returned

Notes:
- caveats, follow-ups, anything left untouched on purpose
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. One subchunk per
commit. No amending or force-pushing shared branches.

## Project skills

Project skills live in `.claude/skills/<name>/SKILL.md`.

| Skill | Use it for | Status |
|---|---|---|
| `atomic-commit` | Staging, commit size and the commit format above | added in C1.2 |
| `debug-protocol` | The ten-step failure procedure and `docs/DEBUG_LOG.md` | added in C1.3 |
| `repo-graph` | Looking up a file's neighbours before editing; regenerating the graph | added in C1.4, tooling in C2 |
| `free-intelligence` | Any feature that needs "AI": enforces constraints 1 and 5 | added in C1.5, Steve exception in C16.2 |
| `steve-guardrails` | Any code that calls Gemini or builds Steve's prompts, context or UI | added in C16.2 |
| `design-review` | The gate every frontend change passes | added in C1.6 |
| `impeccable` | UI design, critique and polish | installed locally |
| `design-taste-frontend` | UI work; this is the installed name of `taste-skill` | installed locally |
| `ui-ux-pro-max` | UI palettes, type, layout and UX guidelines | installed locally |

The three design skills were installed in C0.3 and are not committed, so a
fresh clone has to reinstall them.

## Docs

- `docs/PROGRESS.md`: one row per subchunk (added in C1.7).
- `docs/DEBUG_LOG.md`: one entry per failure (added in C1.7).
- `docs/repo-graph/`: generated repo graph (added in C2).
- `docs/BENCHMARKS.md`: measured numbers with their commands (added in C3.4).
- `README.md`: product overview, how it works, local setup, checks and
  limitations; rewritten for 2.0 in C15.4.
- `docs/ARCHITECTURE.md`: agents and their contracts, the agent graph,
  event flows, data model, reader and word lookup (added in C15.4).
- `progress.md` (repo root): the pre-2.0 tracker, kept for history only.
