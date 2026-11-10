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
| [x] C4.1 embedding service and 🚦 Gate G2 (planned as C4.1a and C4.1b; one commit, and `backend/nlp/embedder.py` instead of `backend/services/local_embeddings.py`, as the C4.1 prompt asks) | this commit | Added `backend/nlp/embedder.py`: one lazily loaded, thread-safe `fastembed` model (`sentence-transformers/all-MiniLM-L6-v2`, 384 dimensions, cache from `FASTEMBED_CACHE`), `embed(texts)` and `embed_one(text)` returning unit-length float32 vectors. Defaults set from the measurements: one ONNX Runtime thread (`EMBED_THREADS` overrides) and four texts per model call. Added `backend/tests/test_embedder.py`, `scripts/dev/measure_embedder.py`, `fastembed==0.9.1` and `numpy==2.4.6` in `requirements.txt`. No long-text windowing: the model truncates at 256 tokens. | Tests written first: collection error (`No module named 'backend.nlp'`), then 9 passed, the real-model test included. Measured (`docs/BENCHMARKS.md`): load 0.67 s and 180 MB RSS on Windows, 4.80 s and 213 MB in a `--cpus=0.1 --memory=512m` container; throttled batch of 32 short texts 1.80 s; throttled batch of 32 chunk-sized texts 18.3 s and 267 MB; whole backend with the model loaded 264 MB on Windows. Standard checks: ruff 83 errors (baseline), `pytest backend/tests -q` 39 passed, lint 22 errors and 2 warnings (baseline), build passes, import exit 0, tooling 61 passed. `make graph` twice, no diff after the second. | 2026-11-10 13:35 | **G2: stopped on `BAAI/bge-small-en-v1.5` (throttled batch of 32 chunk-sized texts 98.1 s against 5 s); the user chose the smaller model, `all-MiniLM-L6-v2`.** With it the gate passes on memory and on short texts; a throttled chunk-sized batch is still 18.3 s, so ingestion (C4.6) embeds in the background. A chunk is represented by its first 256 tokens. The real-model test is skipped where the model is not cached (CI). Whole-backend RSS not measured on Linux; retrieval quality of the two models not compared |
| [ ] C4.2 additive 384-dim vector migration (dev only) | | | | | |
| [ ] C4.3 text utilities | | | | | |
| [ ] C4.4 concept extraction | | | | | |
| [ ] C4.5a hybrid search in the database (dev only) | | | | | |
| [ ] C4.5b hybrid retriever | | | | | |
| [ ] C4.6a local embeddings in ingestion | | | | | |
| [ ] C4.6b re-embed existing dev chunks | | | | | |

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
