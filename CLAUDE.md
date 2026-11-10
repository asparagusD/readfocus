# ReadFocus 2.0 — project rules

ReadFocus is a book comprehension app: upload a PDF or EPUB, read it in paced
sessions, take a short test after each one, and the next session adapts to
your score.

## Product goal

- **Intelligent**: planning, question generation, grading and pacing adapt to
  the reader.
- **Blazing fast**: no waiting on remote model calls.
- **$0 API cost**: all intelligence is algorithmic or runs on local models.
- **Cozy and sophisticated UI** that feels like reading a real book.
- Built in a **27-hour sprint**, split into chunks (C0, C1, ...) and
  subchunks (C1.1, C1.2, ...).

## Hard constraints

1. No LLM or embedding API calls of any kind (Groq, OpenAI, Anthropic,
   Gemini/Google AI, Cerebras, SambaNova, OpenRouter). No paid services. No
   payment methods.
2. Supabase migrations are additive only. Never drop tables or columns. Work
   on the dev database; never touch production without explicit approval.
3. Never claim something works unless it was run. Never invent file paths.
4. Secrets never go in git or the frontend bundle. The service-role key stays
   server-side.
5. Render Free has tight RAM/CPU: measure memory (psutil RSS) before adding
   any model or heavy dependency.

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
- **Debug protocol** on any failure:
  1. Log the exact command, error and stack trace in `docs/DEBUG_LOG.md`.
  2. Reproduce with the smallest failing command or test.
  3. Read the failing file's upstream and downstream files via the repo graph.
  4. Write 1–3 ranked hypotheses with evidence.
  5. Test one at a time.
  6. Make the minimal root-cause fix.
  7. Add a regression test that fails before and passes after.
  8. Re-run the standard checks.
  9. Record the root cause; commit as `fix(<scope>): ...`.
  10. After 3 failed attempts, stop, restore the last green state, and report.
- **Progress.** Tick each subchunk in `docs/PROGRESS.md`
  (Step | Commit | Change | Verified by | Time | Open issues).
- **Ask, don't assume** before anything irreversible, touching production
  data, or removing user-facing features.
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
| Word lookup | Free Dictionary API and Wikipedia |
| Hosting | Render Free (backend), Vercel (frontend) |

This is the 2.0 target. Until the migration chunks land, `backend/services/`
still calls Groq and Google AI Studio; that code is being removed, not
extended (constraint 1).

Python versions disagree across the repo: `.venv` is 3.11, CI installs 3.12,
`pyrightconfig.json` says 3.14. Write code that runs on 3.11.

## Branch model

- `readfocus-2.0` is the sprint branch.
- Each chunk gets `chunk/C<n>-<slug>`, created from `readfocus-2.0`.
- When a chunk is done, merge it back with `git merge --no-ff`.
- `main` is touched only at release: CI deploys to Render on every push to
  `main`.

## Run commands

Activate the virtualenv first; `uvicorn`, `ruff` and `pytest` live in `.venv`
and are not on PATH otherwise.

```powershell
.\.venv\Scripts\Activate.ps1
```

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
```

Baseline when this file was written (C1.1; the last row was added in C2.4):

| Check | Result |
|---|---|
| `ruff check backend/` | fails: 36 errors in existing code (40 until C8.5, 84 until C3.4, 83 until C4.5, 82 until C5.5, 81 until C6.4, 64 until C8.3, 63 until C8.4a, 48 until C8.4b) |
| `pytest backend/tests -q` | passes: 524 tests, offline (516 until C8.6, 495 until C8.5, 485 until C8.4b, 472 until C8.4a, 30 until C4.1, 156 until C5.1, 263 until C6.1, 268 until C6.2, 339 until C7.1, 346 until C7.2, 368 until C7.3, 400 until C7.4, 409 until C8.1, 433 until C8.2, 466 until C8.3) |
| `npm --prefix frontend run lint` | fails: 22 errors, 2 warnings in existing code |
| `npm --prefix frontend run build` | passes |
| `python -c "import backend.main"` | passes |
| `pytest tools/repo_graph/tests -q` | passes: 62 tests (61 until C8.5) |

Until a chunk brings ruff and ESLint to zero, "never commit failing checks"
means: the four passing checks stay green and the two error counts never go
up. Update this table when a baseline changes.

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
| `free-intelligence` | Any feature that needs "AI": enforces constraints 1 and 5 | added in C1.5 |
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
- `README.md`: product overview. It still describes the pre-2.0 LLM setup.
- `progress.md` (repo root): the pre-2.0 tracker, kept for history only.
