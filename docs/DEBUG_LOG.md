# ReadFocus 2.0 — debug log

One entry per failure, newest first, written while following the
`debug-protocol` skill (`.claude/skills/debug-protocol/SKILL.md`).

Rules:

- Create the entry **before** changing any code (step 1 of the protocol).
- Paste the exact command, the exact error and the full stack trace.
- Redact keys, tokens and passwords before pasting.
- Failures that already existed before the sprint (the ruff and ESLint
  baselines in `CLAUDE.md`) are not logged here unless a count goes up.
- Never delete an entry. If a fix is later found to be wrong, add a new
  entry that links to the old one.

## Entry template

Copy everything inside the block below to the top of the "Entries" section
and fill it in.

```markdown
## <YYYY-MM-DD> C<n>.<m> — <symptom>

**Status:** open | fixed | abandoned after 3 attempts

### Symptom
What happened and what was expected. The exact command, the exact error and
the full stack trace:

    <command>
    <error and stack trace>

### Repro
The smallest command or test that fails every time:

    <command>

### Hypotheses
1. <most likely>. Evidence: <...>. Ruled out if: <...>. Result: <confirmed | ruled out, how>
2. <next>. Evidence: <...>. Ruled out if: <...>. Result: <...>
3. <next>. Evidence: <...>. Ruled out if: <...>. Result: <...>

### Root cause
One or two sentences: what was actually wrong, and where (`file:line`).

### Fix
What changed and why it removes the cause. Attempts that failed, if any.

### Regression test
`<test file>::<test name>`. Failed before the fix: <yes/no, output>. Passes
after: <yes/no, output>.

### Commit
`<hash>` fix(<scope>): <subject>
```

## Entries

## 2026-11-11 CD.2 — repo-graph tooling tests fail after the design handoff commit

**Status:** fixed

### Symptom
After CD.2 (`1ba222c`, merged as `fbcc66f` and pushed), the tooling check
and `make graph` fail. Expected: 62 passed, as recorded for CD.2.

    pytest tools/repo_graph/tests -q
    4 failed, 58 passed
    FAILED tools/repo_graph/tests/test_build.py::test_real_graph_covers_routers_and_pages
    FAILED tools/repo_graph/tests/test_build.py::test_real_graph_has_the_schema_and_the_agents
    FAILED tools/repo_graph/tests/test_inventory.py::test_repo_inventory_is_complete_and_deterministic
    >           raise InventoryError(
    E           tools.repo_graph.inventory.InventoryError: purposes.json is out of date.
    tools\repo_graph\inventory.py:151: InventoryError

    make graph
    purposes.json is out of date.
      No purpose (read the file, then add one): ['design/HANDOFF_SUMMARY.md',
      'design/handoff/foundations-style-guide/Main.dc.html',
      'design/handoff/foundations-style-guide/README.md',
      'design/handoff/foundations-style-guide/support.js',
      'design/handoff/foundations-style-guide/vendor/react-dom.js',
      'design/handoff/foundations-style-guide/vendor/react.js']
    make: *** [Makefile:17: graph] Error 1

### Repro

    pytest tools/repo_graph/tests/test_inventory.py::test_repo_inventory_is_complete_and_deterministic -q

### Hypotheses
1. The inventory reads tracked files only (`tracked_files(root)`), and the
   six CD.2 text files have no entry in `purposes.json`. In CD.2 the checks
   ran before `git add`, so the files were untracked and invisible to the
   inventory. Evidence: the error lists exactly those six files; the PNG
   (binary) is not listed. Result: confirmed (see Fix).
2. CD.3's new files broke it. Ruled out: the CD.3 PNGs are untracked and
   binary, and the list names only CD.2 files.

### Root cause
`tools/repo_graph/purposes.json` must hold a hand-written purpose for
every tracked text file. CD.2 added six without purposes, and its checks
ran while the files were still untracked, so the gap only showed after the
commit.

### Fix
Added a purpose for each of the six files to `purposes.json`, read from
the files themselves, and regenerated the graph with `make graph`.

### Regression test
`test_inventory.py::test_repo_inventory_is_complete_and_deterministic`
already covers this: it failed before the fix (4 failed, 58 passed) and
passes after (62 passed). Lesson for the checklist: run the tooling check
after staging new files, not before.

### Commit
`fix(tooling): add repo-graph purposes for the design handoff files`

## 2026-11-10 C7.4 — finish-reading returns 500 once: "Server disconnected" from Supabase

**Status:** fixed after C8.G, see "2026-11-11 C8 follow-up — issue 29" below

### Symptom
In the second of three runs of the C7.4 check against the local backend on
the dev project, the second session's `finish-reading` returned HTTP 500.
The first and third runs passed with the same code path. Server log:

    Background test assembly failed: Server disconnected
    INFO:     "POST /sessions/40f680ae-519f-4a16-853b-a73bbbcb133a/finish-reading HTTP/1.1" 500 Internal Server Error
    ERROR:    Exception in ASGI application
    Traceback (most recent call last):
      ... (httpcore HTTP/2 frames) ...
      File "I:\readfocus\.venv\Lib\site-packages\httpcore\_sync\http2.py", line 443, in _read_incoming_data
        raise RemoteProtocolError("Server disconnected")
    httpcore.RemoteProtocolError: Server disconnected
    The above exception was the direct cause of the following exception:
      ... (uvicorn, starlette and fastapi frames) ...
      File "I:\readfocus\backend\routers\sessions.py", line 102, in finish_reading
        test_questions = await run_in_threadpool(
      File "I:\readfocus\backend\services\question_bank.py", line 66, in assemble_session_test
        supabase.table("sessions").update({"test_questions": questions}).eq("id", session_id).eq("user_id", user_id).execute()
      File "I:\readfocus\.venv\Lib\site-packages\postgrest\_sync\request_builder.py", line 103, in execute
        r = send_with_retry(self.request)
      ... (httpx frames) ...
    httpx.RemoteProtocolError: Server disconnected

### Repro
Not reproducible on demand: 1 of 3 runs of the same script (upload
`sample.pdf`, a first full test, then `POST /sessions/start` followed at
once by `finish-reading`).

### Hypotheses
None tested; the cause is outside this subchunk.
1. Supabase closed an idle HTTP/2 connection and the shared client used it
   once more. Evidence: both the background assembly and the inline retry
   failed with the same error within one request. Ruled out if: it also
   happens on a connection used a moment before.
2. Two threads used the one shared sync client at the same time: the
   background assembly started by `sessions/start` and the inline assembly
   in `finish-reading`, which the script calls immediately. Evidence: both
   were running. C7.2 added one round trip to assembly, which lengthens
   the overlap. Ruled out if: it happens with a pause between the calls.

### Root cause
Not established.

### Fix
None. The failing line (`question_bank.py:66`) and the two callers are
older than C7.4. Recorded as issue 29 in `docs/PROGRESS.md`.

### Regression test
None.

### Commit
None.

### Seen again, 2026-11-11 C8.6 (still open, still outside the subchunk)
Before any C8.6 change, at `a01d635`, with the backend started from
`.claude/launch.json` (`uvicorn backend.main:app --port 8000`) on the dev
project:

    python scripts/bench.py --runs 3 --flow-runs 5

Five flows (upload `sample.pdf`, wait for ready, start, finish-reading,
submit). The table reports `POST /sessions/start` "HTTP 500: Planner failed
to generate a session plan." and `finish-reading` "HTTP 500: Internal
Server Error" for at least one run each (the script keeps only the last
failure's note). Server log, every failure line:

    Background test assembly failed: Server disconnected
    Storing concepts failed for book 3542cd1c-38d5-4a11-aa32-d227368bead4: Server disconnected
    Planner failed for book 3542cd1c-38d5-4a11-aa32-d227368bead4: Server disconnected
    INFO:     127.0.0.1:53151 - "POST /sessions/start HTTP/1.1" 500 Internal Server Error

and one traceback, ending in the same place as above but from a new caller:

      File "I:\readfocus\backend\routers\sessions.py", line 90, in finish_reading
        }).eq("id", session_id).eq("user_id", user_id).execute()
      File "I:\readfocus\.venv\Lib\site-packages\postgrest\_sync\request_builder.py", line 103, in execute
        r = send_with_retry(self.request)
      ... (httpx and httpcore HTTP/2 frames as above) ...
      File "I:\readfocus\.venv\Lib\site-packages\httpcore\_sync\http2.py", line 443, in _read_incoming_data
        raise RemoteProtocolError("Server disconnected")
    httpx.RemoteProtocolError: Server disconnected

