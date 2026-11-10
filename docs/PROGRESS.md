# ReadFocus 2.0 — progress

One row per subchunk, added when the subchunk is committed. This file
supersedes the pre-2.0 tracker at `progress.md` in the repo root, which is
kept for history only.

## How to use

- Tick a step with `[x]` in the same commit that completes it.
- **Commit**: the short hash. A row cannot contain its own commit's hash, so
  write `this commit` and replace it with the hash in the next commit that
  touches this file.
- **Change**: one line, what is different now.
- **Verified by**: the commands that were actually run and their result.
- **Time**: commit time, local, `YYYY-MM-DD HH:MM`.
- **Open issues**: anything left unresolved, or `none`.
- A step with no record is marked `[?]`. Do not tick it without evidence.

## Open issues carried forward

| # | Issue | Found in | Owner chunk |
|---|---|---|---|
| 1 | `ruff check backend/` fails with 84 errors in pre-2.0 code. CI runs it on every push, so the lint job is presumably red. | C1.1 | unassigned |
| 2 | `npm --prefix frontend run lint` fails with 22 errors and 2 warnings in pre-2.0 code. | C1.1 | unassigned |
| 3 | The three design skills, `.claude/agents/` and `skills-lock.json` are untracked; a fresh clone does not have them, and `design-review` depends on them. `skills-lock.json` lists only `design-taste-frontend`. | C1 start | unassigned |
| 4 | Python versions disagree: `.venv` 3.11, CI 3.12, `pyrightconfig.json` 3.14. | C1.1 | unassigned |
| 5 | `README.md` still describes the Groq and Google AI Studio setup. | C1.1 | unassigned |
| 6 | `backend/services/llm.py`, `backend/services/embeddings.py` and three packages in `requirements.txt` use banned providers (hard constraint 1). `.env.example` marks the two keys "to be removed in C8". | C0.4, C1.5 | C8 |
| 7 | `CLAUDE.md` lists commit types without `perf` and `merge`, which the `atomic-commit` skill adds. | C1.2 | unassigned |
| 8 | No motion tokens, no `prefers-reduced-motion` rule, and `transition: all` in 3 stylesheets under `frontend/src`. | C1.6 | unassigned |
| 9 | C0.1, C0.2 and C0.5 have no record; chunk titles for C3–C7 and C9–C15 are not filled in. Both need the promptbook. | C1.7 | user |
| 10 | `backend/dependencies.py` accepts any raw UUID as a bearer token and returns it as the user id, in every environment. With the service-role client behind it, anyone who knows a user id can act as that user. | C2.1 | unassigned |
| 11 | `frontend/src/lib/supabase.js` falls back to a hard-coded Supabase project URL and publishable key when the env vars are unset. Which project it points at is not confirmed. | C2.1 | unassigned |
| 12 | The eight root `test_*.py` files are manual scripts, not tests: hard-coded ids, live LLM calls, `test_ingest.py` runs at import, `test_orchestrator.py` imports a function that does not exist. `pytest` from the repo root would collect them. | C2.1 | unassigned |
| 13 | Dead or stale files: `frontend/src/App.css`, `hero.png`, `react.svg`, `vite.svg` and `icons.svg` are not referenced; `Card.jsx` is unused; `backend/routers/agent.py` has no endpoints; `backend/mcp_server.py` is started but never called; `backend/requirements.txt` differs from the root file and is unused; `render.yaml` declares Cerebras and SambaNova keys. | C2.1 | unassigned |
| 14 | Three endpoints have no frontend caller: `GET /books/{book_id}/status` (Library polls `GET /books` instead), `POST /sessions/{session_id}/abandon` (the Abandon button only navigates away, so the session stays `reading`), and `GET /health`, which is expected. | C2.2a | unassigned |

## C0 — setup

