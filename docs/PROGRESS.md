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
| 9 | C0.1, C0.2 and C0.5 have no record; chunk titles for C4–C7 and C9–C15 are not filled in. Both need the promptbook. | C1.7 | user |
| 10 | `backend/dependencies.py` accepts any raw UUID as a bearer token and returns it as the user id, in every environment. With the service-role client behind it, anyone who knows a user id can act as that user. **Closed in C3.1.** | C2.1 | C3 |
| 11 | `frontend/src/lib/supabase.js` falls back to a hard-coded Supabase project URL and publishable key when the env vars are unset. Which project it points at is not confirmed. | C2.1 | unassigned |
| 12 | The eight root `test_*.py` files are manual scripts, not tests: hard-coded ids, live LLM calls, `test_ingest.py` runs at import, `test_orchestrator.py` imports a function that does not exist. `pytest` from the repo root would collect them. **Moved to `scripts/manual/` in C3.3; `pytest.ini` keeps them out of collection.** | C2.1 | C3 |
| 13 | Dead or stale files: `frontend/src/App.css`, `hero.png`, `react.svg`, `vite.svg` and `icons.svg` are not referenced; `Card.jsx` is unused; `backend/routers/agent.py` has no endpoints; `backend/mcp_server.py` is started but never called; `backend/requirements.txt` differs from the root file and is unused (deleted in C3.2); `render.yaml` declares Cerebras and SambaNova keys. | C2.1 | unassigned |
| 14 | Three endpoints have no frontend caller: `GET /books/{book_id}/status` (Library polls `GET /books` instead), `POST /sessions/{session_id}/abandon` (the Abandon button only navigates away, so the session stays `reading`), and `GET /health`, which is expected. | C2.2a | unassigned |
| 15 | The graph does not see three things: `backend/main.py` starting `backend/mcp_server.py` through `subprocess` (a path string, not an import), Supabase Storage bucket use (`storage.from_("books")`), and which columns each query touches. `FASTEMBED_CACHE`, `CEREBRAS_API_KEY` and `SAMBANOVA_API_KEY` are declared but read by no code. | C2.2b | unassigned |
| 16 | `reading_progress` is never populated: no code inserts a row, and the dev database has 0 rows against 21 completed sessions. Every session plans from chunk 0; re-read, averages and pacing are never stored. `docs/MIGRATION_AUDIT.md` section 5. | C2.5 | unassigned |
| 17 | `POST /sessions/start` does not check that the book belongs to the caller, so it returns another user's chunk text for a known `book_id`. From the code; not exercised. Audit section 8. | C2.5 | unassigned |
| 18 | A failed LLM grade is recorded as 10/10; auto-submit at zero sends blank answers (from the code, not reproduced); `GET /sessions/{id}` returns the hidden `guidance`; recorded test time is always 180 s. Audit section 9. | C2.5 | unassigned |
| 19 | The CI test job presumably fails on every push: `backend.main` cannot be imported without Supabase config and the workflow supplies none. Not confirmed on GitHub. Audit section 8. **C3.3: the suite now runs with no config (`backend/tests/conftest.py`); still not observed on GitHub.** | C2.5 | C3 |
| 20 | Stuck rows in the dev database: 1 of 8 books `processing`, 39 of 72 sessions `reading`, 12 `testing`, none `abandoned`. Audit section 6. | C2.5 | unassigned |
| 21 | `make graph` reads `git ls-files` and the working tree, so the two must agree. A tracked file deleted without `git rm` makes `inventory.py` stop with a `FileNotFoundError` traceback, and a new file that is not yet `git add`-ed is silently left out of the graph. Workaround: stage additions and deletions before `make graph`. CI is unaffected (clean checkout). Found in the C2 close review; not blocking. | C2 close | unassigned |
| 22 | Every Groq call fails with `404 model_not_found` for `llama-3.3-70b-versatile` using the key in `.env`, and the app hides it: canned plan, generic questions, 10/10 for every answer, fallback pace. Readers on this configuration get no real planning or grading today. Whether production has the same key or model access is not known. Not fixed: the code is removed in C8 (issue 6). `docs/BENCHMARKS.md`, Baseline. | C3.5 | C8 |
| 23 | The test generator's prompt has unescaped braces (`{0,1}`, `{z }`), so `ChatPromptTemplate` raises "missing variables" before any LLM request and the generic fallback questions are always returned. Seen in the server log during the benchmark; the prompt file was not inspected further. Not fixed, same reason as issue 22. | C3.5 | C8 |

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
| C2.2b data, env, external and LangGraph edges | `tools/repo_graph/build.py` (`reads_table` / `writes_table`, `calls_function`, migration `defines_table` / `alters_table` / `defines_function`, `uses_env` / `declares_env`, `calls_external`, `graph_node` / `graph_edge`), `tools/repo_graph/tests/test_build.py` | 200 | 6: select is a read, insert/update/upsert/delete are writes; rpc is a function call; migrations define and alter; env read and declared; banned provider flagged; LangGraph nodes and edges incl. conditional. Actual: 256 lines (146 code, 110 tests) | 40 min |
| C2.3 repository map with diagrams | `tools/repo_graph/render.py`, `tools/repo_graph/tests/test_render.py`, small change to `build.py` (line numbers on `calls_external`); generates `docs/repo-graph/REPO_MAP.md` with a Mermaid layer diagram, a Mermaid LangGraph diagram, and tables for endpoints, tables, functions, external services (file:line), env vars and files. The LangGraph diagram lives in `REPO_MAP.md`, so no separate `AGENT_GRAPH.md` | 325 actual (227 render, 71 tests, 27 build) | 5 in `test_render.py`: request path links; conditional edges; lookup rows; every file listed once; real map has two diagrams and is deterministic | 40 min |
| C2.4 query CLI and `make graph` | `tools/repo_graph/query.py` (file, endpoint, table, function, env var, service or LangGraph node; both directions of every edge type; exit 2 with suggestions on no match), `tools/repo_graph/tests/test_query.py`, `Makefile` (`graph` target), `CLAUDE.md` (sixth standard check, stale note removed), three skills updated | 320 actual (164 query, 81 tests, about 75 in docs and Makefile) | 6: both directions for a file; endpoint with and without method; table and other names; Windows and dotted paths; unknown target exits 2; real graph lists every agent that uses `llm.py` | 35 min |
| C2.5 migration audit | `docs/MIGRATION_AUDIT.md`, hand-written from the read, the graph and read-only probes. No `audit.py` helper: the prompt asked for the document only | 364 lines of prose | none (documentation) | 50 min |
| C2.6 graph freshness in CI | `.github/workflows/ci.yml` (new `graph` job: `make graph`, `git diff --exit-code docs/repo-graph/`, tooling tests). No `--check` flag in `build.py`: the prompt asked for `make graph` plus `git diff` | 27 | none added; the job runs the existing 61 | 15 min |
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
  separate, so its result stays readable. `deploy-render` was left as it
  is and does not depend on the new job; adding it is the user's call.
- "Migration audit" is read here as the audit Gate G1 approves: the Supabase
  schema plus the list of code that has to move off banned providers. It
  compares migrations with code only. Comparing with the live dev database
  needs a read-only query against it and is not planned unless asked for.
- `python tools/repo_graph/query.py <file>` (script form, as `CLAUDE.md`
  writes it) and `python -m tools.repo_graph.build` (module form) both have
  to work; `query.py` handles its own import path.

**G1: PASS (approved 2026-11-10).**

### Log

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|
| [x] C2.1 file inventory and full read | `8394912` | Read all 102 non-excluded tracked files; added `tools/repo_graph/inventory.py`, `purposes.json` and tests; generated `docs/repo-graph/inventory.json` (path, language, lines, size, role, purpose). | `python tools/repo_graph/inventory.py`: 117 tracked = 108 inventoried + 9 excluded, equal to `git ls-files \| wc -l`; `pytest tools/repo_graph/tests -q`: 35 passed; standard checks at baseline. | 2026-11-10 07:21 | Issues 10-13 |
| [x] C2.2a graph core: files, imports, endpoints | `cfd3fab` | Added `tools/repo_graph/build.py` and its tests; generated `docs/repo-graph/graph.json` with file and endpoint nodes and `imports`, `defines_endpoint`, `calls_endpoint` edges. | Tests written first and seen failing (collection error, no `build` module). `python tools/repo_graph/build.py`: 125 nodes (110 files, 15 endpoints), 137 edges, 0 unresolved; `pytest tools/repo_graph/tests -q`: 42 passed; standard checks at baseline. | 2026-11-10 07:30 | Issue 14 |
| [x] C2.2b data, env, external and LangGraph edges | `6b8977a` | `graph.json` now has table, function, env, external and graph_node nodes and eleven more edge types, including which providers are banned. | Tests written first: 6 failed, then 48 passed. `python tools/repo_graph/build.py`: 159 nodes, 244 edges, 0 unresolved; new edges checked by eye against the C2.1 read; standard checks at baseline. | 2026-11-10 07:34 | Issue 15; one `docs/DEBUG_LOG.md` entry |
| [x] C2.1 fix: role of `test_generator_agent.py` | `4809127` | `inventory.role()` gave `backend/agents/test_generator_agent.py` the role `test` because of its name; it is now `agent`. Found while rendering the map in C2.3. | Regression cases failed before (2 failed, 35 passed) and pass after; `inventory.json` and `graph.json` regenerated, the only change is that file's role; standard checks at baseline. | 2026-11-10 07:40 | none; `docs/DEBUG_LOG.md` entry |
| [x] C2.3 repository map with diagrams | `822c2e2` | Added `tools/repo_graph/render.py` and tests; generated `docs/repo-graph/REPO_MAP.md` (layer diagram, LangGraph diagram, six lookup tables, file list). `calls_external` edges now carry the line of first use. | `npx -y @mermaid-js/mermaid-cli -i docs/repo-graph/REPO_MAP.md`: 2 charts found, both rendered, exit 0; `pytest tools/repo_graph/tests -q`: 55 passed; standard checks at baseline. | 2026-11-10 07:43 | `AGENT_GRAPH.md` is not generated |
| [x] C2.4 query CLI and `make graph` | `60ddce8` | Added `tools/repo_graph/query.py` and tests, the `graph` Makefile target, and a sixth standard check; `CLAUDE.md` and the repo-graph, atomic-commit and debug-protocol skills no longer say the tooling is missing. | `python tools/repo_graph/query.py backend/services/llm.py` lists the four agents that import it; `make graph` run three times, no diff in `docs/repo-graph/` after the second and third; `pytest tools/repo_graph/tests -q`: 61 passed; other checks at baseline. | 2026-11-10 07:52 | Git Bash rewrites a bare `/path` argument; documented |
| [x] C2.5 migration audit | `c49dac4` | Added `docs/MIGRATION_AUDIT.md`: a verdict with evidence on each of the eight suspected issues, plus architecture, feature map, LLM and embedding calls with file:line, schema and RLS, background tasks, dead code, security, must-not-regress list, risks and files likely to change. | Line references spot-checked with `sed`; `pip show`, an import with `SUPABASE_URL` empty, RSS with `psutil`, and read-only row counts on the dev database (ENV=development); `make graph` twice, no diff; six standard checks at baseline. | 2026-11-10 08:02 | Issues 16-20 |
| [x] C2.6 graph freshness in CI | `e30748b` | Added a `graph` job to `.github/workflows/ci.yml`: `make graph`, then `git diff --exit-code docs/repo-graph/`, then the tooling tests. | Workflow parsed with PyYAML. The job's commands run in a fresh clone with `core.autocrlf=false` (all files LF, as on the runner): no diff on Python 3.14 and 3.11, 61 tests passed, and exit 1 after a deliberate edit. Six standard checks at baseline. | 2026-11-10 08:06 | Not run on GitHub; `deploy-render` does not depend on the new job |
| [x] C2.G 🚦 Gate G1: audit approval | `35df766` | **G1: PASS (approved 2026-11-10)**. The user reviewed the two `REPO_MAP.md` diagrams, the audit's security, must-not-regress and risks sections, the file counts, the exclusions and the eight verdicts, and approved with no corrections. | Approval given by the user in the session ("Approve G1"). `make graph` twice, no diff; six standard checks at baseline. | 2026-11-10 08:13 | Issues 10-20 stay open for later chunks |