New evidence for hypothesis 2: "Storing concepts failed" comes from
ingestion's background batches and "Planner failed" from a request, both
for the same book at the same moment; the bench starts a session as soon
as the book is ready, while ingestion is still running on the one shared
client. The planner makes up to 7 round trips since C8.4a, which widens the
overlap. Not fixed here: it is the shared client in
`backend/services/supabase_client.py`, older than C8, and every caller is
affected. Proposed as its own fix subchunk.

## 2026-11-10 C7.4 — GET /mastery returns 500 for an offset past the last row

**Status:** fixed

### Symptom
In the C7.4 check against the local backend on the dev project, with 8
mastery rows for the caller, `GET /mastery?book_id=<id>&offset=500` returned
HTTP 500. Expected: 200 with an empty page and `total` 8. The unit test for
the same request passed, because the in-memory database returned an empty
list.

    GET http://127.0.0.1:8000/mastery?book_id=<id>&offset=500
    ERROR:    Exception in ASGI application
    Traceback (most recent call last):
      ... (uvicorn, starlette and fastapi frames) ...
      File "I:\readfocus\.venv\Lib\site-packages\fastapi\routing.py", line 372, in run_endpoint_function
        return await dependant.call(**values)
      File "I:\readfocus\backend\routers\mastery.py", line 26, in get_mastery
        page = query.order("mastery").order("concept_key").range(offset, offset + limit - 1).execute()
      File "I:\readfocus\.venv\Lib\site-packages\postgrest\_sync\request_builder.py", line 109, in execute
        raise APIError(dict(json_obj))
    postgrest.exceptions.APIError: {'message': 'Requested range not satisfiable', 'code': 'PGRST103', 'hint': None, 'details': 'An offset of 500 was requested, but there are only 8 rows.'}

### Repro
Against the dev project, as a user with at least one mastery row:

    GET /mastery?offset=500

Offline, once the in-memory database behaves like PostgREST:

    pytest backend/tests/test_api_mastery.py::test_get_mastery_is_paginated -q

### Hypotheses
1. PostgREST answers a range that starts past the last row with an error
   (PGRST103) when an exact count is requested, instead of an empty list,
   and the endpoint does not handle it. Evidence: the error text itself.
   Ruled out if: the same request without the offset also fails. Result:
   confirmed; every request with an offset inside the rows returned 200.

### Root cause
`backend/routers/mastery.py:26` assumed a page past the end is an empty
list. With `count="exact"` PostgREST raises PGRST103 for it. The fake
database in `backend/tests/test_api_sessions.py` returned `[]`, so the
test could not see it.

### Fix
`get_mastery` treats PGRST103 as what it means, an empty page, and asks
for the total with a count-only query; any other API error still raises.
The fake database now raises the same error for a range that starts past
the last row.

### Regression test
`backend/tests/test_api_mastery.py::test_get_mastery_is_paginated` (its
`offset=50` and `offset=7` cases). Failed before the fix: yes, with the
fake raising PGRST103 (`postgrest.exceptions.APIError`). Passes after: yes.
Re-run against dev: `offset=500` returns 200, `items` empty, `total` 8.

### Commit
feat(api): update and expose concept mastery after each test (C7.4); found
before the commit, so there is no separate fix commit.

## 2026-11-10 C7.1 — graph tooling test fails after two more tables are added

**Status:** fixed

### Symptom
After adding `supabase/migrations/008_concept_mastery.sql` and running
`make graph`, the tooling suite went from 61 passed to 1 failed, 60 passed:

    pytest tools/repo_graph/tests -q
    ________________ test_real_graph_has_the_schema_and_the_agents ________________
        def test_real_graph_has_the_schema_and_the_agents():
            graph = build.build_repo()
            tables = {"profiles", "books", "chunks", "sessions", "test_results", "reading_progress", "question_bank"}
    >       assert {to for _, to in edges(graph, "defines_table")} == {f"table:{t}" for t in tables}
    E       AssertionError: assert {'table:books...rogress', ...} == {'table:books...essions', ...}
    E         Extra items in the left set:
    E         'table:user_concept_mastery'
    E         'table:concepts'
    tools\repo_graph\tests\test_build.py:230: AssertionError

### Repro
    pytest tools/repo_graph/tests/test_build.py::test_real_graph_has_the_schema_and_the_agents -q

### Hypotheses
1. The same cause as the C5.1 entry below: the test pins the exact set of
   tables, and 008 defines two new ones on purpose. Evidence: the only
   extra items are `table:concepts` and `table:user_concept_mastery`.
   Ruled out if: any other table is extra or missing. Result: confirmed.

### Root cause
Not a defect in the graph: the expectation at
`tools/repo_graph/tests/test_build.py:229` lists the tables by name, so
every new table has to be added to it.

### Fix
Added `concepts` and `user_concept_mastery` to the expected set. The
assertion stays exact, so a bogus table would still fail it.

### Regression test
The same test. Failed before the change: yes (output above). Passes after:
yes, 61 passed.

### Commit
feat(db): add concepts and concept mastery tables (C7.1); found before the
commit, so there is no separate fix commit.

## 2026-11-10 C6.2 — "a computer" is graded as option (a), wrong, at high confidence

**Status:** fixed

### Symptom
Found in the C6 close review, reading `_grade_closed`. A multiple-choice
answer that starts with a one-letter word is taken for an option letter and
the rest of the answer is ignored. With the options of a real question from
the C6.4 browser check, expecting "computer" (option d):

    python -c "from backend.agents.evaluation.grader import GradeInput, decide; \
      print(decide(GradeInput(question='other _____ companies.', answer='a computer', \
      strategy='multiple_choice', expected='computer', \
      options=['design','computer organization','computer architecture','computer'])))"
    score=0.0 confidence='high' ... method='option'

No exception: a wrong grade, presented as certain. The same for "A computer
company" and "c computer". Also "computer organization" (a full option)
came back `unmatched_option` at low confidence, because "computer" is
inside it and two options matched.

### Repro
    pytest "backend/tests/test_grader.py::test_multiple_choice_reads_the_words_before_a_leading_letter" -q
    5 failed, 5 passed (before the fix)

### Hypotheses
1. `_LETTER` (`^\(?([a-h])\)?[.):]?(?:\s+.*)?$`) accepts any text after the
   letter, and a letter match short-circuits the text match. Evidence: the
   code path; "a computer" matches with group 1 = "a". Ruled out if: the
   grade's method were not `option`. Result: confirmed by the repro.
2. The two-match case: `_ratio` matches an option against any stretch of the
   answer, so a short option inside a longer one matches too. Evidence:
   "computer organization" gives two matches. Result: confirmed.

### Root cause
`backend/agents/evaluation/grader.py`, `_grade_closed`: a leading letter
was trusted over the words that followed it, and options were matched only
as substrings, never as the whole answer.

### Fix
`_chosen_option`: an answer that is nothing but a letter ("a", "(a)", "a.")
picks that option. Otherwise the words decide: the one option equal to the
whole answer (rapidfuzz ratio at least 90), else the one option found
inside it. A letter set off by punctuation ("b) ...") is used only when the
words do not settle it. Anything else is `unmatched_option`, low
confidence, as before. First attempt; no failed attempts.

### Regression test
`backend/tests/test_grader.py::test_multiple_choice_reads_the_words_before_a_leading_letter`
(10 cases). Failed before the fix: yes, 5 of 10. Passes after: yes.

### Commit
fix(agents): read a multiple-choice answer's words before a leading letter

## 2026-11-10 C5.5 — committed repo graph is stale by one file size

**Status:** fixed

### Symptom
At the C5 close, `make graph` on a clean tree at `d20ddc7` changed a
generated file, so the CI `graph` job (`git diff --exit-code
docs/repo-graph/`) would fail:

    make graph
    git diff docs/repo-graph/inventory.json
    -      "size_bytes": 109080,
    +      "size_bytes": 109096,

Expected: no diff.

### Repro
    git stash list            # empty; tree clean apart from untracked skills
    make graph && git diff --exit-code docs/repo-graph/

### Hypotheses
1. A tracked file was edited after `make graph` and before the commit, so
   the inventory holds its old size. Evidence: one `size_bytes` differs, by
   16 bytes, and in C5.5 the row in `docs/PROGRESS.md` was corrected with
   `sed` ("About 480 ..." to "About 570 ..., tests included", 16 bytes
   longer) after the graph and the checks had run. Ruled out if: the entry
   belongs to another file. Result: confirmed, the entry is
   `docs/PROGRESS.md`.