C0 ran before this tracker existed. The log below is reconstructed from the
two C0 commits on `readfocus-2.0` and from the C0.3 prompt. Steps with no
commit and no other record are marked `[?]`.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|
| [?] C0.1 | none found | No record. `readfocus-2.0` exists and branches from `main` at `ba1b734`, which suggests the sprint branch was created here. | not recorded | not recorded | Needs the promptbook or the C0 notes |
| [?] C0.2 | none found | No record. | not recorded | not recorded | Needs the promptbook or the C0 notes |
| [x] C0.3 | none (no commit by design) | Installed three design skills at project level: `impeccable` (v4.8.2), `design-taste-frontend` (taste-skill 2.5.1), `ui-ux-pro-max`. | Each `SKILL.md` found on disk under `.claude/skills/` and loaded in the C1 session. | not recorded | Issue 3 |
| [x] C0.4 | `1f0d979` | Added `.env.example` and `frontend/.env.example`; `.gitignore` now ignores `.cache/` and the Impeccable binary. | `git check-ignore -v` on `.env`, `frontend/.env` and `.cache/fastembed/x` (per the commit message). | 2026-11-10 06:31 | Issue 6 |
| [?] C0.5 | none found | No record. | not recorded | not recorded | Needs the promptbook or the C0 notes |
| [x] C0.6 | `46280bb` | Added `scripts/dev/create_test_users.py`, which creates or resets two confirmed dev test users and writes `.env.test`. | Ran twice against the dev project; signed in as each user under RLS; `ruff check` on the script; smoke test `GET /health` 200 and Vite on 5173 (per the commit message). | 2026-11-10 06:45 | none |

## C1 — guardrails, Agent Skills and project memory

Branch `chunk/C1-guardrails`. Every C1 commit re-ran the five standard
checks; results matched the baseline in `CLAUDE.md` each time (ruff 84
errors, pytest 8 passed, lint 22 errors and 2 warnings, build passes, import
passes). No application code changed in C1.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|
| [x] C1.1 | `d843ac8` | Added `CLAUDE.md`: goal, hard constraints, working method, stack, branch model, commands, commit format, skills list. | `make dev-backend` (`/health` 200), `make dev-frontend` (200 on 5173), the five standard checks. | 2026-11-10 06:54 | Issues 1, 2, 4, 5 |
| [x] C1.2 | `dfcdc3a` | Added the `atomic-commit` skill. | Listed in the session's skills; frontmatter parsed; standard checks. | 2026-11-10 06:57 | Issue 7 |
| [x] C1.3 | `a94bb52` | Added the `debug-protocol` skill. | Listed in the session's skills; frontmatter parsed; standard checks. Its git commands were not exercised. | 2026-11-10 06:59 | none |
| [x] C1.4 | `a97aead` | Added the `repo-graph` skill (definition only). | Listed in the session's skills; cited paths checked; standard checks. `make graph` and `query.py` do not exist until C2. | 2026-11-10 07:01 | File descriptions are provisional until C2 |
| [x] C1.5 | `d0e9448` | Added the `free-intelligence` skill. | Listed in the session's skills; its grep and three Python snippets executed; standard checks. | 2026-11-10 07:03 | Issue 6; `fastembed`, `yake`, `scikit-learn`, `rapidfuzz` not installed |
| [x] C1.6 | `5c7381b` | Added the `design-review` skill. | Listed in the session's skills; frontend gaps measured with grep; standard checks. The review chain was not run. | 2026-11-10 07:06 | Issues 3, 8 |
| [x] C1.7 | `1ba0be2` | Added `docs/PROGRESS.md` and `docs/DEBUG_LOG.md`. | Hashes and times checked against `git log`; standard checks. | 2026-11-10 07:09 | Issue 9 |

C1 was merged into `readfocus-2.0` as `7a3327f` (2026-11-10 07:10);
`origin/readfocus-2.0` contains it.

## C2 — repo graph

Branch `chunk/C2-repo-graph`. Full-repo read, then a machine-readable graph
and a human-readable map. No application code changes in this chunk: nothing
under `backend/`, `frontend/`, `supabase/` or `scripts/` is edited, and the
root `test_*.py` files stay as they are.

### Scope of the read

`git ls-files` lists 110 files. 102 are read in full (8,631 lines). Excluded:

| Excluded | Reason |
|---|---|
| `frontend/public/favicon.svg`, `frontend/public/icons.svg`, `frontend/src/assets/react.svg`, `frontend/src/assets/vite.svg` | binary/asset (`*.svg`) |
| `frontend/src/assets/hero.png` | binary (`*.png`) |
| `sample.pdf` | binary (`*.pdf`) |
| `package-lock.json`, `frontend/package-lock.json` | lockfile |