Close review (2026-11-10): `git diff readfocus-2.0...HEAD` touches 24 files, none under `backend/`, `frontend/`, `supabase/` or `scripts/` and none of the root scripts or deploy files. No blocking findings; one non-blocking finding logged as issue 21. Time: about 1 h 5 min of wall-clock, from the C1 merge at 07:10 to this review at 08:16, against 1.5 h budgeted.

## C3 — stabilize

Branch `chunk/C3-stabilize`, created from `readfocus-2.0` at `052c9af`.
Goal: the current app runs locally, the critical security and dependency
issues are fixed, and a baseline is recorded. Behaviour does not change
except for the fixes: the LLM and embedding code stays as it is until its
own chunks (issue 6), and nothing under `frontend/src` or
`supabase/migrations/` is edited.

### Plan (written at chunk start, before any code)

Design decisions that apply to every subchunk:

- No new runtime dependency. `psutil` (already in `.venv`, 7.2.2) and
  `pytest` become pinned dev dependencies in C3.2.
- No call to Groq or Google AI Studio at any point, including the benchmark
  (constraint 1). Tests run with dummy keys and a fake Supabase client.
- Every new tracked file gets a line in `tools/repo_graph/purposes.json`,
  and `make graph` output is committed with the change. New files are
  `git add`-ed before `make graph` (issue 21).
- Estimated lines are hand-written lines, tests included; lockfiles and
  `docs/repo-graph/` do not count.

| Step | Files | Est. lines | Tests | Est. time |
|---|---|---|---|---|
| C3.1 remove the raw-UUID auth bypass (issue 10) | `backend/dependencies.py` (delete lines 13-18, the 36-character check; the JWT path and its error text are untouched), `backend/tests/test_auth.py` (new), `docs/DEBUG_LOG.md` (entry, since this is a `fix`), `tools/repo_graph/purposes.json` | 75 (-6 code, 55 tests, 15 log, 2 purposes); actual 127 (-8 code, 74 tests, 42 log, 3 purposes) | 4 planned, 5 written, calling `get_current_user` with `supabase.auth.get_user` monkeypatched: a raw UUID is rejected with 401 (fails before, passes after); a token Supabase accepts returns that user's id; a token Supabase rejects gives 401; `get_user` raising gives 401. Needs `.env` until C3.3a makes imports offline | 20 min |
| C3.2 dependency hygiene (audit issue 2, issues 4 and 13 in part) | `requirements.txt` (add `tenacity`, imported at `backend/services/embeddings.py:20` but only installed transitively; drop `groq` and `langchain`, which no file imports; pin every line to the version in `.venv`), `requirements-dev.txt` (new: `pytest`, `ruff`, `psutil`, pinned), `backend/requirements.txt` (delete: unused duplicate), `.github/workflows/ci.yml` (install from `requirements-dev.txt`; Python 3.11 to match the Dockerfile and `.venv`), `pyrightconfig.json` (3.11), `backend/tests/test_requirements.py` (new), `tools/repo_graph/purposes.json`, `CLAUDE.md` (Python version note) | 120 (45 requirements, 50 tests, 25 config and docs) | 2: every third-party module imported under `backend/` (found with `ast`) maps to a line in `requirements.txt`; every line in both files is pinned with `==`. Plus, run by hand: install into a fresh venv in the scratchpad, `python -c "import backend.main"`, `pytest backend/tests -q`, `pip check` | 35 min |
| C3.3a offline test harness (issue 19) | `backend/tests/conftest.py` (new: sets dummy `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GROQ_API_KEY`, `GOOGLE_AI_STUDIO_KEY` before any import, which wins over `.env` because `load_dotenv` does not override; an autouse fixture that fails any socket connection to a non-loopback address), `pytest.ini` (new: `testpaths = backend/tests tools/repo_graph/tests`, so a bare `pytest` no longer collects the root scripts), `backend/tests/test_offline.py` (new), `tools/repo_graph/purposes.json` | 90 (45 conftest, 5 ini, 35 tests, 5 purposes) | 3: `backend.main` imports with no `.env` values; the guard raises on an outbound connection; the guard allows loopback (asyncio on Windows needs it). Plus, run by hand: the suite with `.env` renamed away and with the network adapter's route blocked by the guard only | 30 min |
| C3.3b endpoint tests on a fake Supabase client | `backend/tests/fakes.py` (new: in-memory stand-in for the chained `table().select().eq()...execute()` calls the routers use, and for `auth.get_user`), `backend/tests/test_api_auth.py` (new), `backend/tests/test_api_books.py` (new), `tools/repo_graph/purposes.json` | 195 (85 fake, 105 tests, 5 purposes) | About 10: each of the 14 protected endpoints returns 401 or 403 with no token and 401 with a raw UUID (parametrized, counted as 2); `GET /books` returns only the caller's rows; `GET /books/{id}` and `DELETE /books/{id}` refuse another user's book; `GET /auth/profile` returns the caller's profile; `GET /dashboard` answers for a user with no data. No test goes through an agent, so no LLM object is called | 50 min |
| C3.3c retire the root `test_*.py` scripts (issue 12) | Delete `test_evaluator.py`, `test_generator.py`, `test_graph.py`, `test_ingest.py`, `test_optimizer.py`, `test_orchestrator.py`, `test_planner.py`, `test_sessions_api.py` (328 lines); remove their eight lines from `tools/repo_graph/purposes.json`. **Needs the user's yes before it runs** | 8 hand-written, 328 deleted (deletion only, so over the ~200 limit on purpose) | none added; `pytest` with no arguments from the repo root collects only the two real suites | 10 min |
| C3.4 stop the unused MCP subprocess (issue 13 in part) | `backend/main.py` (remove the `lifespan` hook and the `subprocess`, `sys` and `asynccontextmanager` imports), `backend/mcp_server.py` (delete: nothing imports or calls it), `requirements.txt` (drop `langchain-mcp-adapters`), `backend/tests/test_startup.py` (new), `tools/repo_graph/purposes.json` | 50 hand-written (-14 `main.py`, 30 tests, 4 other), 75 deleted | 1: starting the app inside `with TestClient(app)` while `subprocess.Popen` is patched to raise does not raise (fails before, passes after). Plus, run by hand: process count and psutil RSS of `uvicorn backend.main:app` before and after; the audit measured about 73 MB for the child | 20 min |
| C3.5 baseline benchmark | `scripts/dev/benchmark.py` (new: runs each measurement in a fresh subprocess and prints a table and JSON), `backend/tests/test_benchmark.py` (new), `docs/BASELINE.md` (new: numbers, machine, date, commands), `CLAUDE.md` (baseline table updated to the new test counts), `tools/repo_graph/purposes.json` | 195 (110 script, 30 tests, 45 doc, 10 other) | 2 on the pure helpers: the median and spread of timing samples; the table formatter. Measured, each 5 runs: import time and RSS of `backend.main`; `/health` latency through `TestClient`; `chunk_text` words per second on generated text and on `sample.pdf` extraction; `pytest` wall time; `npm run build` time and `dist/` sizes; the six standard-check results. Not measured: anything that calls an LLM or the embedding API | 40 min |

Total: about 730 hand-written lines and 400 deleted, in 7 commits, about
3.5 hours.

Smoke test at chunk close ("runs locally"): `make dev-backend` with
`GET /health` 200, `make dev-frontend` with 200 on 5173, and a sign-in as a
dev test user from `.env.test` followed by `GET /books` in the browser, to
show that real JWTs still work after C3.1.

Safe to cut, in this order: C3.3b down to the 401 tests only; the
`sample.pdf` and frontend build measurements in C3.5; the Python version
alignment in C3.2; C3.3c (the `pytest.ini` from C3.3a already keeps the
scripts out of collection).

Risks and open questions:

- **C3.3c deletes eight tracked files.** They have no assertions, call the
  live LLM, and `test_sessions_api.py` stops working once C3.1 lands. The
  alternative is moving them to `scripts/manual/` unchanged. Waiting for the
  user's choice; nothing is deleted until then.
- **C3.4 deletes `backend/mcp_server.py`** as well as stopping it, as the
  audit's section 11 proposes. If the file should stay for later reuse, only
  the `main.py` change is made and `langchain-mcp-adapters` stays.
- **Order.** C3.1 comes first as asked, so its tests need `.env` to import
  the Supabase client until C3.3a lands. They touch no network: `get_user`
  is patched.
- **No LLM latency in the baseline.** Planning, question generation and
  grading times would be the most useful "before" numbers for the 2.0
  speed goal, but measuring them means calling Groq, which constraint 1
  forbids. C3.5 records the count of calls per session from the audit (8
  Groq, 1 embedding) and no timings, unless the user allows a one-off run.
- **Pinning.** Versions are pinned to what `.venv` has today (for example
  `fastapi==0.162.2`, `supabase==2.34.1`, `langgraph==1.2.20`). The fresh
  venv install in C3.2 is what shows the set resolves on 3.11; if it does
  not, that is a debug-protocol entry, not a silent unpin.
- **`lxml`** is imported by no file but `ebooklib` may need it at run time;
  it stays unless `pip show ebooklib` lists it as a requirement, in which
  case it can go.
- **Not in this chunk**, though security-related: the missing ownership
  check in `POST /sessions/start` (issue 17), the hard-coded Supabase
  fallback in `frontend/src/lib/supabase.js` (issue 11), the `guidance`
  leak (issue 18), and the ruff and ESLint baselines (issues 1, 2). Fixing
  17 is about 10 lines plus a test and fits here if wanted.
- The three `docs/repo-graph/` files show as modified in `git status` at
  chunk start, but `git diff --stat` is empty: line endings only
  (`core.autocrlf`). They are left alone until a subchunk regenerates them.