### Root cause
Order of work in C5.5, not the tooling: the tracker was edited after the
graph was regenerated, and `make graph` was not run again before staging.
`inventory.json` records the byte size of every tracked file, including
`docs/PROGRESS.md`.

### Fix
`make graph` re-run and `docs/repo-graph/inventory.json` committed. From
here on the graph is regenerated last, after the tracker and the debug log
are written, and `git diff --exit-code docs/repo-graph/` is checked after
staging.

### Regression test
No new automated test: the CI `graph` job is the check, and it is the
command in the repro. Failed before: yes (the diff above). Passes after:
yes, `make graph` twice with no diff after the commit.

### Commit
`8c4a9fa` fix(graph): regenerate repo graph after the C5.5 tracker edit

## 2026-11-10 C5.1 — graph tooling test fails after a seventh table is added

**Status:** fixed

### Symptom
After adding `supabase/migrations/007_question_bank.sql` and running
`make graph`, the tooling suite went from 61 passed to 1 failed, 60 passed:

    pytest tools/repo_graph/tests -q
    ________________ test_real_graph_has_the_schema_and_the_agents ________________
        def test_real_graph_has_the_schema_and_the_agents():
            graph = build.build_repo()
            tables = {"profiles", "books", "chunks", "sessions", "test_results", "reading_progress"}
    >       assert {to for _, to in edges(graph, "defines_table")} == {f"table:{t}" for t in tables}
    E       AssertionError: assert {'table:books...essions', ...} == {'table:books...test_results'}
    E         Extra items in the left set:
    E         'table:question_bank'
    tools\repo_graph\tests\test_build.py:230: AssertionError

### Repro
    pytest tools/repo_graph/tests/test_build.py::test_real_graph_has_the_schema_and_the_agents -q

### Hypotheses
1. The test pins the exact set of tables the migrations define, and 007
   defines a new one on purpose. Evidence: the only extra item is
   `table:question_bank`, and `query.py question_bank` shows it defined in
   007 and nowhere else. Ruled out if: any other table is extra or missing.
   Result: confirmed.

### Root cause
Not a defect in the graph: the expectation at
`tools/repo_graph/tests/test_build.py:228` lists the tables by name (added
in C2.2b to catch bogus tables), so every new table has to be added to it.

### Fix
Added `question_bank` to the expected set. The assertion stays exact, so a
bogus table would still fail it.

### Regression test
The same test. Failed before the change: yes (output above). Passes after:
yes, 61 passed.

### Commit
feat(db): add question_bank table with RLS (C5.1); found before the commit,
so there is no separate fix commit.

## 2026-11-10 C4.3 — ruff count committed one above the baseline

**Status:** fixed

### Symptom
The C4.3 commit `54fa014` went in with `ruff check backend/` at 84 errors;
the baseline is 83, and the commit message says 83.

    ruff check backend/
    Found 84 errors.
    [*] 1 fixable with `--fix`.

    ruff check backend/nlp backend/tests/test_text.py --output-format concise
    backend\nlp\text.py:12:1: I001 [*] Import block is un-sorted or un-formatted
    Found 1 error.

### Repro
Fails every time at `54fa014`:

    ruff check backend/nlp/text.py

### Hypotheses
1. The `_words` helper added just before the commit sits one blank line
   below the imports, and ruff's import rule wants two before a function.
   Evidence: I001 points at the import block of `text.py`, and the helper
   was the last edit. Ruled out if: adding the blank line leaves I001 in
   place. Result: confirmed; with the blank line the file is clean.

### Root cause
Two things. In the code: `backend/nlp/text.py:12`, one blank line between
the imports and `def _words` (added to clear three SIM905 findings). In the
process: the fix for SIM905, the re-run of the checks and `git commit` were
one shell command with no stop on the ruff count, so the count of 84 was
printed and committed in the same step.

### Fix
Added the blank line. The commit command is no longer chained to the
checks: the checks run and are read first, then the commit is a separate
command. No behaviour change in `text.py`.

### Regression test
None added: the check that catches this is `ruff check backend/` itself,
which is a standard check and runs in CI. Failed before the fix: yes (84
errors, I001 above). Passes after: yes (83 errors, baseline; `ruff check
backend/nlp backend/tests/test_text.py`: All checks passed).

### Commit
fix(nlp): restore ruff baseline after the C4.3 commit

## 2026-11-10 C3.3 — graph tooling test fails after a test imports llm.py

**Status:** fixed

### Symptom
After adding `backend/tests/test_offline.py` and running `make graph`, the
sixth standard check went from 61 passed to 1 failed, 60 passed.

    pytest tools/repo_graph/tests -q
    .......................................................F.....            [100%]
    _______________ test_real_graph_lists_every_agent_that_uses_llm _______________
        def test_real_graph_lists_every_agent_that_uses_llm(capsys):
            assert query.main(["backend/services/llm.py"]) == 0
            out = capsys.readouterr().out
    >       imported_by = out.split("Imported by (4):\n")[1].split("Imports (")[0]
    E       IndexError: list index out of range
    tools\repo_graph\tests\test_query.py:76: IndexError
    1 failed, 60 passed in 0.95s

### Repro
    pytest tools/repo_graph/tests/test_query.py::test_real_graph_lists_every_agent_that_uses_llm -q

Fails every time with the regenerated graph.

### Hypotheses
1. The test hard-codes the number of files that import `llm.py`, and the new
   offline test is a fifth importer. Evidence: `python
   tools/repo_graph/query.py backend/services/llm.py` prints
   `Imported by (5):` with `backend/tests/test_offline.py` last. Ruled out
   if: the output still says `(4)`. Result: confirmed.

### Root cause
`tools/repo_graph/tests/test_query.py:76` split the output on the literal
`Imported by (4):`. The test is about which agents use `llm.py`, but it
asserted the total number of importers, so any other importer broke it. The
graph and `query.py` are correct.

### Fix
The test now takes the "Imported by" section whatever its count and compares
only the paths under `backend/agents/`. The offline test keeps its import of
`llm.py`: checking that the LLM client is the fake is its purpose. First
attempt; no failed attempts.

### Regression test
The same test, `test_query.py::test_real_graph_lists_every_agent_that_uses_llm`.
Failed before the fix: yes (`1 failed, 60 passed`). Passes after: yes
(`61 passed`).

### Commit
test: isolate manual scripts and make backend tests run offline

## 2026-11-10 C3.1 — any raw UUID is accepted as a bearer token

**Status:** fixed

### Symptom
Found by reading in C2.1 (issue 10, audit section 8.1), not by a crash.
`get_current_user` returned the bearer token itself as the user id when the
token was 36 characters with four hyphens, in every environment. Expected: a
401 for anything Supabase Auth does not accept.

    pytest backend/tests/test_auth.py -q
    FAILED backend/tests/test_auth.py::test_raw_uuid_token_is_rejected - Failed: DID NOT RAISE HTTPException
    FAILED backend/tests/test_auth.py::test_raw_uuid_token_is_rejected_in_development
    2 failed, 3 passed in 0.87s

### Repro
    pytest backend/tests/test_auth.py::test_raw_uuid_token_is_rejected -q

Fails every time before the fix.

### Hypotheses
1. The "Local Dev Bypass" block returns before `supabase.auth.get_user` is
   called and checks nothing but the token's shape. Evidence:
   `backend/dependencies.py:13-18` at `052c9af`. Ruled out if: the fake
   `get_user` sees the UUID. Result: confirmed; `get_user` was never called.

### Root cause
`backend/dependencies.py:16-17` (at `052c9af`): a development shortcut with
no check of `ENV`, in front of the real token check. With the service-role
client behind every query, a known user id was full access to that account.

### Fix
The block is deleted, not gated: the two dev test users in `.env.test` sign
in for real JWTs, so nothing needs the shortcut. Every token now goes to
`supabase.auth.get_user`. First attempt; no failed attempts.

### Regression test
`backend/tests/test_auth.py::test_raw_uuid_token_is_rejected` and
`::test_raw_uuid_token_is_rejected_in_development`. Failed before the fix:
yes (`2 failed, 3 passed`). Passes after: yes (`5 passed`).

### Commit
security(api): remove raw-UUID authentication bypass in production

## 2026-11-10 C2.3 — inventory gives test_generator_agent.py the role "test"