### Plan (written at chunk start, before any code)

Design decisions that apply to every subchunk:

- Standard library only, Python 3.11 syntax. No new dependency, so no RSS
  measurement is needed (constraint 5).
- Code in `tools/repo_graph/`, tests in `tools/repo_graph/tests/`, run with
  `pytest tools/repo_graph/tests -q`. This becomes a sixth standard check in
  `CLAUDE.md` in C2.4.
- Generated output in `docs/repo-graph/` is deterministic: sorted keys and
  lists, POSIX paths, LF newlines, no timestamps or absolute paths. That is
  what makes the C2.6 freshness check possible across Windows and CI.
- Estimated lines are hand-written lines, tests included. Generated files do
  not count towards the ~200-line limit.

| Step | Files | Est. lines | Tests | Est. time |
|---|---|---|---|---|
| C2.1 file inventory and full read | `tools/__init__.py`, `tools/repo_graph/__init__.py`, `tools/repo_graph/inventory.py` (lists `git ls-files`, assigns language and role, measures lines and size, applies the exclusion rules), `tools/repo_graph/purposes.json` (one hand-written line per file, written after reading it), `tools/repo_graph/tests/`; generates `docs/repo-graph/inventory.json`. Done as one commit at the user's request (planned as C2.1a and C2.1b) | 386 actual, 110 of them `purposes.json` | 7 test functions, 35 cases: role, language and exclusion rules; CRLF-safe measuring; sorting and counts; missing and stale purposes rejected; real inventory complete and byte-identical on a second run | 60 min |
| C2.2a graph core: files, imports, endpoints | `tools/repo_graph/build.py` (file nodes from the inventory; `imports` via `ast` for Python and regex for JS/JSX; `defines_endpoint` from FastAPI decorators and `include_router` prefixes; `calls_endpoint` from `fetchApi` calls; validation; unresolved list), `tools/repo_graph/tests/test_build.py` (in-memory fixture repo); generates `docs/repo-graph/graph.json`. Replanned from the C2.2 prompt: one `build.py` instead of five modules, two commits instead of three | 375 actual (246 code, 129 tests) | 7: file nodes carry roles; Python imports incl. relative and lazy; JS imports incl. unresolved; prefix + path joined; method and path matched; valid, sorted, deterministic; real graph has every router and page | 50 min |
| C2.2b data, env, external and LangGraph edges | `tools/repo_graph/build.py` (`reads_table` / `writes_table`, `calls_function`, migration `defines_table` / `alters_table` / `defines_function`, `uses_env` / `declares_env`, `calls_external`, `graph_node` / `graph_edge`), `tools/repo_graph/tests/test_build.py` | 200 | 6: select is a read, insert/update/upsert/delete are writes; rpc is a function call; migrations define and alter; env read and declared; banned provider flagged; LangGraph nodes and edges incl. conditional | 40 min |
| C2.3 readable maps | `tools/repo_graph/render.py`, `tools/repo_graph/tests/test_render.py`; generates `docs/repo-graph/REPO_MAP.md` (files by area with description, imports and imported-by; endpoint table with handler and frontend callers; table-usage matrix; excluded files) and `docs/repo-graph/AGENT_GRAPH.md` (Mermaid diagram plus a node table) | 180 | 4: every inventoried file appears once; endpoint table matches the graph; table matrix matches the graph; Mermaid block has one line per agent edge | 30 min |
| C2.4 query CLI and `make graph` | `tools/repo_graph/query.py` (accepts a file, an endpoint path or a table name; prints upstream, downstream, endpoints, tables, agents; non-zero exit on unknown target), `tools/repo_graph/tests/test_query.py`, `Makefile` (`graph` target), `CLAUDE.md` (drop "arrive in C2", add the sixth check), `.claude/skills/repo-graph/SKILL.md` and `.claude/skills/debug-protocol/SKILL.md` (remove the manual-fallback status, confirm command shapes) | 190 | 5: file query; endpoint query; table query; unknown target exits 2 with a message; Windows backslash path is accepted | 30 min |
| C2.5 migration audit | `docs/AUDIT.md`, hand-written from the read and the graph: (1) schema audit of migrations 001–004, tables, columns, RLS and pgvector, against the tables and columns the code uses; (2) the 2.0 migration list: every file that calls a banned provider and what replaces it; (3) dead or misplaced files, such as the eight root `test_*.py`; (4) which open issues each finding belongs to. `tools/repo_graph/audit.py` and a test back the mechanical parts | 200 (120 prose, 80 code and test) | 3: table used in code but absent from migrations is reported; table in migrations never used is reported; tracked file with no inbound edge and no entry-point role is reported | 45 min |
| C2.6 graph freshness in CI | `tools/repo_graph/build.py` (`--check`: rebuild in memory, exit 1 and name the stale files if `docs/repo-graph/` differs), `tools/repo_graph/tests/test_check.py`, `.github/workflows/ci.yml` (new `graph` job: `python -m tools.repo_graph.build --check` and `pytest tools/repo_graph/tests -q`; `deploy-render` also needs it) | 90 | 3: fresh graph exits 0; modified graph exits 1 and names the file; missing graph file exits 1 | 20 min |
| C2.G 🚦 Gate G1: audit approval | No new files. Present `docs/AUDIT.md` and `docs/repo-graph/REPO_MAP.md` to the user and stop. Merge into `readfocus-2.0` only after approval | 0 | Standard checks plus `make graph` leaving `git status --short docs/repo-graph/` empty | user |