### Log

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|
| [x] C3.1 remove the raw-UUID auth bypass | `b64811a` | `get_current_user` no longer accepts a raw UUID as a bearer token; every token goes to `supabase.auth.get_user`. Removed, not gated behind `ENV` and `ALLOW_DEV_AUTH`. Added `backend/tests/test_auth.py`. | Tests written first: `pytest backend/tests/test_auth.py -q` gave 2 failed, 3 passed before the change and 5 passed after. Standard checks: ruff 84 errors (baseline), `pytest backend/tests -q` 13 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, `pytest tools/repo_graph/tests -q` 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 11:36 | Issue 10 closed. `test_sessions_api.py` (root script) relied on the bypass and now gets 401; retired in C3.3c. Not exercised against a running server |
| [x] C3.2 dependency hygiene | `e302ab8` | `requirements.txt` is the only backend dependency file and matches the imports: added `tenacity`, `langchain-core` and `mcp` (imported, previously only transitive); removed `langchain-mcp-adapters` and `lxml` (no importer; `lxml` still arrives through `ebooklib`); all 20 lines pinned to the `.venv` versions. Deleted `backend/requirements.txt`. Added `backend/tests/test_requirements.py`. Narrower than planned, per the C3.2 prompt: no `requirements-dev.txt`, and CI and `pyrightconfig.json` keep their Python versions (issue 4 stays open); `groq` and `langchain` stay until C8. | Tests written first: 3 failed before, 3 passed after. Fresh Python 3.11.9 venv in the scratchpad: `pip install -r requirements.txt` exit 0, `python -c "import backend.main"` exit 0, `pip check` "No broken requirements found", then with `pytest` added `pytest backend/tests -q` 16 passed. Standard checks in `.venv`: ruff 84 errors (baseline), 16 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 11:43 | Installed on Windows only, not in the Linux Docker image. CI still installs `pytest` and `httpx` by hand, unpinned. `pytest`, `ruff` and `psutil` are pinned nowhere |
| [x] C3.3 offline backend tests (planned as C3.3a and C3.3c; one commit at the user's request) | `dde7af3` | `backend/tests/conftest.py` sets a dummy environment, replaces `supabase.create_client` with one fake client and the Groq and Google embedding classes with ones that raise, and blocks non-loopback connections and lookups. Added `backend/tests/test_offline.py` (7 tests) and `pytest.ini` (`testpaths`). The eight root `test_*.py` scripts moved unchanged to `scripts/manual/` with a `README.md`; not deleted, as the user chose. `.github/workflows/ci.yml` is unchanged: its test path is still `backend/tests/`. | Test written first: collection error before `conftest.py` existed, 7 passed after. `pytest backend/tests -q`: 23 passed. Same command in a scratchpad copy of `backend/` with no `.env` and no Supabase or provider variables: 23 passed (and `import backend.main` there fails for lack of config, which shows the copy had none). Bare `pytest --collect-only -q`: 84 tests, none from `scripts/manual/`. Standard checks: ruff 84 errors (baseline), lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. One failure on the way, fixed under the debug protocol: a tooling test hard-coded four importers of `llm.py` and the offline test is a fifth. | 2026-11-10 11:52 | One `docs/DEBUG_LOG.md` entry. Issues 12 and 19 addressed; CI not observed on GitHub. The network adapter was not disabled: offline is shown by the guard and the copy without config. The moved scripts were not run (constraint 1). `test_inventory.py` still has a root `test_planner.py` case; it tests the rule, not the file |
| [ ] C3.3b endpoint tests on a fake Supabase client | | Not asked for in the C3.3 prompt; still planned. The fake client and `fake_supabase` fixture it needs are in place. | | | |
| [x] C3.4 stop the unused MCP subprocess | `b202cca` | `backend/main.py` no longer has a lifespan hook and starts no process. `backend/mcp_server.py` is kept, as the user chose, with a docstring on manual use; `mcp` stays in `requirements.txt` for it. Added `scripts/dev/measure_rss.py`, `backend/tests/test_startup.py` and `docs/BENCHMARKS.md`. | Graph: `query.py backend/mcp_server.py` shows 0 importers and `query.py mcp` shows that file as the only user; `git grep` finds no other reference outside `main.py`. Test written first: 1 failed before, 1 passed after. `python scripts/dev/measure_rss.py`, three runs each: 216.1, 215.7, 216.1 MB in 4 processes before; 142.0, 141.9, 142.0 MB in 2 processes after. Standard checks: ruff 83 errors (baseline 84; one went with the removed code in `main.py`, new baseline 83), `pytest backend/tests -q` 24 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 11:56 | Measured on Windows only. Manual use of `mcp_server.py` as the docstring describes was not exercised. The empty `/agent` router stays (issue 13) |
| [x] C3.5 baseline benchmark | `dc1c333` | Added `scripts/bench.py` (as the C3.5 prompt names it; the plan said `scripts/dev/benchmark.py`), `backend/tests/test_bench.py`, and a script-written "Baseline" section in `docs/BENCHMARKS.md`. p50 / p95: `GET /health` 1 / 4 ms, `GET /books` 193 / 242 ms, upload 1.72 / 2.24 s, upload to ready 5.07 / 5.10 s, `GET /dashboard` 465 / 486 ms. The three session steps are recorded as "LLM path not measurable": every Groq call returned 404, so their times (1.2 to 1.8 s) are the app's fallbacks. | Tests written first: collection error before the script existed, 6 passed after. Backend started with `uvicorn backend.main:app --port 8000`; `python scripts/bench.py --runs 20 --flow-runs 3` run twice (the second with `--write`), both complete, same picture. Server log of the second run: 21 `model_not_found` lines, 6 prompt-variable errors, 0 embedding retries, 0 ingestion failures, 3 uploads and 3 deletes with 200. Standard checks: ruff 83 errors (baseline), `pytest backend/tests -q` 30 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 12:04 | Issues 22 and 23. The run called Google AI Studio (about 48 embedding calls over two runs) and Groq (about 42 calls, all failed), as the C3.5 prompt asked; nothing in the code calls them more than before. p95 of the flow steps is over 3 runs |

Close review (2026-11-10 12:18):

- **Checks.** ruff 83 errors and ESLint 22 errors, 2 warnings (both at the
  pre-sprint baseline, not zero); `pytest backend/tests -q` 30 passed;
  frontend build passes; `import backend.main` exit 0; tooling 61 passed;
  `make graph` leaves `git diff --exit-code docs/repo-graph/` at 0.
- **Exit criteria.** Backend boots (`uvicorn backend.main:app`, `/health`
  200, no `mcp_server` process); frontend boots (Vite, 200 on 5173 with the
  root element). Against the running backend: the real id of test user A as
  a bearer token gets 401, no token gets 401, a real Supabase JWT gets 200
  on `GET /books`. Baseline recorded in `docs/BENCHMARKS.md`, with the LLM
  path as "not measurable". No sign-in was done in a browser.
- **Diff.** `git diff readfocus-2.0...HEAD`: 33 files, 1,487 insertions,
  270 deletions; `git diff --check` clean; no secret-like strings.
  Application code touched: `backend/dependencies.py`, `backend/main.py`,
  the `backend/mcp_server.py` docstring, and the deleted
  `backend/requirements.txt`. Nothing under `frontend/` or `supabase/`.
- **Blocking findings.** None.
- **Non-blocking.** The pins were installed on Python 3.11 only and CI runs
  3.12 (issue 4). C3.3b, endpoint tests on the fake client, is not done.
  `scripts/dev/measure_rss.py` raises in its cleanup if the server has
  already exited. The headers `security(...)` and `build(...)` are not in
  the type list (issue 7). Issues 22 and 23 mean the dev app runs on LLM
  fallbacks today.
- **Time.** About 1 hour of work against 1.5 h budgeted: the plan at 08:26,
  then C3.1 to C3.5 from about 11:30 to 12:04 and this review to 12:18.
  Wall-clock from branch creation is 3 h 52 min because of the pause between
  the plan and C3.1.

## C4 — free intelligence

Branch `chunk/C4-free-intelligence`, created from `readfocus-2.0` at
`4478a99`. Goal: the tested local-NLP building blocks every agent will use:
local embeddings, a 384-dimension vector column, text utilities, concept
extraction and a hybrid retriever, with ingestion moved onto the local
model. No agent logic: nothing under `backend/agents/` is edited, and the
Groq code stays as it is until its own chunk (issue 6).

### Plan (written at chunk start, before any code)

Design decisions that apply to every subchunk:

- **Model.** `BAAI/bge-small-en-v1.5` through `fastembed` (ONNX, 384
  dimensions), cached under `FASTEMBED_CACHE`. Fallback if it misses the G2
  budget: `sentence-transformers/all-MiniLM-L6-v2`, also 384 dimensions, so
  the C4.2 migration is the same either way. English only. **Outcome
  (C4.1): the fallback was chosen at G2; see the log.**
- **New dependencies: `fastembed` (C4.1) and `yake` (C4.4), nothing else.**
  Both are on the approved list. No `scikit-learn` in this chunk: lexical
  ranking is done by Postgres full-text search and cosine by `numpy`, which
  is already installed (2.4.6). `rapidfuzz` waits for the evaluator chunk.
  Each is pinned to the version pip installs on 3.11 and measured with
  psutil in a fresh process before its commit (constraint 5).
- **New modules go in `backend/services/`**, next to the code they replace,
  so the repo graph gives them the `service` role. The old Google client
  `backend/services/embeddings.py` is not edited or extended; it loses its
  importers in C4.5 and C4.6 and is deleted in C8.
- **Tests never load the real model or touch the network.** The offline
  guard in `backend/tests/conftest.py` stays; unit tests use a small
  deterministic fake embedder. One test per model runs only when the model
  is already in the local cache and is skipped otherwise (CI has no cache).
- **Database: dev project only, additive only** (constraint 2). The
  `vector(1536)` column, its index and `match_chunks` are left untouched.
- Every new tracked file gets a line in `tools/repo_graph/purposes.json`;
  new files are `git add`-ed before `make graph` (issue 21), and
  `docs/repo-graph/` is committed with the change.
- Estimated lines are hand-written lines, tests included; migrations and
  `docs/repo-graph/` do not count.

| Step | Files | Est. lines | Tests | Est. time |
|---|---|---|---|---|
| C4.1a embedding service | `requirements.txt` (add `fastembed`, pinned), `backend/services/local_embeddings.py` (new: `MODEL_NAME`, `EMBEDDING_DIM = 384`; one lazily loaded model behind a lock, never per request; `embed_texts(texts) -> float32 array (n, 384)`, L2-normalised, batched; `embed_query(text)`; a chunk longer than the model's 512-token window is split into word windows, embedded and mean-pooled, so the end of a 600-word chunk is not silently dropped; onnxruntime thread count capped), `backend/tests/test_local_embeddings.py` (new), `backend/tests/conftest.py` (a `fake_embedder` fixture for this and later subchunks), `tools/repo_graph/purposes.json` | 190 (85 service, 80 tests, 20 conftest, 5 other) | 7 with the fake model: shape and dtype; rows are unit length; empty list and empty string; long text is windowed and pooled; the model is constructed once across calls; `FASTEMBED_CACHE` is honoured; batching keeps input order. 1 with the real model, skipped when it is not cached: 384 values, and a paraphrase scores closer than an unrelated sentence | 35 min |
| C4.1b memory and latency measurement, 🚦 Gate G2 | `scripts/dev/measure_model.py` (new: in a fresh process, RSS before import, after import, after model load and after 50 embeds; cold load time; p50 / p95 for one query and for one 600-word chunk; chunks per second in batches of 8), `backend/tests/test_measure_model.py` (new), `docs/BENCHMARKS.md` (the memory-rule table with its first row, plus the latency table), `tools/repo_graph/purposes.json`. Then `scripts/dev/measure_rss.py` for the whole backend with the model loaded. **Stop and present the numbers; C4.2 starts only after the user passes G2** | 150 (80 script, 30 tests, 40 doc) | 2 on the script's pure helpers (percentiles, row formatting). The measurement itself is run by hand, 3 runs | 30 min + user |
| C4.2 additive 384-dim vector migration (dev only) | `supabase/migrations/005_local_embeddings.sql` (new: `ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding_384 vector(384)`; an HNSW cosine index on it, which needs no row count to tune, or ivfflat if the dev project's pgvector is older than 0.5; `match_chunks_384(query_embedding vector(384), match_book_id, match_count)` returning the same four columns as `match_chunks` and skipping rows whose new embedding is null), `backend/tests/test_migrations.py` (new) | 60 (25 SQL, 35 tests) | 3 static checks over `supabase/migrations/`: no `DROP` and no `ALTER ... DROP/TYPE` in any file; 005 declares `vector(384)`, equal to `EMBEDDING_DIM`; 001 to 004 are byte-identical to `readfocus-2.0`. By hand on the dev project, read-only after applying: the column and function exist, `match_chunks_384` answers for a zero vector, `match_chunks` still answers, chunk count unchanged | 25 min |
| C4.3 text utilities | `backend/services/text_utils.py` (new, standard library only: `normalize` for Unicode, whitespace, curly quotes and words hyphenated across a line break; `split_sentences` with an abbreviation guard; `tokenize`; a built-in `STOPWORDS` set; `content_tokens`; `word_windows`; `token_overlap`), `backend/tests/test_text_utils.py` (new), `backend/services/local_embeddings.py` (use `word_windows` instead of its private copy), `tools/repo_graph/purposes.json` | 200 (105 code, 90 tests, 5 other) | About 12, table-driven: "Dr. Smith", "e.g.", decimals, quotes and ellipses do not split a sentence; `?` and `!` do; PDF hyphenation is rejoined; normalising twice changes nothing; tokens are lower-case with no punctuation; stopwords are removed; overlap is 1 for identical and 0 for disjoint text; windows cover every word exactly once | 30 min |
| C4.4 concept extraction | `requirements.txt` (add `yake`, pinned), `backend/services/concepts.py` (new: Pydantic `Concept` with `term`, `score`, `kind` (`keyphrase` or `name`) and `sentence_indexes`; `extract_concepts(text, top_k)` combines YAKE key phrases of 1 to 3 words with capitalised multi-word names, drops stopword-only and near-duplicate terms, and maps each to the sentences that contain it; deterministic, no I/O), `backend/tests/test_concepts.py` (new), `docs/BENCHMARKS.md` (memory row for `yake`, time per 600-word chunk), `tools/repo_graph/purposes.json` | 195 (100 code, 80 tests, 15 other) | 8 on fixed passages: the expected key terms are in the top 5; a person's name comes back as `name`; "reader" and "readers" merge; no stopword-only term; every `sentence_indexes` entry really contains the term; `top_k` is respected; empty and very short text return an empty list; same input gives the same output | 35 min |
| C4.5a hybrid search in the database (dev only) | `supabase/migrations/006_hybrid_search.sql` (new: a generated `content_tsv tsvector` column on `chunks` with a GIN index; `hybrid_match_chunks(query_text, query_embedding vector(384), match_book_id, candidate_count)` returning each candidate's id, chunk_index, content, vector rank and text rank in one round trip), `backend/tests/test_migrations.py` (006 covered by the additive check) | 60 (40 SQL, 20 tests) | 1 added static check. By hand on the dev project: a distinctive phrase from a stored chunk returns that chunk by text rank while `embedding_384` is still null everywhere | 20 min |
| C4.5b hybrid retriever | `backend/services/retriever.py` (rewritten in place: pure `rrf_fuse(rows, k, weights)` using reciprocal rank fusion; `search(query, book_id, top_k) -> list[RetrievedChunk]` embeds the query locally in a worker thread, calls `hybrid_match_chunks` once and fuses; `get_similar_chunks(query_text, book_id, k)` keeps its signature and now delegates to `search`, so the test generator needs no edit; the unused LangChain `get_user_retriever` and the import of `embeddings.py` go), `backend/tests/test_retriever.py` (new), `tools/repo_graph/purposes.json` | 190 (90 code, 95 tests, 5 other) | 8: a chunk ranked by both lists beats one ranked by a single list; text-only and vector-only candidates both survive; ties break by `chunk_index`; `top_k` and an empty result; weights change the order; `search` sends a 384-value vector and the book id to the RPC (fake Supabase, fake embedder); `get_similar_chunks` returns content strings as before; the module imports neither LangChain nor `embeddings.py` | 35 min |
| C4.6a local embeddings in ingestion | `backend/services/book_ingestor.py` (embed in batches with `embed_texts` in a worker thread and insert each batch in one call, writing `embedding_384` and leaving `embedding` null; the first batch is five chunks so "ready after five" is unchanged; `chunk_text` and the extractors are not touched), `backend/tests/test_ingestor.py` (add ingestion tests), `tools/repo_graph/purposes.json` | 140 (40 code, 95 tests, 5 other) | 5 on the fake client and fake embedder: every chunk is inserted once, in order, with a 384-value `embedding_384`; the book turns `ready` after the first five and again correctly for a book of three; a failing embed marks the book `error`; no row sets the 1536 column; the module no longer imports `embeddings.py`. By hand: upload `sample.pdf` against the running backend, time upload to ready (baseline 5.07 s) and to fully ingested, and RSS during ingestion | 35 min |
| C4.6b re-embed existing dev chunks | `scripts/dev/reembed_chunks.py` (new: refuses to run unless `ENV=development`; pages through chunks where `embedding_384` is null, embeds and updates in batches, resumable, `--limit` and `--dry-run`), `backend/tests/test_reembed.py` (new), `docs/BENCHMARKS.md` (chunks per second, final counts), `tools/repo_graph/purposes.json` | 130 (75 script, 40 tests, 15 other) | 3: refuses outside development; only null rows are selected and each is updated once; `--dry-run` writes nothing. By hand: run on the dev project (642 chunks at the audit), then a read-only count of rows still null, and one `search` that returns a vector rank | 25 min |

Total: about 1,300 hand-written lines in 9 commits, about 4.5 hours plus
the G2 wait.

#### 🚦 Gate G2: memory and latency budget (end of C4.1b)

Proposed pass criteria, to be confirmed by the user before C4.1 starts:

| Measure | Budget | Why |
|---|---|---|
| Backend RSS after startup with the model loaded and 50 embeds done, Windows, `measure_rss.py` | at most 330 MB (today 138 MB server process) | Leaves room under Render Free's limit for ingestion and `yake`. The limit is believed to be 512 MB and is checked against Render's current docs in C4.1b, not assumed |
| Model load, cold process, model already on disk | at most 5 s | Paid once per spin-up |
| One query embed (about 30 words), warm | p95 at most 30 ms on this machine | The retriever runs inside a request |
| 600-word chunks, batches of 8 | at least 5 chunks per second on this machine | Ingestion; Render's shared CPU will be several times slower |

If a line fails: try the fallback model, then truncation instead of
windowing, then stop and report. The gate result goes in this file as
`G2: PASS` or `G2: FAIL` with the numbers.

Safe to cut, in this order: the capitalised-name detection in C4.4 (keep
YAKE key phrases); C4.6b as a script (re-upload the dev books instead);
windowed pooling in C4.1a (truncate at 512 tokens); C4.5a and the text half
of the retriever (vector-only through `match_chunks_384`).

Risks and open questions:

- **Applying migrations 005 and 006 to the dev project needs the user.**
  The repo does not show how 001 to 004 were applied (Supabase CLI link or
  the SQL editor), and the service-role key cannot run DDL. Nothing is
  applied without a go-ahead; the read-only checks follow.
- **Numbers from this machine are not Render's.** G2 is measured on Windows
  with 32 GB RAM. If Docker is available, the same script can run in
  `python:3.11-slim` with `--memory=512m` for a closer figure; not planned
  unless asked for.
- **Model download.** The first load fetches the model (tens of MB) from
  Hugging Face, with no key. On Render the disk is not kept between
  deploys, so the model has to be baked into the Docker image or it is
  downloaded on every cold start. That is a `Dockerfile` change for the
  deploy chunk, not C4; logged here so it is not lost.
- **Books ingested between C4.6a and C4.6b**, and all 642 existing chunks
  until C4.6b runs, have no `embedding_384`. The hybrid function still
  finds them by text rank, which is the reason C4.5 comes before C4.6.
- **New chunks have a null 1536 `embedding`.** Nothing reads that column
  once C4.5b lands (`match_chunks` loses its only caller), but it and its
  ivfflat index stay in the schema (constraint 2).
- **`retriever.py` changes behaviour for the test generator**: its context
  lookup stops calling Google AI Studio and starts returning hybrid
  results. The agent file is not edited. `get_similar_chunks` still filters
  on `book_id` only (same as today; issue 17 covers the caller).
- **`backend/tests/test_offline.py` imports `embeddings.py`** to prove the
  Google class is faked. It keeps passing in C4 and is revisited in C8.
- **`fastembed` and `numpy`.** `numpy` is installed but not pinned in
  `requirements.txt`; if `fastembed` or `yake` forces a different version
  on 3.11, that is a debug-protocol entry and a pin, not a silent change.
- **Concepts are computed on demand, not stored.** Storing them per chunk
  at ingestion would need another column; decided when the test generator
  is rewritten, with the per-chunk time from C4.4 as evidence.
- **Not in this chunk:** agent rewrites, `policy.py`, the dictionary and
  Wikipedia lookups, resumable ingestion and the upload size limit (audit
  sections 6 and 8), and removal of the provider packages and keys (C8).

### Log

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|
| [x] C4.1 embedding service and 🚦 Gate G2 (planned as C4.1a and C4.1b; one commit, and `backend/nlp/embedder.py` instead of `backend/services/local_embeddings.py`, as the C4.1 prompt asks) | `9093098` | Added `backend/nlp/embedder.py`: one lazily loaded, thread-safe `fastembed` model (`sentence-transformers/all-MiniLM-L6-v2`, 384 dimensions, cache from `FASTEMBED_CACHE`), `embed(texts)` and `embed_one(text)` returning unit-length float32 vectors. Defaults set from the measurements: one ONNX Runtime thread (`EMBED_THREADS` overrides) and four texts per model call. Added `backend/tests/test_embedder.py`, `scripts/dev/measure_embedder.py`, `fastembed==0.9.1` and `numpy==2.4.6` in `requirements.txt`. No long-text windowing: the model truncates at 256 tokens. | Tests written first: collection error (`No module named 'backend.nlp'`), then 9 passed, the real-model test included. Measured (`docs/BENCHMARKS.md`): load 0.67 s and 180 MB RSS on Windows, 4.80 s and 213 MB in a `--cpus=0.1 --memory=512m` container; throttled batch of 32 short texts 1.80 s; throttled batch of 32 chunk-sized texts 18.3 s and 267 MB; whole backend with the model loaded 264 MB on Windows. Standard checks: ruff 83 errors (baseline), `pytest backend/tests -q` 39 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 13:35 | **G2: stopped on `BAAI/bge-small-en-v1.5` (throttled batch of 32 chunk-sized texts 98.1 s against 5 s); the user chose the smaller model, `all-MiniLM-L6-v2`.** With it the gate passes on memory and on short texts; a throttled chunk-sized batch is still 18.3 s, so ingestion (C4.6) embeds in the background. A chunk is represented by its first 256 tokens. The real-model test is skipped where the model is not cached (CI). Whole-backend RSS not measured on Linux; retrieval quality of the two models not compared |
| [x] C4.2 additive 384-dim vector migration (dev only) | `acb7fe9` | Added `supabase/migrations/005_local_embeddings.sql`: `chunks.embedding_local vector(384)`, the HNSW cosine index `idx_chunks_embedding_local`, and `match_chunks_local(query_embedding vector(384), match_count, p_book_id)`, which runs as the caller (`SECURITY INVOKER`, fixed `search_path`) so RLS applies, and also filters on `auth.uid()`. Names follow the C4.2 prompt, not the plan (`embedding_384`, `match_chunks_384`). The 1536 column, its index and `match_chunks` are untouched. Added `backend/tests/test_migrations.py`. Applied to the dev project only. | Tests written first: 5 failed (no 005 file), then 10 passed. `npx supabase db push --linked --dry-run` listed only 005; the linked project is the one in `.env` (`ENV=development`); `npx supabase db push --linked` applied it and `migration list` shows 001 to 005 on both sides. On dev, with a fixture book of three chunks owned by test user A (removed afterwards; 642 chunks before and after): a zero vector with an unknown book returns `[]`; the service role and user A get the two embedded chunks, nearest first (similarity 1, then 0), `match_count 1` gives one, the chunk with no local embedding is skipped; test user B gets `[]` from the function and from a direct select; the anon key with no sign-in gets `[]`; `match_chunks` still answers. Standard checks: ruff 83 errors (baseline), `pytest backend/tests -q` 49 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 13:42 | No chunk has `embedding_local` yet (0 of 642) until C4.6. With HNSW and a `book_id` filter, a book that is a small share of all chunks may return fewer than `match_count` rows; not seen with the fixture, to be checked after the C4.6 re-embed. `match_chunks` (1536) returned 0 rows for a stored book with a dummy vector; it did not error and was not investigated. Production not touched |
| [x] C4.3 sentence splitting and informativeness | `54fa014` | Added `backend/nlp/text.py` (the plan said `backend/services/text_utils.py`), standard library only and pure: `normalize` (words hyphenated across a line break, single line breaks, curly quotes, ligatures, spaces; list items and paragraphs kept apart), `split_sentences` (regex boundary with an abbreviation and initials guard), `tokenize`, `STOPWORDS`, `content_words`, and `informativeness(sentence)` from 0 to 1: half length band (8 to 30 words), half content-word share, a bonus each for a digit and a proper noun, a penalty for a pronoun opening. Weights are constants at the top of the module. Added `backend/tests/test_text.py`. No new dependency, so no memory row. | Tests written first: collection error (`cannot import name 'text'`), then 48 passed (19 split cases incl. "Dr.", "e.g.", initials, quotes, bullet and numbered lists, hyphenated line breaks; 9 normalise cases; idempotence; tokens; stopwords; 6 ranking pairs; range). On `sample.pdf` (13 pages, 4,551 words): 270 sentences, split in 3 ms, scored in 7 ms. Standard checks: ruff 83 errors (baseline), `pytest backend/tests -q` 97 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 13:46 | English only. On `sample.pdf` the top-scoring "sentences" are bibliography entries (names and numbers earn both bonuses) and figure labels like "(a) (b)" score 0.25: reference lists and captions need filtering before question generation. Known splitter limits: "etc." before a capitalised sentence start is not split; a real compound hyphenated at a line break ("well-\nknown") is joined. `chunk_text` in `book_ingestor.py` keeps its own splitter |
| [x] C4.3 fix: ruff baseline | `c04d7d7` | `54fa014` was committed with `ruff check backend/` at 84 errors, one above the baseline, while its message and the row above say 83: an import-formatting finding (I001) in `backend/nlp/text.py`, introduced by a last lint fix that was chained to the commit command. Added the missing blank line; no behaviour change. | `ruff check backend/nlp/text.py` failed at `54fa014` (I001) and passes now; `ruff check backend/`: 83 errors (baseline); `pytest backend/tests -q` 97 passed; lint 22 errors and 2 warnings (baseline); build passes; import exit 0; tooling 61 passed; `make graph` twice, no diff after the second. | 2026-11-10 13:49 | One `docs/DEBUG_LOG.md` entry. The message of `54fa014` stays wrong about ruff (no amending) |
| [x] C4.4 keyphrase concept extraction | `925994f` | Added `backend/nlp/concepts.py` (the plan said `backend/services/concepts.py`): YAKE phrases of up to three words, normalised with `normalize_phrase` (lower case, stopwords and determiners stripped from both ends, plurals reduced by `lemma`), merged by `merge` when the rapidfuzz ratio is at least 90 or the embedding cosine at least 0.85, each with a stable `concept_key` slug; `extract_concepts(chunk, top_k, use_embeddings)` returns Pydantic `Concept`s (`key`, `label`, `weight` 0..1, `aliases`). One rule beyond the prompt: phrases sharing two words merge and the shortest names the group, because YAKE returns every overlapping n-gram of a phrase. No capitalised-name detection and no `sentence_indexes`, which the plan had. Added `yake==0.7.3` and `rapidfuzz==3.14.6`. | Tests written first: collection error, then one real failure (overlapping n-grams crowded out the topic words), then 31 passed. RSS in fresh processes: `yake` 16.7 to 47.9 MB, `rapidfuzz` 16.9 to 19.0 MB. On `sample.pdf` (7 chunks), top 10 for chunks 0, 3 and 5 are in the commit body; 71 to 142 ms per chunk with embeddings, 24 to 37 ms without. Standard checks: ruff 83 errors (baseline), `pytest backend/tests -q` 128 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 13:55 | The embedding merge changed nothing on the three chunks (same ten concepts with and without it) and costs two to four times the time. Front matter gives noise: author names, "june", "academic editor" top chunk 0. Single words that are part of a kept phrase stay as separate concepts ("batch", "size" next to "batch size"). Verb n-grams survive on short texts ("convert light"). Time not measured in the throttled container |
| [x] C4.5 hybrid vector and full-text retriever (planned as C4.5a and C4.5b; one commit) | `5799c6b` | `backend/services/retriever.py` rewritten in place: the query is embedded locally and matched through `match_chunks_local`, its content words go to Postgres full-text search through the new `search_chunks_text`, the two run side by side and are merged by the pure `rrf_fuse` (reciprocal rank fusion, k = 60); either search may fail or be empty and the other still answers. `get_similar_chunks(query_text, book_id, k=3)` keeps its signature, so `test_generator_agent.py` is not edited; the unused `get_user_retriever` and the imports of LangChain and `embeddings.py` are gone. Added `supabase/migrations/006_chunk_text_search.sql` (GIN index on `to_tsvector('english', content)`, `search_chunks_text` with `websearch_to_tsquery`, `SECURITY INVOKER`), applied to the dev project only. Differs from the plan: two database functions and fusion in Python, not one `hybrid_match_chunks`; no stored `tsvector` column. Added `backend/tests/test_retriever.py` and `scripts/dev/check_retriever.py`. | Tests written first: against the old module the first fast test failed (`rrf_fuse` missing) and the full run hung on the old code's retry loop, so it was stopped; then 15 retriever tests and 12 migration tests passed. `npx supabase db push --linked --dry-run` listed only 006; applied; `migration list` shows 001 to 006. `python scripts/dev/check_retriever.py` on dev (7 chunks of `sample.pdf` as a fixture book for test user A, removed afterwards): the expected chunk is in the top 3 for three concept queries and one paraphrase, 114 to 551 ms per search (final code, second run); with `embedding_local` set to null the text search alone still finds it; `get_similar_chunks` returns 3 strings; exit 0. Standard checks: ruff 82 errors (baseline 83; one went with the old code, new baseline 82), `pytest backend/tests -q` 145 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. Backend RSS with `backend.main` imported: 135.0 MB (135.2 before). | 2026-11-10 14:06 | The test generator now gets hybrid results instead of calling Google AI Studio; it passes a whole passage as the query, so the passage's own chunks rank first (it filters exact matches only). The query embedding loads the model on first use, in the web process. The fixture is one seven-chunk paper on one topic, so ranking quality is barely tested; RLS for `search_chunks_text` was not checked as a second user (same pattern as 005, which was). A tooling test that named `match_chunks` now names `match_chunks_local`. `match_chunks` (1536) has no caller left |
| [x] C4.6 local embeddings in ingestion, and the backfill (planned as C4.6a and C4.6b; one commit) | `d42e7a7` | `backend/services/book_ingestor.py`: `ingest_book` embeds chunks with `backend/nlp/embedder.py` in a worker thread, in batches (five first, then eight), inserts each batch in one call into `chunks.embedding_local`, and unlocks the book after the first batch; it no longer imports `backend/services/embeddings.py` and no longer writes the 1536 `embedding` column. `chunk_text` and the extractors are untouched. Added `scripts/backfill_local_embeddings.py` (the plan said `scripts/dev/reembed_chunks.py`): only rows with a null `embedding_local`, in id order, idempotent and resumable, `--dry-run`, `--limit`, `--book-id`; refuses to run unless `ENV=development`. Added `backend/tests/test_ingest_embeddings.py` and `backend/tests/test_backfill.py`. | Tests written first: collection error (no backfill script), then 17 passed with `test_ingestor.py`. Backend started with `GOOGLE_AI_STUDIO_KEY` empty: `/health` 200; `sample.pdf` uploaded as test user A through `POST /books/upload`: ready in 3.81 s (5.07 s before), all 7 chunks stored in 3.92 s, 7 of 7 with a 384-value `embedding_local`, 0 with the old embedding; book deleted through the API. `git grep` for `services.embeddings` and `generate_embedding` in `backend/` and `scripts/`: only `embeddings.py` itself and two tests. Backfill on dev: `--dry-run` would embed 642 and wrote nothing; `--limit 20` embedded 20; the full run embedded 622 in 106.7 s; a second run embedded 0; 642 of 642 chunks now have `embedding_local`. `match_chunks_local` asked for 20 rows returns 20 for the books of 302, 212, 70 and 35 chunks and all rows for the smaller ones. Standard checks: ruff 82 errors (baseline), `pytest backend/tests -q` 156 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 14:14 | Server RSS peaked at 306 MB on Windows during ingestion (120 MB before), above the 300 MB G2 line and not measured on Linux, where the model alone was 30 to 60 MB heavier. Ingestion on Render is estimated from C4.1 at about 0.6 s per chunk, not measured. `backend/services/embeddings.py` now has no importer in the app (only `test_offline.py`); it and the key go in C8. The ingestion tests were not run against the old code: its retry loop around the faked Google client hangs. Ingestion is still not resumable (audit section 6) |

Close review (2026-11-10 14:20):

- **Checks.** ruff 82 errors and ESLint 22 errors, 2 warnings (both at the
  current baseline, not zero); `pytest backend/tests -q` 156 passed;
  frontend build passes; `import backend.main` exit 0; tooling 61 passed;
  `make graph` leaves `git status --short docs/repo-graph/` empty. No
  failures at close, so no fix commits here; the one fix commit of the
  chunk is `c04d7d7` (C4.3).
- **Ticks and gate.** C4.1 to C4.6 are ticked with their hashes. **G2:
  stopped on `BAAI/bge-small-en-v1.5`; the user chose the smaller
  `all-MiniLM-L6-v2`** (C4.1 row, `docs/BENCHMARKS.md`).
- **Exit criteria.** The app ingests a book with no Google key: backend
  started with `GOOGLE_AI_STUDIO_KEY` empty, `sample.pdf` uploaded, 7 of 7
  chunks with `embedding_local` (C4.6). Embedder memory and latency are
  recorded: model load 0.67 s and 180 MB on Windows; in a 0.1-CPU, 512 MB
  container 4.80 s and 213 MB, 32 short texts in 1.80 s, 32 chunk-sized
  texts in 18.3 s and 267 MB.
- **Diff.** `git diff readfocus-2.0...HEAD`: 29 files, 2,385 insertions,
  125 deletions; `git diff --check` clean; no secret-like strings. Nothing
  under `frontend/`, `backend/agents/`, `backend/routers/`, `backend/main.py`,
  `Dockerfile`, `render.yaml` or `.github/`. Application code touched:
  `backend/services/book_ingestor.py`, `backend/services/retriever.py`, and
  the new `backend/nlp/`. Migrations 005 and 006 are additive and applied to
  the dev project only.
- **Blocking findings.** None.
- **Closed in the review.** RLS on `search_chunks_text` (006) had not been
  checked as a second user. Checked now with a two-chunk fixture book of
  test user A (removed; 642 chunks before and after): the service role and
  user A get the matching chunk, user B and the anon key get `[]`.
- **Non-blocking.**
  - Memory: the server peaked at 306 MB during ingestion on Windows; the
    model is 30 to 60 MB heavier on Linux, and the whole backend was never
    measured on Linux or Render.
  - Speed on Render is an estimate (about 0.6 s per chunk); ingestion was
    not run throttled.
  - The `Dockerfile` does not bake the model in, so every cold start on
    Render downloads 86 MB from Hugging Face before the first embed.
  - A chunk is embedded from its first 256 tokens only; retrieval quality
    of the two models was not compared.
  - Concept extraction is noisy on title pages and reference lists; the
    embedding merge changed nothing on `sample.pdf`.
  - `informativeness` ranks bibliography entries highest.
  - The test generator passes its own passage as the retrieval query, so
    its "related context" is mostly the passage itself.
  - The real-model embedder test is skipped in CI (no cached model).
    `yake` and `rapidfuzz` were installed on Windows only.
  - `CLAUDE.md` still says `backend/services/` calls Google AI Studio; the
    module is no longer imported by the app. Not edited here.
  - Three of the six subchunks went over the ~200-line guideline because
    one commit each was asked for.
- **Time.** 1 h 55 min of wall-clock, from branch creation at 12:20 to this
  review at 14:15, against 2.5 h budgeted.

## C5 — question generation

Branch `chunk/C5-question-generation`, created from `readfocus-2.0` at
`df0b510`. Goal: replace LLM test generation with a precomputed,
source-grounded question bank built at ingestion, so a test loads with one
database read and no model call. Grading is not in this chunk: the evaluator
keeps its current code and still receives `question`, `type` and `guidance`.
Nothing under `frontend/` is edited.

### Plan (written at chunk start, before any code)

Design decisions that apply to every subchunk:

- **Every question is built from one sentence of the chunk it tests** and
  stores that sentence (`source_sentence`), its reference answer and the
  concept it is about. No question needs knowledge outside the passage.
- **Question format stays open-answer.** The test page is a textarea, so
  there are no multiple-choice distractors. `type` stays one of `factual`,
  `inference`, `summary` (the badge the page shows); the new `strategy`
  field says how the question was made.
- **Six strategies**, all pure and deterministic: `cloze` (a key concept or
  number blanked out of an informative sentence), `definition` ("X is / means
  / refers to ..." turned into "What is X?"), `cause` (a sentence with
  because / therefore / as a result: the effect is quoted, the reason is
  asked for), `contrast` (however / whereas / unlike), `concept` ("What does
  the passage say about X?", answered by the sentences that mention X) and
  `summary` (reference answer is the top sentences by `informativeness`;
  always available, so no chunk is left without a question).
- **No new dependency**, so no memory row is required (constraint 5). What
  is measured instead: milliseconds per chunk for generation, server RSS
  during ingestion with the hook on (306 MB peak today), and
  `finish-reading` latency against the C3.5 baseline.
- **Layers.** Pure text-to-candidates code goes in `backend/nlp/` (no I/O,
  thresholds passed in as arguments). The agents follow the
  `free-intelligence` pattern: Pydantic input and output, a pure `decide`,
  constants in the new `backend/agents/policy.py`, a thin node that appends
  to `decisions`. Database writes go in `backend/services/`.
- **Concepts come from `extract_concepts(..., use_embeddings=False)`**: C4.4
  measured the embedding merge as two to four times slower with no change
  in output.
- **A missing bank never blocks a test.** If the session's chunks have too
  few bank rows (books ingested before C5, or ingestion still running), the
  test generator runs the same pure generator on the chunk text in the
  request and stores the rows. Bank generation failing never marks a book
  `error`.
- **Database: dev project only, additive only** (constraint 2).
- Tests are written first, run offline, and use the fake Supabase client.
  Every new tracked file gets a line in `tools/repo_graph/purposes.json`;
  new files are `git add`-ed before `make graph` (issue 21).
- Estimated lines are hand-written lines, tests included; migrations and
  `docs/repo-graph/` do not count. Subchunks over ~200 lines are split a/b
  up front.

| Step | Files | Est. lines | Tests | Est. time |
|---|---|---|---|---|
| C5.1 `question_bank` schema (dev only) | `supabase/migrations/007_question_bank.sql` (new: table `question_bank` with `id`, `book_id` and `chunk_id` (both `ON DELETE CASCADE`), `user_id`, `chunk_index`, `type` (check: factual, inference, summary), `strategy`, `question`, `answer`, `guidance`, `source_sentence`, `sentence_index`, `concept_key`, `difficulty` (1 to 3), `quality` (0 to 1), `question_hash`, `generator_version`, `created_at`; unique `(chunk_id, question_hash)` so a re-run cannot duplicate; index `(book_id, chunk_index)`; RLS on, with the same own-rows policy as the other tables), `backend/tests/test_migrations.py`, `tools/repo_graph/purposes.json` | 40 (plus about 45 SQL) | 4 static: 007 has no destructive statement; it creates the table with RLS enabled and a policy on `auth.uid() = user_id`; the `type` check lists exactly the three types; 001 to 006 unchanged. By hand on dev after `npx supabase db push --linked --dry-run` lists only 007: insert and read a fixture row as test user A, `[]` for user B and for the anon key, deleting the fixture book removes its rows, row counts of the other tables unchanged | 25 min + user |
| C5.2a candidate model, `cloze` and `definition` | `backend/nlp/question_strategies.py` (new: Pydantic `Candidate` with the bank's content fields; `cloze(sentences, concepts)` blanks the highest-weight concept or a number in a sentence, never the first word, one blank per sentence; `definition(sentences, concepts)` matches a concept followed by is / are / means / refers to / is defined as), `backend/tests/test_question_strategies.py` (new), `tools/repo_graph/purposes.json` | 190 (95 code, 90 tests, 5 other) | About 10 on fixed passages: the blank removes exactly the answer and the answer is not left elsewhere in the stem; a number is blanked when no concept is present; a sentence with no concept or number gives nothing; "X is ..." gives "What is X?" with the sentence as the answer; "it is ..." and "there is ..." do not; `source_sentence` is verbatim from the chunk; same input, same output; empty text gives `[]` | 35 min |
| C5.2b `cause`, `contrast`, `concept`, `summary` and `generate_candidates` | `backend/nlp/question_strategies.py`, `backend/tests/test_question_strategies.py` | 190 (100 code, 90 tests) | About 10: a because / therefore sentence yields a question quoting the effect with the reason as the answer; a marker at the very start of a sentence (reason in the previous sentence) is skipped; however / whereas yields a contrast question; `concept` answers with every sentence that mentions the concept; `summary` exists for any chunk with one sentence or more and names the top concepts in `guidance`; `generate_candidates(text, concepts)` returns candidates from every strategy with the right `type` and `strategy`; time per 600-word chunk measured on `sample.pdf` | 35 min |
| C5.3 quality filter | `backend/nlp/question_quality.py` (new, pure: `chunk_kind(text)` flags reference lists, tables of contents and front matter by citation, year and digit density, where only `summary` is allowed or nothing; `reject_reason(candidate, ...)` for a source sentence that opens with a pronoun, is a caption or bibliography entry, is too short or long, has low `informativeness`, an answer that is a stopword or too long, a stem that contains its own answer; `quality(candidate)` from 0 to 1; `filter_candidates(candidates, min_quality, per_chunk, per_type)` drops rejects, merges near-duplicates with rapidfuzz, keeps the best per sentence and caps per chunk), `backend/tests/test_question_quality.py` (new), `tools/repo_graph/purposes.json` | 195 (95 code, 95 tests, 5 other) | About 12, table-driven: each reject reason fires on its example and not on a clean one; a bibliography chunk and a contents page are flagged, a body chunk with two citations is not; two questions at ratio 90 or more collapse to the better one; caps and `min_quality` respected; the order is stable; nothing rejected is returned. By hand on `sample.pdf` (7 chunks): kept and rejected counts by reason, and the kept questions for chunks 0, 3 and 5 pasted in the commit body for the user to read | 40 min |
| C5.4a bank agent (pure) | `backend/agents/policy.py` (new: `GENERATOR_VERSION`, `MIN_QUALITY`, `MAX_PER_CHUNK`, per-type caps, concept `top_k`), `backend/agents/question_bank_agent.py` (new: `BankInput` (chunk id, index, text), `BankOutput` (rows ready to insert, with `question_hash`, plus rejected counts by reason), pure `decide` = concepts, then strategies, then filter), `backend/tests/test_question_bank_agent.py` (new), `tools/repo_graph/purposes.json` | 180 (95 code, 80 tests, 5 other) | 7: a body passage gives at least one factual and one summary row; every row has the bank's required fields and a `quality` at or above the threshold; the hash is stable and differs between questions; a reference-list chunk gives no factual rows; the cap holds; empty text gives no rows; the module imports no LangChain, no `llm.py` and no Supabase client | 30 min |
| C5.4b ingestion hook | `backend/services/question_bank.py` (new: `build_for_chunks(book_id, user_id, chunk_rows)` runs `decide` per chunk in a worker thread and upserts on `(chunk_id, question_hash)`; `fetch(book_id, chunk_indices)`), `backend/services/book_ingestor.py` (after each batch insert, and for the first batch after the book is marked ready, call `build_for_chunks` inside its own try / except), `backend/tests/test_question_bank_service.py` (new), `backend/tests/test_ingest_embeddings.py`, `tools/repo_graph/purposes.json` | 170 (70 code, 95 tests, 5 other) | 6 on the fake database: every ingested chunk gets bank rows with its own `chunk_id`, `book_id` and `user_id`; the book is `ready` before the first bank write; a generator that raises leaves the book `ready` and the chunks stored; running twice adds no duplicate; `fetch` returns only the asked chunks; the existing ingestion tests still pass. By hand: upload `sample.pdf` (ready 3.81 s, all chunks 3.92 s in C4.6), rows per chunk on dev, server RSS peak | 35 min |
| C5.4c backfill for existing dev books | `scripts/backfill_question_bank.py` (new, same shape as `scripts/backfill_local_embeddings.py`: only chunks with no bank rows at the current `GENERATOR_VERSION`, resumable, `--dry-run`, `--limit`, `--book-id`, refuses to run unless `ENV=development`), `backend/tests/test_backfill_question_bank.py` (new), `docs/BENCHMARKS.md` (ms per chunk, rows per chunk, rejects by reason), `tools/repo_graph/purposes.json` | 140 (70 script, 50 tests, 20 other) | 4: refuses outside development; skips chunks that already have rows; `--dry-run` writes nothing; `--book-id` limits the run. By hand: dry run, `--limit 20`, the full run over the 642 dev chunks, a second run that writes 0 | 25 min |
| C5.5a test assembly (pure) | `backend/agents/test_generator_agent.py` (add `AssembleInput` (bank rows for the session's chunks, ids already asked of this reader, a seed derived from the session id), `AssembleOutput`, and a pure `decide`: 3 factual, 1 inference, 1 summary; spread across the session's chunks and across concepts; unseen before seen; higher `quality` first; a missing type is filled from the next best; the old node is untouched in this commit), `backend/agents/policy.py` (test shape and weights), `backend/tests/test_test_generator.py` (new) | 185 (85 code, 95 tests, 5 other) | 9: five questions in the 3 / 1 / 1 shape; no two from the same sentence; every chunk of a three-chunk session is represented; a seen question is used only when nothing unseen is left; a bank with no inference rows still returns five; fewer than five rows returns what exists, with the summary; the same seed gives the same test and a different seed can differ; output keeps `question`, `type`, `guidance` and adds `id`, `answer`, `source_sentence`, `concept_key`; no I/O in `decide` | 35 min |
| C5.5b serve tests from the bank | `backend/agents/test_generator_agent.py` (node becomes a thin wrapper: `fetch` the bank, lazy fill for chunks with no rows, `decide`, return `test_questions` and a `decisions` entry; the prompt, parser, `test_llm` import, retriever call and generic mock questions are deleted; `generate_test` keeps its signature), `backend/agents/state.py` (`decisions`), `backend/routers/sessions.py` (`GET /sessions/{id}` returns only `question` and `type` of each question, so reference answers never reach the browser; closes the `guidance` part of issue 18), `backend/tests/test_test_generator.py`, `backend/tests/test_api_sessions.py` (new), `tools/repo_graph/tests/test_query.py` (it hard-codes the importers of `llm.py`, which drop by one), `tools/repo_graph/purposes.json` | 195 (75 code, 110 tests, 10 other; about 90 deleted) | 7 on the fake database: the node returns five bank questions for the session's chunks with no chat-model object constructed; a book with an empty bank still gets a test and the rows are stored; a second session on the same chunks avoids the first one's questions; `finish-reading` returns `question` and `type` only; `GET /sessions/{id}` has no `answer`, `guidance` or `source_sentence`; `submit-answers` still finds the full questions; the module no longer imports `llm.py`, `retriever.py` or LangChain | 40 min |
| C5.5c measure and close | `docs/BENCHMARKS.md` (`python scripts/bench.py` session steps against the C3.5 baseline, where test generation was 1.2 to 1.8 s on fallbacks), `CLAUDE.md` (pytest count in the baseline table; the stack note on what still calls Groq), `scripts/manual/README.md` (`test_generator.py` no longer calls an LLM) | 40 | none added. By hand: backend up, a full session as test user A on a backfilled book and on a fresh upload; server log shows no Groq request during `finish-reading`; the banned-provider grep lists one file fewer | 20 min |

Total: about 1,500 hand-written lines in 10 commits, about 5.5 hours
including the waits. No budget for C5 is recorded in this file; if the
promptbook gives less, the cut list below applies.

Exit criteria for the chunk:

- `finish-reading` makes no LLM call and answers in well under the C3.5
  figure; target p95 at most 400 ms locally, which is about two Supabase
  round trips.
- A freshly uploaded book and a pre-C5 book both produce a five-question
  test whose every question quotes or blanks a sentence from the assigned
  chunks.
- No reference answer in any response the browser receives.
- `backend/agents/test_generator_agent.py` leaves the banned-provider grep
  list.

Safe to cut, in this order: `contrast` (C5.2b); C5.4c as a script (the lazy
fill covers old books on first use); avoiding already-asked questions
(C5.5a); `chunk_kind` front-matter detection beyond reference lists (C5.3);
`cause` (C5.2b). Not safe to cut: the answer stripping in C5.5b.

Risks and open questions:

- **Applying migration 007 to the dev project needs the user's go-ahead**,
  as 005 and 006 did. Nothing is pushed before it; production is not
  touched.
- **Question wording is the main quality risk.** Templates over raw
  sentences read stiffly, and `cause` and `contrast` depend on clean clause
  boundaries. C5.3 ends with the kept questions for three `sample.pdf`
  chunks in the commit body so the user can judge them before C5.4 builds
  on them. `sample.pdf` is one academic paper; no novel or narrative
  non-fiction has been tried, and the dev database holds the only other
  texts.
- **Inference questions are the weakest type.** With no model, "inference"
  means cause, contrast and concept questions, which are closer to guided
  recall than to reading between the lines.
- **Grading does not improve in this chunk.** The evaluator still calls
  Groq and, on this machine, falls back to 10/10 (issues 18 and 22). The
  bank stores `answer` and `source_sentence` so the evaluator chunk can
  grade against them; the `guidance` it reads today is filled from the same
  reference answer.
- **`GET /sessions/{id}` changes shape** for `test_questions` (two keys per
  question instead of all). `ComprehensionTest.jsx` and `Results.jsx` read
  only `question` and `type`, checked by grep; no frontend edit is planned.
- **Ingestion gets slower and heavier.** Concept extraction was 24 to 37 ms
  per chunk on Windows without embeddings; Render's shared CPU is several
  times slower, and the server already peaked at 306 MB during ingestion.
  The hook runs after the book is marked ready so time-to-first-read does
  not move; both numbers are re-measured in C5.4b, and if RSS rises
  noticeably the hook moves to after the last embedding batch.
- **Regeneration.** Improving a strategy later means bumping
  `GENERATOR_VERSION` and adding rows; old rows stay (additive) and
  assembly reads only the current version. Bank ids stored in past
  sessions therefore stay valid.
- **Repeat avoidance** reads the reader's earlier `sessions.test_questions`
  for the book: one extra query per test, no new table.
- **Not in this chunk:** the evaluator, planner and optimizer rewrites, the
  orchestrator, multiple-choice questions and any test-page change, the
  fixed 180 s test time and blank auto-submit (issue 18), the ownership
  check in `POST /sessions/start` (issue 17), and removal of `llm.py` and
  the provider packages (C8).
- The three `docs/repo-graph/` files show as modified at chunk start with
  an empty `git diff --stat`: line endings only, as in C3. Left alone until
  a subchunk regenerates them.

### Log

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|
| [x] C5.1 `question_bank` table (dev only) | `126a7e0` | Added `supabase/migrations/007_question_bank.sql` (the C5.1 prompt says `006_question_bank.sql`; 006 is taken by `006_chunk_text_search.sql`): table `question_bank` with the prompt's columns (`prompt`, `evidence`, `key_terms`, `distractors`, `prompt_hash`, `times_used`, not the plan's `question`, `source_sentence`, `guidance`, `question_hash`), foreign keys to `profiles`, `books` and `chunks` with `ON DELETE CASCADE`, `NOT NULL` on the ids, `chunk_index`, `type`, `prompt`, `strategy` and `prompt_hash`, index `(user_id, book_id, chunk_index)`, unique `(chunk_id, strategy, prompt_hash)`, RLS on with one own-rows policy (`USING` and `WITH CHECK`). Applied to the dev project only. Added four tests to `backend/tests/test_migrations.py`. | Tests written first: 4 failed (no 007 file), then 17 passed. The linked project is the one in `.env` (`ENV=development`); `npx supabase db push --linked --dry-run` listed only 007; applied; `migration list` shows 001 to 007 on both sides. On dev, with a one-chunk fixture book of test user A (removed afterwards; 8 books, 642 chunks, 0 `question_bank` rows before and after): defaults filled (`times_used` 0, `created_at`, `id`), jsonb arrays round-trip, a duplicate `(chunk_id, strategy, prompt_hash)` is refused (23505) and the same hash under another strategy is accepted, a null `prompt` is refused; user A reads and updates the two rows; user B and the anon key read none; user B cannot insert a row for user A (RLS violation), nor update or delete A's row; deleting the book removes its questions. Standard checks: ruff 82 errors (baseline), `pytest backend/tests -q` 161 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 14:30 | One `docs/DEBUG_LOG.md` entry: a tooling test lists the tables by name and needed the seventh. No check constraint on `type` or `strategy`, and no `generator_version` column, both of which the plan had: the prompt's column list was followed. The plan's later rows still use the old field names; C5.2 onwards follow the table. The dev check script was a one-off and is not committed. Production not touched |
| [x] C5.2a sentence spans and the cloze strategy (C5.2 is split in three to stay near 200 lines; the plan had two halves and other strategies) | `12fb68b` | Added `backend/agents/question_generation/strategies.py` (the path the C5.2 prompt gives; the plan said `backend/nlp/question_strategies.py`): Pydantic `Sentence` and `Question`, `sentences_of(chunk)`, which pairs each normalised sentence with its exact span in the chunk (any whitespace, either quote style), and `cloze(sentences, concepts)`, which blanks the highest-weight concept (plural forms and every occurrence) in each sentence scoring at least 0.6 on `informativeness`. `Question.evidence` is a list of verbatim spans; `Question.concept` names the concept. Added `backend/agents/policy.py`, the single home for agent constants, and `backend/tests/test_question_strategies.py`. Pure: no I/O, no model. No new dependency. | Tests written first: collection error (no `question_generation` package), then 7 passed, including `piece in chunk` for every evidence piece on a fixture with line breaks inside sentences. Standard checks: ruff 82 errors (baseline), `pytest backend/tests -q` 168 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. Banned-provider grep: the same four files as before. | 2026-11-10 14:35 | A sentence that normalising rewrote beyond spaces and quotes (a word hyphenated across a line break, a ligature) has no verbatim span and gets no question; how many sentences that costs on real books is measured on `sample.pdf` in C5.2c. A cloze answer keeps its surface form ("Plants"), the concept its normalised label. Not yet run on real text |
| [x] C5.2b definition and why/how strategies | `dc33566` | `strategies.py` gains `definition(sentences, concepts)`: "What is X?" ("What are X?" after a plural verb) when a concept is the subject of "is a / an / the", "refers to", "means", "is defined as", or follows "known as", "defined as", "called"; the answer is the sentence. And `why_how(sentences)`: only for sentences with "because", "therefore", "as a result" or "leads to"; the answer is the causal clause, and when the marker opens a sentence the cause is the sentence before and both are the evidence. `policy.py` gains the lead-word, clause-length and key-term limits and two difficulty values. | Tests written first: 6 failed (no `why_how`), then 25 passed in the file: seven definitional forms, four sentences that must not match, five causal forms with exact prompts and answers, five that must give nothing, and verbatim evidence for every question. Standard checks: ruff 82 errors (baseline), `pytest backend/tests -q` 186 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 14:36 | Why questions quote the stated fact (`why is this so: "..."`) instead of rewording it, which reads stiffly but cannot be ungrammatical. A term that opens its sentence is lower-cased in the prompt, which is wrong for a proper noun ("What is einstein?"). "since", "due to" and "so that" are not markers. A mid-sentence "because" inside a quotation or a negation ("not because") is not detected. Not yet run on real text |
| [x] C5.2c main idea and multiple choice strategies | `7163858` | `strategies.py` gains `main_idea(sentences, concepts, sentence_vectors)`: one open question naming the top concept, with the two sentences nearest the centroid of the sentence embeddings as evidence, in reading order; and `multiple_choice(cloze_questions, concept_vectors)`: a cloze question plus three distractors, the book concepts whose cosine to the answer is between 0.40 and 0.75, closest first, never one that is in the sentence or shares a word with the answer; fewer than three gives no question. Both take their vectors as arguments, so the module still does no I/O. `policy.py` gains the evidence count, the distractor count and band, and two difficulty values. | Tests written first: 5 failed, then 30 passed in the file, on hand-made 2-d vectors. All five strategies run once on `sample.pdf` with the real model (one-off script, not committed): 7 chunks, 270 sentences, 15 without a verbatim span (5.6%); 156 cloze, 0 definition, 6 why/how, 7 main idea, 14 multiple choice; 0 evidence pieces outside their chunk; strategies 15.5 ms per chunk, embedding a chunk's sentences 316 ms per chunk, the book's 50 concept labels 72 ms. Standard checks: ruff 82 errors (baseline), `pytest backend/tests -q` 191 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. Banned-provider grep: the same four files. | 2026-11-10 14:45 | **Quality on `sample.pdf` is uneven and needs C5.3 before anything is stored.** Chunk 0's questions are front matter ("Academic Editor: Hristos T. _____", main idea "about anastassiu received"); a page header and a figure caption were blanked; the main-idea evidence for chunk 5 is a page header and a journal name. No sentence in the paper matched a definitional pattern. Multiple choice came out for 14 of 156 cloze questions, with weak distractors ("figure", "based on deep"): one paper has 50 concepts, mostly noise. **Main idea needs every sentence embedded: 316 ms per chunk on Windows, by the C4.1 figures about 2 s per chunk on Render**, on top of the chunk embedding; whether to pay it at ingestion is a C5.4 decision. Multiple-choice answers keep their surface form while distractors are normalised labels, which can give the answer away. The test page has no multiple-choice UI |
| [x] C5.3 question quality filter and dedupe | `96745ba` | Added `backend/agents/question_generation/quality.py` (the plan said `backend/nlp/question_quality.py`), pure: `reject_reason(question)` returns `answer_is_stopword` (the answer is only pronouns and stopwords, or empty), `evidence_too_short` (fewer than 8 word tokens over all evidence pieces) or `answer_in_prompt` (the answer stands in the prompt as whole words); `score(question)` is 0 to 1: 0.6 mean `informativeness` of the evidence, 0.2 answer length (full up to 25 tokens, none at 60), 0.2 key terms (three for full marks); `filter_questions(questions, prompt_vectors)` drops rejects, then, best score first, any question whose prompt embedding has a cosine above 0.9 to an accepted one (`near_duplicate`), and returns the accepted in their original order with `quality` set, plus every reject with its reason. A multiple-choice question and the cloze it was made from are one item in two formats and are not duplicates of each other. Thresholds and weights are in `policy.py`. `Question` gains `quality`. | Tests written first: collection error (no `quality` module), then one real failure (an empty list tripped a reshape), then 21 passed: 15 reject cases including the 7 and 8 token boundary, score range and ranking, the better of two duplicates kept whatever the order, cosine 0.899 kept, zero vectors, mismatched lengths. On `sample.pdf` with the real model (one-off script, not committed): 196 questions made, 176 kept; 20 rejected, all `evidence_too_short`; quality of the kept ones 0.63 to 0.94; embedding the prompts 262 ms per chunk, the filter itself 2.6 ms per chunk. Standard checks: ruff 82 errors (baseline), `pytest backend/tests -q` 212 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. Banned-provider grep: the same four files. | 2026-11-10 14:55 | **The four rules remove little of what is wrong on `sample.pdf`.** Front matter still passes and scores high ("Academic Editor: Hristos T. _____" 0.85, "Keywords: _____; ..." 0.87), because `informativeness` rewards names and numbers (C4.3); page headers inside sentences and vague answers ("design", "model") pass too. Nothing was rejected as a duplicate, a stopword answer or an answer in the prompt on this paper; those rules are covered by tests only. The score has a narrow range, so it orders questions weakly. The plan's reference-list and front-matter detection and its per-chunk caps were not asked for in the C5.3 prompt and are not built: a chunk of this paper keeps 10 to 38 questions. Dedupe needs one more embedding per question, about as much again as the sentence embeddings. About 240 hand-written lines, over the ~200 guideline, in one commit as asked |
| [x] C5.3b boilerplate detection and per-strategy caps (added at the user's request after the C5.3 run on `sample.pdf`) | `053e6fe` | `quality.py` gains `boilerplate_reason(sentence)`: `front_matter` (labels such as Received:, Keywords:, Citation:, Academic Editor:, a copyright sign, an e-mail address, or six or more words of which 60% start with a capital), `reference_entry` (a DOI, URL, arXiv or ISBN, or a "Surname, I." author with a year) and `page_furniture` ("6 of 13", a journal header such as "2025, 14, 2510", a Figure or Table caption, or 40% number tokens). `reject_reason` applies it to every evidence piece after the three C5.3 rules. `filter_questions` now also keeps at most `QUESTION_CAPS` per strategy (cloze 5, multiple choice 3, definition 3, why/how 3, main idea 1; 3 for an unlisted strategy), best quality first, and rejects the rest as `over_cap`. The limits are in `policy.py`. | Tests written first: 22 failed, then 43 passed in the file: 12 boilerplate sentences taken from or modelled on `sample.pdf`, 7 body sentences that must pass (names, years, numbers, an inline citation, "Figure 5" mid-sentence), boilerplate in any evidence piece and across a line break, and the caps. On `sample.pdf` with the real model (one-off script, not committed): 196 made, 47 kept (30 cloze, 7 multiple choice, 6 why/how, 4 main idea); rejected 86 `over_cap`, 20 `front_matter`, 20 `evidence_too_short`, 10 `page_furniture`; 6 to 11 kept per body chunk, quality 0.64 to 0.94; the reference-list chunk keeps 0; no front-matter question is left in chunk 0. Standard checks: ruff 82 errors (baseline), `pytest backend/tests -q` 234 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. Banned-provider grep: the same four files. | 2026-11-10 15:05 | Three of seven chunks end with no main-idea question, because `main_idea` picks its two sentences before the filter and they were boilerplate; C5.4 should drop boilerplate sentences before the strategies run. Reference entries are caught, but mostly by the capitalised-words rule, so they are labelled `front_matter`. Kept cloze questions still lean on vague answers ("design", "model") and repeat one concept within a chunk ("batch size" three times in chunk 3): the cap is per strategy, not per concept. A heading glued to its first sentence passes ("Introduction Microstrip antennas have ..."). The rules are tuned on one English journal paper; a novel's dialogue or a title-case sentence could trip the 60% rule. Not tried on EPUB |
| [x] C5.4 question bank generated during ingestion (planned as C5.4a, b and c; one commit as asked, no backfill script) | `0864645` | Added `backend/agents/question_generation/agent.py`: `QuestionGenerationAgent.run(book_id, chunk_ids) -> GenerationReport` reads the chunks, drops boilerplate sentences, takes concepts from the body text, runs the five strategies and the quality filter, and upserts the rows into `question_bank` with `on_conflict=chunk_id,strategy,prompt_hash` and `ignore_duplicates`, so a second run adds nothing. The report has chunks, generated, accepted, stored, counts by type, by strategy and by reject reason, and the average quality. The pure parts are `body_sentences`, `generate`, `prompt_hash` and `to_row`; evidence pieces are joined with a blank line. `book_ingestor.py` calls the agent in a worker thread after each batch insert, and for the first batch after the book is marked ready; a failure there is logged and the book stays ready. `policy.py` gains `MAX_QUESTIONS_PER_CHUNK = 12`, applied in `filter_questions` on top of the per-strategy caps. | Tests written first: collection error (no agent module), then 10 new tests passed (8 agent, 2 ingestion) with one expectation corrected. On dev, final code, `sample.pdf` uploaded through `POST /books/upload` as test user A, three runs, book deleted each time (0 `question_bank` rows before and after): **55 rows; 43 factual, 6 inference, 6 summary; 32 cloze, 11 multiple choice, 6 why/how, 6 main idea, 0 definition; average quality 0.828 (0.64 to 0.94); 6 to 11 per body chunk, 2 for the reference-list chunk**; 0 evidence pieces outside their chunk; ready in 2.93 to 3.65 s, bank complete in 7.05 to 7.79 s; re-running the agent on the same two batches stored 0 rows; server RSS 143 MB idle, 347 MB peak; no error in the server log. Standard checks: ruff 82 errors (baseline), `pytest backend/tests -q` 244 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. Banned-provider grep: the same four files. | 2026-11-10 15:00 | **RSS peak during ingestion is 347 MB on Windows (306 MB before), above the 300 MB G2 line; not measured on Linux.** Generation is about 0.6 s per chunk here, nearly all embedding, so roughly 4 s per chunk on Render by the C4.1 figures (estimate). **Multiple-choice distractors come from the concepts of the batch being processed**, so the same chunks in a different batch give different questions: running all 7 chunks as one batch added 4 rows. Quality gaps seen in the stored rows: a main idea "about licensee mdpi" (a front-matter line the filter misses), 2 questions from the reference-list chunk, vague cloze answers ("design", "model"), weak distractors ("figure", "model achieve"), no definition question. The 642 chunks of the 8 existing dev books have no bank rows; no backfill script was asked for. `times_used` is never written yet. About 350 hand-written lines in one commit |
| [x] C5.5 session tests from the question bank (planned as C5.5a, b and c; one commit as asked) | this commit | `backend/routers/sessions.py` no longer imports the LLM test generator. `POST /sessions/start` queues `assemble_session_test` (new, `backend/services/question_bank.py`) as a background task: it reads the bank rows of the session's chunks, has the question generation agent fill chunks with no rows, picks the questions, stores them in `sessions.test_questions` and increments `times_used`. The picking is the pure `decide` in the new `backend/agents/question_generation/assembler.py`: the default mix from `policy.py` (2 multiple choice, 1 cloze, 1 definition or why/how, 1 main idea, overridable by argument), in each place the least-used question, then the chunk drawn on least, the nearest to the target difficulty, the highest quality; never two questions from one sentence or with one answer; empty places go to the best of the rest; the main idea comes last. `finish-reading` is now one update that returns the row, and assembles on the spot only if the test is not stored yet. `finish-reading` and `GET /sessions/{id}` (including `test_results.questions` and `test_results.answers[].question`) return only `question`, `type` and, for multiple choice, `options`. The response shape the test page reads (`test_questions[].question` and `.type`) is unchanged; because the page shows only the question text, a multiple-choice question lists its options in that text as well. A session with no bank rows at all gets one open summary question. | Graph first: `query.py` on the two endpoints and on `ComprehensionTest.jsx`, which reads `GET /sessions/{id}`. Tests written first: collection errors, then 19 new tests passed (11 assembler, 8 endpoint) after two expectations were corrected. On dev, final code, `sample.pdf` uploaded as test user A, 8 sessions in a row, book deleted afterwards (0 `question_bank` rows and 0 sessions left): **`finish-reading` p50 187 ms, max 197 ms, 5 questions each time** (baseline 1.2 to 1.8 s on LLM fallbacks); `GET /sessions/{id}` p50 184 ms; the test is stored 0.4 s after start; **no `answer`, `evidence`, `key_terms`, `guidance`, `distractors` or `cached_eval` key in either payload, no evidence text, and no answer of an open question**; `times_used` rose on the picked rows only. With the book's bank rows deleted first: test stored after 1.0 s, `finish-reading` 248 ms, 5 questions. Standard checks: ruff 81 errors (baseline 82; one went with the removed code in `sessions.py`, new baseline 81), `pytest backend/tests -q` 263 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. Banned-provider grep: the same four files. | 2026-11-10 15:25 | **Not looked at in a browser**: that multiple-choice options read acceptably inside the question heading of `ComprehensionTest.jsx` is untested, and the page still has no option buttons. **Grading is unchanged**: `submit-answers` was not run; the evaluator still calls Groq and gets the reference answer as `guidance`. `POST /sessions/start` still runs the old planner (1.1 s here). The right option of a multiple-choice question is in `options`, unmarked, by design. On `sample.pdf` chunk 0 all three multiple-choice rows have the answer "design", so a test gets one of them and a second cloze; the main idea is still "about licensee mdpi". If `finish-reading` arrives while the background assembly is still running, the test is assembled twice and `times_used` counted twice. `times_used` is a read then a write, not an atomic increment. An earlier 6-session run had one `finish-reading` at 274 ms. `backend/agents/test_generator_agent.py` and its graph node are left in place, unused by the router, until C8. No backfill for the 8 existing dev books: their chunks are generated on first use. About 570 hand-written lines in one commit, tests included |

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