**Status:** fixed

### Symptom
The first render of REPO_MAP.md showed four agents in the Agents layer, not
five: `backend/agents/test_generator_agent.py` was missing, and so were its
links to `graph.py` and `sessions.py`. `inventory.json` (committed in C2.1,
`8394912`) records it as a test. Expected role: `agent`.

    python -c "from tools.repo_graph import inventory; print(inventory.role('backend/agents/test_generator_agent.py'))"
    test

No exception; the classification is wrong.

### Repro
    python -c "from tools.repo_graph import inventory; print(inventory.role('backend/agents/test_generator_agent.py'))"

Prints `test` every time.

### Hypotheses
1. `role()` treats any `test_*.py` as a test wherever it lives, and that
   check runs before the path-prefix rules. Evidence: the file name starts
   with `test_`; `inventory.py` checks the name before `ROLE_BY_PREFIX`.
   Ruled out if: a file named `test_x.py` under `backend/agents/` gets
   `agent`. Result: confirmed by reading `role()` and by the regression
   case below failing before the change.

### Root cause
`tools/repo_graph/inventory.py`, `role()`: the name rule `test_*.py` applied
to every directory and ran before the path-prefix rules, so the test
generator agent was classified by its name instead of its location.

### Fix
The name rule now applies only at the repo root, where the eight manual
`test_*.py` scripts live; elsewhere a file is a test only inside a `tests/`
directory. First attempt; no failed attempts.

### Regression test
`tools/repo_graph/tests/test_inventory.py::test_role`, cases
`backend/agents/test_generator_agent.py -> agent` and
`frontend/src/lib/test_utils.py -> lib`. Failed before the fix: yes
(`2 failed, 35 passed`). Passes after: yes (`37 passed`).

### Commit
fix(graph): classify test_generator_agent.py as an agent, not a test

## 2026-11-10 C2.2b — graph tooling scanned itself and reported tables that do not exist

**Status:** fixed

### Symptom
After adding the table, function and env extractors, the real graph had
table nodes `x` and `results` and a function node `fn`. Expected: the six
tables and two functions the migrations define.

    python tools/repo_graph/build.py
    162 nodes, 255 edges, 0 unresolved -> docs/repo-graph/graph.json
    reads_table   x <- build.py        writes_table  results <- test_build.py
    calls_function  fn <- build.py     uses_env  ENV <- test_build.py

No exception; the output was wrong.

### Repro
    python tools/repo_graph/build.py
    python -c "import json; g=json.load(open('docs/repo-graph/graph.json')); print(sorted(n['id'] for n in g['nodes'] if n['type']=='table'))"

### Hypotheses
1. The regexes match the examples in `build.py`'s docstring and the fixture
   source strings in `test_build.py`. Evidence: every bogus edge starts at
   one of those two files, and `x`, `fn` and `results` appear there
   literally. Ruled out if: a bogus edge starts anywhere else. Result:
   confirmed; no other file was involved.

### Root cause
The regex extractors scan file text, not parsed code, so the tooling's own
quoted patterns look like real usage (`tools/repo_graph/build.py`,
`build_graph`).

### Fix
Files under `tools/repo_graph/` are scanned for imports only
(`SELF_PREFIX`). 162 nodes and 255 edges became 159 and 244.

### Regression test
`tools/repo_graph/tests/test_build.py::test_real_graph_has_the_schema_and_the_agents`
now asserts the table nodes are exactly the six from the migrations. The
assertion was added after the bogus tables were seen in the output; it was
not run in isolation against the unfixed code. Passes after: yes, 48 passed.

### Commit
feat(graph): add table, env, external service and LangGraph edges (C2.2b);
the bug never reached a commit, so there is no separate fix commit.

## 2026-11-11 C8.5 — submit returns 500 when no question names a concept

**Status:** fixed

### Symptom
After chaining the submit flow (evaluator -> knowledge_state -> ...), one
existing session test failed with a server error instead of a 200:

    pytest backend/tests/test_api_sessions.py::test_a_question_with_no_evidence_is_graded_against_the_passage_at_low_confidence -q

    backend\agents\knowledge_state\agent.py:72: in knowledge_state_node
        updates = report.pop("updates")
    E   KeyError: 'updates'
    E   During task with name 'knowledge_state' and id 'cb7db64f-e2ef-1cf7-eee0-31181a00f195'
    1 failed in 1.63s

Expected: the test's only question (the fallback question) names no concept,
so the knowledge state moves nothing and the run goes on to the planner.

### Repro
The command above fails every time.

### Hypotheses
1. `record_test` returns early when no question names a concept and that
   return ignores `with_updates`, so the report has no `updates` key.
   Evidence: `agent.py:44`, `if not grades: return {"questions": 0,
   "concepts": 0}`. Ruled out if the early return is not taken for this
   test. Result: confirmed; the fallback question has no `concept_keys`.
2. The node's `except` misses the error because it is raised after the
   `try`. Evidence: line 72 is after the `try` block. Result: true, but a
   consequence of 1, not a cause.

### Root cause
`record_test`'s early return (`backend/agents/knowledge_state/agent.py:44`)
did not honour `with_updates`, added in C8.4b. In C8.4b the node only ran
inside `apply_test`, whose catch-all logged the `KeyError` in the background,
so no test saw it; chained into the submit flow, it fails the request.

### Fix
The early return goes through the same report-building line as the normal
return, so `with_updates=True` always gives an `updates` list. No change to
the `except`: catching everything around the pop would hide the next bug.

### Regression test
`backend/tests/test_agent_nodes.py::test_a_test_that_names_no_concept_moves_nothing`.
Failed before the fix (`KeyError: 'updates'`); passes after.

### Commit
C8.5 commit, feat(agents): chain evaluator, knowledge state, optimizer and planner in LangGraph

## 2026-11-11 C8.5 — the LangGraph diagram shows nodes from a test file

**Status:** fixed

### Symptom
After `make graph` in C8.5, the "LangGraph wiring" diagram in
`docs/repo-graph/REPO_MAP.md` had three nodes the app does not have:

    graph_node___start__ --> graph_node_first
    graph_node_first --> graph_node_silent
    graph_node_silent --> graph_node_second
    graph_node_second --> graph_node___end__

Expected: only the five agent nodes and their edges from `backend/agents/graph.py`.

### Repro
    python tools/repo_graph/query.py first

lists `backend/tests/test_agent_state.py` as registering the node. The toy
graph there was added in C8.3, so the committed map has been wrong since
`8e8f5ca`; no tooling test looked at the real diagram's node set.

### Hypotheses
1. `py_edges` reads `add_node` / `add_edge` calls in every scanned Python
   file, tests included. Evidence: `tools/repo_graph/build.py:260-276`
   has no role check. Ruled out if the test file is excluded elsewhere.
   Result: confirmed; only `tools/repo_graph/` is excluded (`SELF_PREFIX`).

### Root cause
`build_graph` passes every Python file outside the tooling to `py_edges`,
which treats any `add_node` call as app wiring
(`tools/repo_graph/build.py:344`).

### Fix
LangGraph wiring is read only from files whose inventory role is not
`test`; tables, services and imports of test files are still scanned as before.

### Regression test
`tools/repo_graph/tests/test_build.py::test_a_graph_built_in_a_test_file_is_not_wiring`.
Failed before the fix (the toy node was in the graph); passes after.

### Commit
C8.5 commit, feat(agents): chain evaluator, knowledge state, optimizer and planner in LangGraph

## 2026-11-11 C8.5 — abandoning a session halves the pace again after one bad test (issue 31)

**Status:** fixed

### Symptom
In the C8.6 check on the dev project (scratchpad script, test user A): a
first test scored 1/50, so the submit run's optimizer moved the multiplier
1.0 -> 0.5 (band `fail`). Abandoning the next session then stored a pace
recommendation with band `none` and rules `['rolling_fail']`: the abandon
run applied the earlier tests' band again. Expected: a run with no test
holds the multiplier, and only the abandonment rule can lower it.

### Repro
    pytest "backend/tests/test_optimizer_pace.py::test_a_run_with_no_test_holds_the_multiplier" -q

### Hypotheses
1. Rule 7 of `backend/agents/optimizer/pace.py` (my C8.5 change) takes the
   factor from the earlier tests' rolling band when `percentage` is None,
   but those tests already moved the multiplier when they were submitted.
   Evidence: `pace.py:129-135` builds the window from `recent_percentages`
   alone and reads the factor from its band. Ruled out if the abandon run
   got a different `previous_multiplier`. Result: confirmed; the stored
   rules name `rolling_fail` and the window is the submitted test's 2%.