Total: about 1,800 hand-written lines in 8 commits, about 5.5 hours.

Safe to cut, in this order: `AGENT_GRAPH.md` Mermaid diagram (keep the node
table); frontend `calls_endpoint` edges; the `audit.py` helper (keep the
prose audit); C2.6 as a CI job (keep `--check` for local use).

Risks and open questions:

- `core.autocrlf` is `true` on this machine. Generated files are written
  with LF and the freshness check must compare normalised content, or it
  will pass locally and fail in CI.
- The CI `lint` job is already red (issue 1). The new `graph` job is
  separate, so its result stays readable. Whether `deploy-render` should
  depend on it is the user's call; the plan assumes yes.
- "Migration audit" is read here as the audit Gate G1 approves: the Supabase
  schema plus the list of code that has to move off banned providers. It
  compares migrations with code only. Comparing with the live dev database
  needs a read-only query against it and is not planned unless asked for.
- `python tools/repo_graph/query.py <file>` (script form, as `CLAUDE.md`
  writes it) and `python -m tools.repo_graph.build` (module form) both have
  to work; `query.py` handles its own import path.

### Log

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|
| [x] C2.1 file inventory and full read | `8394912` | Read all 102 non-excluded tracked files; added `tools/repo_graph/inventory.py`, `purposes.json` and tests; generated `docs/repo-graph/inventory.json` (path, language, lines, size, role, purpose). | `python tools/repo_graph/inventory.py`: 117 tracked = 108 inventoried + 9 excluded, equal to `git ls-files \| wc -l`; `pytest tools/repo_graph/tests -q`: 35 passed; standard checks at baseline. | 2026-11-10 07:21 | Issues 10-13 |
| [x] C2.2a graph core: files, imports, endpoints | this commit | Added `tools/repo_graph/build.py` and its tests; generated `docs/repo-graph/graph.json` with file and endpoint nodes and `imports`, `defines_endpoint`, `calls_endpoint` edges. | Tests written first and seen failing (collection error, no `build` module). `python tools/repo_graph/build.py`: 125 nodes (110 files, 15 endpoints), 137 edges, 0 unresolved; `pytest tools/repo_graph/tests -q`: 42 passed; standard checks at baseline. | see `git log` | Issue 14 |
| [ ] C2.2b data, env, external and LangGraph edges | | | | | |
| [ ] C2.3 readable maps | | | | | |
| [ ] C2.4 query CLI and `make graph` | | | | | |
| [ ] C2.5 migration audit | | | | | |
| [ ] C2.6 graph freshness in CI | | | | | |
| [ ] C2.G 🚦 Gate G1: audit approval | | | | | |

## C3

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C4

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C5

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C6

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C7

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C8

Removes `GROQ_API_KEY` and `GOOGLE_AI_STUDIO_KEY` (per `.env.example`). Full
title and subchunks to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C9

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C10

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C11

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C12

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C13

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C14

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

## C15

Title to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|