### Root cause
`decide` (`backend/agents/optimizer/pace.py:135`) applied a factor to the
same scores twice: once when each test was submitted, again on any later
run without a test. The C8.5 test `test_no_test_follows_the_earlier_tests_
and_abandonment` asserted that behaviour (1.15 after earlier 90 and 85).

### Fix
With no test the factor is 1.0 (rule `no_test_hold`); the rolling mean is
still reported, and the abandonment cap still applies. The C8.5 test that
asserted the double application now asserts the hold.

### Regression test
`backend/tests/test_optimizer_pace.py::test_a_run_with_no_test_holds_the_multiplier`.

### Commit
fix(agents): hold the pace on a run with no test

## 2026-11-11 C8.5 — abandoning a re-read loses the section from the queue (issue 32)

**Status:** fixed

### Symptom
In the C8.6 check on the dev project: after a 1/50 test the next session
was a re-read of section 1 (the planner took index 0 off the queue at
start). That session was abandoned; the stored progress then had
`re_read_queue: []`, so the following start would plan new reading and
the section the reader failed is never re-read. Expected: an abandoned
re-read goes back to the front of the queue.

### Repro
    pytest "backend/tests/test_graph.py::test_an_abandoned_re_read_goes_back_to_the_front_of_the_queue" -q

### Hypotheses
1. The planner pops the queue on `start_session` (C8.5) and the abandon
   flow leaves the queue as it is (`pace.py` `_queue`, band `none`), so
   nothing puts the section back. Evidence: `planner_agent.py` pop and
   `pace.py` `elif band != "none"`. Ruled out if the queue was empty
   before the start. Result: confirmed; the queue was `[0]` before the
   second start and `[]` after the abandon.

### Root cause
Two C8.5 choices that are each right alone: popping at start (so the plan
after a submit is only a preview) and leaving the queue alone on a run
with no test. Together they drop an abandoned re-read
(`backend/agents/optimizer/pace.py`, `_queue`).

### Fix
`OptimizerInput.already_read`: the optimizer node sets it when every
section of the session is at or before the reader's last section read,
which is what a re-read (or a review) is. With no test and
`already_read`, `_queue` puts the session's sections back at the front.
An abandoned new-reading session is not queued.

### Regression test
`backend/tests/test_graph.py::test_an_abandoned_re_read_goes_back_to_the_front_of_the_queue`
and `backend/tests/test_optimizer_pace.py::test_an_abandoned_re_read_is_queued_first`.

### Commit
fix(agents): put an abandoned re-read back at the front of the queue

## 2026-11-11 C8.G — Gate G3 check 1: the provider grep matches the C8.8 guard test

**Status:** fixed

### Symptom
The first Gate G3 check, at `cc3a051`, expects no matches:

    grep -rniE "groq|ChatGroq|google_genai|GoogleGenerativeAI|openai|cerebras|sambanova|openrouter" backend/ requirements.txt render.yaml

and printed (exit 0):

    backend/tests/test_no_paid_ai.py:17:    "groq", "langchain_groq", "openai", "langchain_openai", "anthropic", "langchain_anthropic",
    backend/tests/test_no_paid_ai.py:18:    "langchain_google_genai", "google_genai", "cerebras", "sambanova", "openrouter",
    backend/tests/test_no_paid_ai.py:23:    "groq", "langchain-groq", "openai", "langchain-openai", "anthropic", "langchain-anthropic",
    backend/tests/test_no_paid_ai.py:25:    "cerebras-cloud-sdk", "sambanova", "openrouter",
    backend/tests/test_no_paid_ai.py:27:BANNED_KEYS = re.compile(r"GROQ|GOOGLE_AI_STUDIO|GEMINI|OPENAI|ANTHROPIC|CEREBRAS|SAMBANOVA|OPENROUTER")

No application file, dependency or config line matched: only the guard
test's own deny-list.

### Repro
The command above.

### Hypotheses
1. The deny-list lives under `backend/`, which the gate greps. Evidence:
   every match is in `backend/tests/test_no_paid_ai.py` lines 17-27.
   Ruled out if another file matches. Result: confirmed.

### Root cause
C8.8 put the list of banned providers inside the test that enforces it,
under `backend/tests/`, so a text search for providers over `backend/`
finds the list itself (`backend/tests/test_no_paid_ai.py:17-27`).

### Fix
The deny-list moves to `tools/no_paid_ai.py` (tooling, outside the
application and outside the gate's paths), next to the repo graph's own
list of banned services; the test imports it and checks the same things.
`backend/` then names no provider anywhere. Not a loosened check: the test
enforces the same modules, packages and keys, and gains a test that
`backend/` contains none of the names at all, which is the gate's grep.

### Regression test
`backend/tests/test_no_paid_ai.py::test_backend_names_no_provider`: the
gate's grep in Python. Fails before (the deny-list is in `backend/`),
passes after.

### Commit
fix(api): move the paid-AI deny-list out of backend/

## 2026-11-11 C8 follow-up — issue 29: the shared HTTP/2 connection breaks under threads

**Status:** fixed

### Symptom
"httpx.RemoteProtocolError: Server disconnected" from the shared Supabase
client, failing `sessions/start`, `finish-reading` and background test
assembly and concept storage while a book is still ingesting (C7.4 entry
above, seen again at `a01d635` in C8.6).

### Repro
A scratchpad script (not committed) against the dev project: one shared
client, N threads, each looping a select (GET), an update that matches no
row (PATCH) and an insert the CHECK constraint refuses (POST); nothing is
written.

    python repro_issue29.py http2 8 25   # the app's client as it was

Two runs: 29 and 5 errors out of 600 calls, all on that client:
`RemoteProtocolError: <ConnectionTerminated error_code:1, last_stream_id:309, ...>`,
`RemoteProtocolError: Server disconnected`, `LocalProtocolError` and
`KeyError` raised from inside `h2`. Fails every run with 8 threads.

### Hypotheses
1. One HTTP/2 connection is shared by several threads (request threadpool,
   ingestion's background thread, background tasks) and httpcore's sync
   HTTP/2 connection is not safe for that; one broken stream ends the
   connection for every request on it. Evidence: `postgrest/_sync/client.py`
   builds its `httpx.Client` with `http2=True`; the `KeyError` and
   `LocalProtocolError` are protocol-state corruption, not a server
   decision. Ruled out if one thread also fails. Result: confirmed; one
   thread, 150 calls, 0 errors; 8 threads fail every run.
2. Supabase closes idle connections (GOAWAY) and only GET is retried.
   Evidence: `send_with_retry` retries GET/HEAD only. Ruled out if the
   errors stop without changing retries. Result: contributes (the POST and
   PATCH failures are never retried) but is not the cause: with HTTP/1.1
   and the same retries, 0 errors.

### Root cause
`backend/services/supabase_client.py` used supabase-py's default transport,
one multiplexed HTTP/2 connection (`http2=True` in postgrest's client),
from many threads at once.

### Fix
The shared client gets its own `httpx.Client(http2=False)` through
`ClientOptions(httpx_client=...)`: HTTP/1.1 with httpx's thread-safe
connection pool, one connection per concurrent request; the timeout stays
postgrest's 120 s. Auth, PostgREST and Storage all use it.

    python repro_issue29.py http1 8 25   # 0 errors, 6.9 s (HTTP/2: 10.0 s)
    python repro_issue29.py ours 8 25    # the app's new client: see below

### Regression test
`backend/tests/test_supabase_client.py`: the client is built with an
`httpx` client that has HTTP/2 off. Failed before (no `make_client`), passes
after. The network behaviour itself is the repro above, not an offline
test.

### Commit
fix(backend): give the shared Supabase client an HTTP/1.1 pool

## 2026-11-11 C8 follow-up — issue 33: a resubmitted session is graded and paced again

**Status:** fixed

### Symptom
From the code (C8.7): `submit-answers` for a session that is already
`completed` runs the whole submit flow again. Mastery moves once (the
`last_event_id` guard), but the evaluator inserts a second `test_results`
row and the optimizer moves the pace and re-read queue a second time.

### Repro
    pytest "backend/tests/test_api_sessions.py::test_a_resubmitted_session_returns_the_stored_result_and_runs_nothing_again" -q

Fails before the fix: two `test_results` rows, two submit runs.

### Hypotheses
1. `submit_answers` never looks at the session's status and marks it
   `completed` only after the run, so neither a later resubmit nor a
   concurrent one is stopped. Evidence: `backend/routers/sessions.py`,
   the select and the final update. Result: confirmed.

### Root cause
No guard and no claim on the session in `submit_answers`
(`backend/routers/sessions.py`).

### Fix
The session is claimed before the run with a conditional update
(`status` not `completed` -> `completed`); a session already completed,
or a claim lost to a concurrent submit, gets the stored result rebuilt
from `test_results` and the current pace recommendation, in the same
response shape, with nothing re-run (409 if no result is stored yet). If
grading fails, the claim is released so the reader can submit again. The
page is unchanged: a resubmit now gets a 200 with the same score instead
of a second grading.

### Regression test
`test_a_resubmitted_session_returns_the_stored_result_and_runs_nothing_again`,
`test_a_failed_grading_releases_the_session_for_another_try`,
`test_a_completed_session_with_no_stored_result_is_a_conflict`
(`backend/tests/test_api_sessions.py`). With the fix stashed 2 failed and
1 passed (the release test: the old code never claimed the session, so it
guards the new claim rather than reproducing the bug); restored 3 passed. `test_a_cached_grade_is_reused...` resubmitted on
purpose; it now puts the session back to `testing` first.

### Commit
fix(api): grade a session once and replay its result on resubmit

## 2026-11-11 C8 follow-up — issue 34: a session's test is assembled and stored twice

**Status:** fixed

### Symptom
The stored node durations of every benchmark session showed two
`finish_reading` runs: `finish-reading` called right after `start` runs the
test generator inline while the background run from `start` is still going.
Both store a test with an unconditional update, so the later one overwrites
the earlier, and `question_bank.times_used` goes up twice. If the
background run stores last, the test graded is not the one the reader was
shown.

### Repro
    pytest "backend/tests/test_api_sessions.py::test_a_second_assembly_returns_the_stored_test_and_counts_nothing" -q

Fails before the fix: the second assembly overwrites the stored test and
counts its questions again. On dev (scratchpad script, start then
finish-reading at once, 3 sessions) the old code showed the stored test
in all 3: there the inline run stored last, so the mismatch itself was not
reproduced; the double run and double count were.

### Hypotheses
1. `assemble_session_test` stores with an unconditional update and counts
   use even when another run already stored a test. Evidence:
   `backend/services/question_bank.py`, the `sessions` update and the
   `times_used` loop. Result: confirmed by the test.

### Root cause
The store in `assemble_session_test` (`backend/services/question_bank.py`)
was not conditional, so overlapping runs both wrote.

### Fix
The store is conditional on `test_questions is null`; the run that finds a
test already stored returns that test and counts nothing. finish-reading
therefore always shows the test that is graded.

### Regression test
`test_a_second_assembly_returns_the_stored_test_and_counts_nothing`
(fails before, passes after) and
`test_finish_reading_shows_the_test_that_is_graded` (passes before too:
the fake runs the two in order; it guards the response). On dev with the
fix: 3 of 3 sessions show the stored test.

### Commit
fix(api): store a session's test once

## 2026-11-11 C9.1a — repo-graph test does not know processing_jobs

**Status:** fixed

### Symptom
After adding `supabase/migrations/010_processing_jobs.sql` and running
`make graph`, the tooling check failed:

    pytest tools/repo_graph/tests -q
    FAILED tools/repo_graph/tests/test_build.py::test_real_graph_has_the_schema_and_the_agents
    >       assert {to for _, to in edges(graph, "defines_table")} == {f"table:{t}" for t in tables}
    E       AssertionError: assert {'table:agent...rofiles', ...} == {'table:agent...on_bank', ...}
    E         Extra items in the left set:
    E         'table:processing_jobs'
    tools\repo_graph\tests\test_build.py:233: AssertionError
    1 failed, 61 passed

### Repro

    pytest tools/repo_graph/tests/test_build.py::test_real_graph_has_the_schema_and_the_agents -q

### Hypotheses
1. The test pins the set of tables defined by the migrations, and 010
   adds one. Evidence: the only extra item is `table:processing_jobs`;
   the same failure came with 008 (C7.1) and 009 (C8.6). Ruled out if:
   the graph shows a table that no migration creates. Result: confirmed,
   010 creates exactly that table.

### Root cause
`tools/repo_graph/tests/test_build.py:228` lists the expected tables by
name; the list did not include the new `processing_jobs`.

### Fix
Added `processing_jobs` to the expected set. The graph builder is right;
only the test's expectation was out of date.

### Regression test
The same test. Failed before the fix (above); passes after: `pytest
tools/repo_graph/tests -q` 62 passed.

### Commit
feat(ingest): add processing_jobs and the job service (C9.1a)

## 2026-11-11 C9.5 — long book's chunk 0 questions seen 2.5 s before ready

**Status:** fixed

### Symptom
Since C9.2, `run_job` marks the book ready right after the first batch's
questions are stored, so `upload -> chunk 0 questions` should never be
earlier than `upload -> ready`. The C9.5 Windows run of the 204-chunk EPUB
reported otherwise (`sample.pdf` in the same run showed both at 4.81 s):

    python scripts/bench.py --ingest sample.pdf .cache/bench/pride-and-prejudice.epub --flow-runs 3 --cold --quiet 30
    | `upload -> ready (pride-and-prejudice.epub)` | 3 | 4.86 s | 4.86 s | |
    | `upload -> chunk 0 questions (pride-and-prejudice.epub)` | 3 | 2.39 s | 2.42 s | |

No error or stack trace: a wrong result.

### Repro
A scratchpad script (not committed) starts the backend, uploads the EPUB
as test user A, then polls `GET /books/{id}/status` and the chunk 0
question count every 0.1 s, stamping each with the moment its answer
arrived, and finally times one bench iteration's parts:

    chunk 0 questions first seen at 5.45 s; status read just before: 'processing' at 5.18 s
    first ready 5.82 s, first chunk-0 questions 5.45 s
    status: 748 ms
    ingest_state (4 counts): 1117 ms
    server_rss: 9 ms

### Hypotheses
1. The bench stamps both observations with the time at the top of the
   poll iteration, reads the status before the counts, and one iteration
   takes about 2.9 s (status 0.75 s, four counts 1.1 s, sleep 1 s); a
   change that lands between the two reads gets its ready stamp one
   iteration late. Evidence: the gap (2.47 s) is about one iteration;
   `sample.pdf` showed both at the same stamp. Ruled out if a tight,
   separately stamped poll shows ready before the questions or a gap of
   seconds. Result: confirmed; the tight poll shows a gap of 0.37 s.
2. `run_job` stores the questions and marks the book ready seconds
   apart. Evidence: none beyond the symptom. Ruled out if the tight poll
   shows ready within one or two round trips of the questions. Result:
   ruled out: 0.37 s, about the `mark_ready` update. The questions coming
   first is the C9.2 order (questions, then ready), not a defect; the
   C9.5 note that the order "should not allow" it was wrong.

### Root cause
`scripts/bench.py` `measure_ingest` takes `now` once per poll iteration
and uses it for the status read and for the count read that follows
about 0.75 s later; with a 2.9 s iteration, ingestion times have about
3 s resolution and `ready` is biased late against the counts.

### Fix
Stamp each observation with the time its own answer arrived (the status
after the status call; questions, counts and done after the counts).
The sampling stays coarse (one reading per iteration, about 3 s on
Windows), so the bench cannot order `ready` and the first questions; the
tight poll above is the evidence for the order. `docs/BENCHMARKS.md` C9.5
says so, replaces the After ingestion tables with a rerun on the fixed
script, and withdraws the C9.5 note that the order "should not allow" the
reading.

### Regression test
`backend/tests/test_bench.py::test_measure_ingest_stamps_each_reading_when_it_arrives`:
a fake clock and a book that turns ready while the counts are read.
Failed before the fix (`1 failed, 9 passed`); passes after (`10 passed`).

### Commit
fix(tooling): stamp each bench reading when it arrives

## 2026-11-11 C9.3 — a grade during the model load freezes the server; a failed preload is never retried

**Status:** fixed

### Symptom
Found in the C9 close review of `backend/nlp/embedder.py` (no failure seen
in a run yet). `preload()` takes `_lock` to start its thread, and
`get_model()` holds the same `_lock` for the whole model load (seconds,
about 5 s plus a 12 s download at 0.1 CPU). `require_model` runs on the
event loop and calls `ensure_loading()` -> `preload()` whenever the model
is not ready, so a `submit-answers` or `evaluate-single` that arrives
during the startup load blocks the event loop until the load finishes:
`/health` and every other request stall, against the C9.3 goal that
`/health` never waits for the model. Second defect: if the preload fails,
`_preload_thread` stays set, `ensure_loading()` never starts another load,
and every grade waits 20 s and gets a 503 until a restart (before C9.3
the next grade loaded the model again).

### Repro

    pytest backend/tests/test_embedder.py -q -k "ensure_loading"

(the two regression tests below, written before the fix)

### Hypotheses
1. Lock sharing: `preload()` and `get_model()` use one lock. Evidence:
   the code. Ruled out if `ensure_loading()` returns at once while another
   thread holds the load. Result: see Regression test.
2. One-shot preload: `_preload_thread` is never cleared after a failure.
   Evidence: the code. Ruled out if a second `ensure_loading()` after a
   failed preload starts a new load. Result: confirmed (test 2 below
   failed before the fix).
   Hypothesis 1 result: confirmed (test 1 below failed before the fix).

### Root cause
`backend/nlp/embedder.py` `preload()` guarded `_preload_thread` with
`_lock`, the lock `get_model()` holds while loading, and never replaced a
preload thread that had ended without a model.

### Fix
`preload()` now uses its own `_preload_lock`, never held during a load, so
`ensure_loading()` returns at once while a load runs; and it starts a new
thread when the previous one ended without the model being ready.

### Regression test
`backend/tests/test_embedder.py::test_ensure_loading_does_not_wait_for_a_load_in_progress`
and `::test_ensure_loading_retries_after_a_failed_preload`. Before the
fix: `2 failed` (the first waited for the whole fake load). After: 15
passed in `test_embedder.py`; `pytest backend/tests -q` 608 passed.

### Commit
fix(api): never wait on the model load lock, and retry a failed preload

## 2026-11-11 C10.1 — dashboard stat row overflows at 375 px

**Status:** fixed

### Symptom
Found in the C10.1 audit (issue U4, P0): at 375 x 812 the dashboard
scrolled sideways (`document.documentElement.scrollWidth` 385 with test
user A's data) and the "Books in progress" label was cut off. Expected: no
horizontal scroll at 375 px. No error or stack trace; a layout fault. With
no data the page itself fits, but the row's content (322 px) still spills
out of its 279 px card.

### Repro
Vite dev server, signed in, viewport 375 x 812, `/dashboard`, then in the
console (stat values set to realistic lengths so the result does not
depend on the account's data):

    const v=[...document.querySelectorAll('.rf-dash-stat-value')];
    ['365','184200','12'].forEach((t,i)=>v[i].textContent=t);
    const r=document.querySelector('.rf-dash-stats-row');
    [r.clientWidth, r.scrollWidth, document.documentElement.scrollWidth]

Before the fix: `[277, 406, 455]`, every time.

### Hypotheses
1. Fixed desktop spacing does not fit: the row has `gap: 32px` between
   five children (three stats, two dividers: 128 px) and `padding: 24px
   32px` (64 px across), inside a container that adds its own 24 px gutter on top of
   the layout's 24 px. Evidence: measured min-content widths 47 + 47 + 68
   px, dividers shrunk to 0, so 162 + 128 + 64 + 2 = 356 px needed in 279
   px. Ruled out if: removing that spacing in the console leaves the
   overflow. Result: **confirmed**; with the spacing reduced and the
   container padding removed, the row is 325 px with nothing overflowing.
2. Long stat values in a 32 px monospace font force the overflow on their
   own. Evidence: "184200" in DM Mono 32 px is wider than a third of the
   row. Result: **contributes**; with hypothesis 1 fixed but 32 px values,
   six digits still need more than a third of the row, so the values drop
   to 24 px under 640 px.

### Root cause
`frontend/src/pages/Dashboard.css:9-13` and `:53-62`: the container's
24 px side padding doubles the layout's gutter, and the stat row keeps its
desktop gap (32 px) and padding (32 px) at every width; nothing lets the
stats shrink.

### Fix
`frontend/src/pages/Dashboard.css`, one `@media (max-width: 639px)` block
(640 px is the C10 small breakpoint, A9): no container padding (the
layout's gutter is enough), row gap 12 px and padding 16 px, stats
`flex: 1 1 0; min-width: 0`, values 24 px. Desktop is unchanged.

### Regression test
No automated test: the frontend has no test runner and the fault is
layout, only measurable in a browser. Manual check instead, the repro
above: before `[277, 406, 455]`, after `[325, 325, 375]`; also with the
account's real data (all zeros) row 325/325, page 375. At 1440 x 900 the
row is unchanged: 622 px, gap 32 px, padding 24px 32px, values 32 px,
container padding 0 24px.

### Commit
fix(ui): fit the dashboard stat row on 375 px screens

## 2026-11-11 C11.1 — repo graph lists Vite asset imports as unresolved

**Status:** fixed

### Symptom
`make graph` after staging C11.1 printed `300 nodes, 500 edges, 7
unresolved` (0 before). The seven entries were the illustration
components' `import svg from './svg/<Name>.svg?raw'`. The files exist; no
check failed, but `unresolved` is meant for broken references only.

### Repro
`pytest tools/repo_graph/tests -q` with the fixture page importing
`'../illustrations/svg/Shelf.svg?raw'`: `test_js_imports` fails, the
import is in `graph["unresolved"]`.

### Hypotheses
1. The resolver joins the specifier with its `?raw` query, so no path can
   match. Evidence: `js_edges` normalises `spec` as is. Result:
   **contributes**; stripping the query alone still misses.
2. SVG files are not inventoried (`inventory.BINARY_EXTENSIONS`), so even
   the bare path is not in `paths`. Result: **confirmed**.

### Root cause
`tools/repo_graph/build.py` `js_edges`: imports resolve only against
inventoried text files, and the specifier's query was kept.

### Fix
Strip `?query` before resolving; an import of a binary-extension file that
does not resolve is skipped (an asset, not a code edge). A missing `.js`
or `.jsx` import is still listed as unresolved.

### Regression test
`tools/repo_graph/tests/test_build.py::test_js_imports`: the fixture page
imports `Shelf.svg?raw` and the test asserts it is not unresolved. Failed
before (1 failed, 61 passed), passes after (62 passed).

### Commit
Part of feat(design): add original SVG illustration set (C11.1), since the
graph regeneration in that commit needs it.

## 2026-11-11 C11.2 — a book with a cover on Open Library stored "none" (search terms)

**Status:** fixed

### Symptom
`python scripts/backfill_covers.py --book-id 58a7d7e4-…` on dev saved
`cover_source = 'none'` for *Digital Design and Computer Architecture*,
which Open Library has. No error; a wrong result.

### Repro
The lookup terms for that book: metadata title `Digital Design and
Computer Architecture (4th Edition)`, author `David Harris, Sarah Harris`.
`search.json` with those returns no docs; with `Digital Design and
Computer Architecture` and `David Harris` it returns cover 10140705.

### Hypotheses
1. The edition note in brackets makes the title search miss. Result:
   **confirmed** (together with 2).
2. A list of authors in one string matches no single author. Result:
   **confirmed**.

### Root cause
`backend/services/covers.py` `lookup_terms` passed the metadata strings
unchanged.

### Fix
Drop bracketed notes and a subtitle after ':' from the title; keep the
first author (split on `,`, `;`, `&`, `and`).

### Regression test
`test_covers.py::test_lookup_terms_drop_editions_subtitles_and_extra_authors`:
4 failed before, passes after.

### Commit
Part of feat(ingest): fetch book covers from Open Library with safe
fallback (C11.2).

## 2026-11-11 C11.2 — a found cover was not stored (image redirect)

**Status:** fixed

### Symptom
After the fix above the same book still saved `cover_source = 'none'`.

### Repro
`GET https://covers.openlibrary.org/b/id/10140705-M.jpg?default=false`
answers `302` to `archive.org/download/…`, which redirects again to an
`ia8xxxxx.us.archive.org` node that returns the JPEG (12,355 bytes).

### Hypotheses
1. The client does not follow redirects (`follow_redirects=False`), so
   the 302 is read as "no image". Result: **confirmed**.

### Root cause
`backend/services/covers.py` `fetch_image` treated any non-200 as a miss,
and Open Library serves every cover through archive.org redirects.

### Fix
`fetch_image` follows up to three redirects itself, and only to https
`covers.openlibrary.org`, `archive.org` or `*.archive.org`; any other
target is refused before it is requested. The search request still does
not follow redirects.

### Regression test
`test_covers.py::test_the_image_follows_open_library_redirects_to_archive_org`
failed before (1 failed, 30 passed) and passes after;
`test_an_image_redirect_off_archive_org_is_refused` covers the limit. On
dev the book then stored `covers/ol/10140705-M.jpg` (200, image/jpeg,
12,355 bytes, `max-age=31536000`).

### Commit
Part of feat(ingest): fetch book covers from Open Library with safe
fallback (C11.2).

## 2026-11-11 C11.2 — the cover backfill stopped on a book with no stored file

**Status:** fixed

### Symptom
`python scripts/backfill_covers.py` on dev looked up five books, then
stopped with `TypeError: argument of type 'NoneType' is not iterable`
from `storage3 ... relative_path_to_parts` inside
`book_ingestor.download`. The sixth book (`f450cf54…`, an old test row)
has `storage_path` null.

### Repro
`test_backfill_covers.py::test_a_failing_book_is_reported_and_the_run_goes_on`
and `::test_a_book_without_a_readable_file_is_looked_up_by_its_typed_title`:
2 failed before the fix.

### Hypotheses
1. A book with no file reaches `download(None)`. Result: **confirmed**
   (the row's `storage_path` is null).
2. Any exception in one lookup ends the run, since `run` does not catch
   it. Result: **confirmed**.

### Root cause
`scripts/backfill_covers.py`: the lookup always downloaded the file for
its metadata, and `run` let one book's exception stop the loop.

### Fix
`look_up` (now a module function) skips the file when there is no path
or it cannot be read, and uses the typed title and author; `run` reports
a failing book as `error` and goes on.

### Regression test
The two tests above pass after the fix (6 passed). On dev the rerun
looked up the last book (`none`); a dry run then lists 0 books.

### Commit
fix(ingest): keep the cover backfill going past a book with no file

## 2026-11-11 C11.5 — Lighthouse NO_FCP: no page reported a contentful paint

**Status:** fixed

### Symptom
`npx lighthouse@12.8.2 http://localhost:4173/login --only-categories=performance`
(production preview; Edge via `CHROME_PATH`, headless and windowed):
`Runtime error encountered: The page did not paint any content ...
(NO_FCP)`, every run. The page is on screen (screenshot taken), but
`performance.getEntriesByType('paint')` holds only `first-paint`: no
`first-contentful-paint`, no `largest-contentful-paint` entries.

### Repro
Scratchpad `fcp_bisect.mjs` (headless Edge, fresh profile per load,
paint entries read after 3 s): `/login` on the preview 0/6 loads with
FCP; the component gallery (`/gallery.html`, same libraries, no app
shell) 4/4; the backend's `/docs` 4/4.

### Hypotheses
1. Something on `/login` starts invisible: Motion's route wrapper
   (`m.div`) or the pre-2.0 `.page` fade (`opacity: 0` until
   `usePageTransition` adds `.visible`). Evidence: the gallery has
   neither. Test: route wrapper as a plain `div`: 1/4 (not it); Login
   without the `page` class: 4/4. Result: **confirmed** for `.page`.
2. A View Transition on load. Evidence against: theme.js skips it under
   reduced motion, which failed as well. Result: rejected.
3. Headless only, or the page counted as hidden. Evidence against:
   windowed Lighthouse also NO_FCP; `visibilityState` "visible" in failing
   loads. Result: rejected.

### Root cause
`frontend/src/index.css` `.page { opacity: 0 }` with a transition to 1 on
`.visible`. Chrome does not count text painted under opacity 0, and the
reveal is a composited opacity transition that paints nothing new, so the
first contentful paint is never reported. Every page carries `.page`.
Since C10.4 the route transition in `App.jsx` does the fade; this one is
redundant.

### Fix
Remove the two `.page` rules; the class names stay on the pages until
their rebuilds (C12–C13).

### Regression test
No frontend test runner. `fcp_bisect.mjs`: `/login` 6/6 loads with FCP on
dev and on the rebuilt preview (0/6 before). Lighthouse on `/login`
then completes (score 88, docs/BENCHMARKS.md, C11.5).

### Commit
fix(ui): let pages report their first contentful paint

## 2026-11-11 C12.1c — structure backfill reports every dev book as a mismatch

**Status:** fixed

### Symptom
The new structure backfill re-extracts and re-chunks each ready book's
file and writes blocks only when the result equals the stored chunks. On
the dev project it found no book it could fill: six of seven ready books
are `mismatch` and the seventh has no file. Expected: books ingested by
the current code re-chunk to exactly what is stored. No exception or
stack trace; the outcome is the script's own report.

    python scripts/backfill_structure.py --dry-run 2>/dev/null | grep -E "^ENV|^  [0-9a-f]{8}-|^checked"
    ENV=development; books without a toc: 7
      2f85c3de-…  'Sample': mismatch
      3e3040a3-…  'Dagano 14 Chapter Operational Amplifiers.Pdf': mismatch
      4cc38181-…  'My API Upload Test': mismatch
      51fd1ff0-…  'Main': mismatch
      58a7d7e4-…  'David Harris Sarah Harris Digital Design And Computer Architecture EN': mismatch
      5c7fdf10-…  'David Harris Sarah Harris Digital Design And Computer Architecture EN': mismatch
      f450cf54-…  'Sample PDF Test': no file
    checked 7 books

(Without the grep, pypdf also prints "fontTools is required…" warnings
for the Harris book; they are not errors.)

### Repro
    python scripts/backfill_structure.py --dry-run --book-id 2f85c3de-cd9f-421a-bfbf-f5ca4fa16c66

### Hypotheses
1. The PDF text extracted today differs from what was extracted when
   these books were ingested, in whitespace only. Evidence: on `Sample`
   chunks 2, 3 and 6 differ, first at character 3029, stored
   `'L = 1\nP\nP\n∑\ni=1\n\nSi'` against today's `'L = 1 P P ∑ i=1  Si'`,
   same lengths; on the Harris book 280 of 302 chunks differ
   (`'Patterson\nUniversity'` against `'Patterson University'`) and today's
   text chunks into 307, not 302, because paragraph splits follow blank
   lines. `pypdf` was unpinned when these books were ingested (May 2026)
   and pinned to 7.0.0 in `e302ab8` (2026-11-10). Ruled out if: the texts
   also differ outside whitespace. Result: **confirmed**: for both books
   the text with all whitespace removed is identical.
2. `stored_contents` reads a truncated or misordered list. Evidence
   against: 7 of 7 and 302 of 302 chunks read, equal lengths per chunk.
   Result: ruled out.
3. `chunk_text` changed since ingestion. Evidence against: `git log -L`
   shows no change since `3ce0ffb` (May). Result: ruled out.

### Root cause
The backfill's design, not ingestion: `scripts/backfill_structure.py`
`backfill_book` re-extracted and re-chunked each file and required the
result to equal the stored chunks exactly. Reader blocks for a PDF need
only the stored chunk text, and the EPUB alignment already ignores
whitespace, so the comparison was both unnecessary and impossible for any
book ingested before pypdf was pinned.

### Fix
`backfill_book` builds blocks from the stored chunks
(`stored_contents`); the file is downloaded only for an EPUB, whose tags
`book_structure.assign` aligns to the stored text ignoring whitespace,
falling back to text blocks. `chunks.content` is still never written.
The `mismatch` and `no file` outcomes are gone (a PDF needs no file).
One attempt.

### Regression test
`backend/tests/test_backfill_structure.py::test_blocks_come_from_the_stored_text_even_when_the_file_now_extracts_differently`
and `::test_a_pdf_needs_no_file_and_is_not_downloaded`. With the old
`backfill_book` put back: 2 failed, 5 passed. With the fix: 7 passed.
Repro re-run on dev: all 7 books "would store" (7, 70, 7, 35, 302, 212
and 7 chunks), none mismatch.

Found while re-running it: chapter counts of 44 to 178 on technical PDFs
(running headers and formula lines taken for chapters). That is a
different fault in `book_structure.py`, logged in the next entry; nothing
was written to dev before it is fixed.

### Commit
Folded into `feat(ingest): store structured blocks and table of contents`
(C12.1c): the backfill had never been committed, so there is no earlier
version to fix in a separate commit.
