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

## 2026-11-11 C12.1 — PDF chapter detection takes running headers and formulas for chapters

**Status:** fixed

### Symptom
The structure backfill's dry run on dev (previous entry) reports far
more chapters than the books have: 178 for the Harris and Harris
textbook (about 9 chapters), 69 for `Main` (a lecture-notes PDF), 44 for
`Dagano 14 Chapter Operational Amplifiers` (one chapter). Expected: about
one toc entry per real chapter, and none from page furniture or maths.
No exception. Titles detected (first entries, `ascii()`):

    python scripts/backfill_structure.py --dry-run   # chapter counts above
    58a7d7e4 178 {'caps': 96, 'chapter-word': 78, 'roman': 4}
      'ONLINE SUPPLEMENTS', 'PCSPIM', 'LABS', 'BUGS', 'ACKNOWLEDGMENTS',
      'CHAPTER ONE From Zero to One: Captain Meriwether ...',
      'Chapter 01.qxd  1/27/07  10:20 AM  Page 8', 'DEAFDAD8: least',
      'Chapter 01.qxd  1/27/07  10:20 AM  Page 16', 'CL CL', ...
    51fd1ff0 69 {'caps': 6, 'chapter-word': 63}
      'CONTENTS 2', 'CONTENTS 3', 'CHAPTER 1. INTRODUCTION TO MACHINE LEARNING8',
      'CHAPTER 1. INTRODUCTION TO MACHINE LEARNING9', ...
      'Chapter 2: Linear Regression with Multiple Vari-', 'Chapter 3: Classification', ...
    3e3040a3 44 {'caps': 42, 'roman': 2}
      '+VCC', 'IC I IC1: Icopy2', 'VBE2: IC2', '\U0001d43c\U0001d436\U0001d435: R8',
      'VCC = +15V: Vid', ...

### Repro
    python -c "<build('pdf', b'', stored_contents(supabase, '<id>')) for the three books; print len(toc)>"
    (script in the scratchpad; same numbers every run)

### Hypotheses
1. Running heads and footers are taken for chapters: they sit at the top
   or bottom of every page, are short, often ALL CAPS or start with
   "Chapter N", and are followed by text. Evidence: of the chapters found,
   140 of 178 (Harris), 67 of 69 (`Main`) and 18 of 44 (`Dagano`) are
   lines that occur 3 or more times in the book (digits ignored). Ruled
   out if: the false chapters are one-off lines. Result: **confirmed**.
2. The ALL CAPS test accepts lines that are not words: `line ==
   line.upper()` is true for formulas (`+VCC`, `VCC = +15V`) and for
   mathematical italic letters (U+1D43C and others are alphabetic and
   have no case). Evidence: 60 (Harris), 6 (`Main`) and 41 (`Dagano`)
   chapters contain digits, symbols or non-Latin letters. Result:
   **confirmed**.
3. The "Chapter N" pattern is too loose: `\b` after the number accepts
   `Chapter 01.qxd 1/27/07 10:20 AM Page 2` (a print-job slug, 220 and 292
   times) and `Chapter 5, you will see…`. Evidence: distinct
   chapter-pattern lines listed for both books. Result: **confirmed**; the
   same chapter number then appears many times.

Also seen: in Harris the only chapter marker in the text is the running
head (`CHAPTER ONE From Zero to One`, 23 times); in `Main` the opener is a
one-off `Chapter 1` + title line and the heads repeat with the page number
glued on (`…MACHINE LEARNING7`). So a repeated head cannot simply be
dropped: its first occurrence is the only chapter marker some books have.

### Root cause
`backend/services/book_structure.py`, `text_blocks` and
`_is_heading_line` (C12.1a): each chunk was read alone, so a line printed
on every page could not be told from a heading; the ALL CAPS test was
`line == line.upper()`, true for formulas and caseless maths letters;
`CHAPTER_RE` ended in ``, which accepts `01.qxd` and `5,`; nothing kept
a chapter number from being listed again. While fixing it, two more
causes showed on `Main`: an opener right after a page that ends mid-line
was joined into the previous paragraph (the page-break continuation rule
skipped heading detection), and `ROMAN_RE` accepted `VDD`, `VCC`, `CL`
and single-letter variables.

### Fix
- `running_heads(chunks)`: lines that start or end a page (a blank-line
  segment) at least 3 times in the book, compared without case, spacing
  or a page number at either end (a bare "Chapter N" keeps its number).
  They are dropped from the text; the first one carrying an unseen
  chapter becomes that chapter, without its glued page number (books
  like Harris mark chapters only in the running head).
- Chapters found are remembered across chunks (`book["seen"]`), so a
  number or an ALL CAPS title is listed once.
- `CHAPTER_RE`: the number must end the line or be followed by a space,
  ". ", ": " or a dash. ALL CAPS: Latin capitals only, a word of 4 or
  more letters, followed by prose (4 words with lower case). Roman
  numerals: standard form, under 100, followed by a line with lower case.
- A page break inside an open sentence still lets the next line start a
  chapter. A title line is taken only after a bare "Chapter N" or numeral.
Three rounds, each adding tests first; no attempt failed.

### Regression test
`backend/tests/test_book_structure.py`: the running-head, opener,
print-slug, formula, chapter-once, refrain, opener-after-open-page,
glued-number, canonical-numeral and single-letter tests (19 cases). With
the C12.1b module put back (`git stash push -- backend/services/book_structure.py`):
18 failed, 29 passed (the refrain test passes on both, as intended: it
guards against dropping repeated lines inside a page). With the fix: 47
passed.

Repro re-run (chapters found, before → after): Harris 178 → 21 (front
matter, the eight chapters, EXERCISES, EPILOGUE, plus PCSPIM, LABS,
BUGS, VHDL, "YOU WILL GET A MILLION" and one variable "X" before a
figure caption); its truncated copy (5c7fdf10) 140 → 19; `Main` 69 → 10 (its
ten chapters with titles); `Dagano` 44 → 0; the three short test PDFs 0.
Text kept in blocks: 97.1–99.9% of the chunk text (the rest is running
heads and page numbers).

### Commit
fix(ingest): stop taking running heads and formulas for chapters

## 2026-11-11 C12.3 — under reduced motion the reader paginates with the old text size

**Status:** fixed

### Symptom
In headless Edge with `prefers-reduced-motion: reduce`, changing the text
size on `/__reader` re-paginates with the previous size: the page count
lags one change behind and the anchored passage is not on screen
(`anchorVisible: false`). Without reduced motion the same steps keep the
place. No error. From the scratchpad probe `reader_lag.mjs` (status |
flow's computed font-size | `--reading-size` on the book):

    node reader_lag.mjs
    dark reduce ["before pp. 1–2 of 6 | 18px | 18px","sync pp. 1–2 of 6 | 18px | 18px",
                 "1 frame pp. 1–2 of 6 | 18px | 19.5px","300ms pp. 1–2 of 6 | 19.5px | 19.5px"]
    dark no-preference ["…","1 frame pp. 1–2 of 7 | 19.5px | 19.5px", …]

### Repro
    node rm_probe.mjs   (scratchpad): a new div's font-size set from 18px to 24px
    reduce        {"property":"all","duration":"1e-05s","sync":"18px","frame":"18px","later":"24px"}
    no-preference {"property":"all","duration":"0s","sync":"24px","frame":"24px","later":"24px"}

### Hypotheses
1. The global reduced-motion rule (`frontend/src/styles/base.css`, A11,
   C10.4) sets `transition-duration: 0.01ms !important` on every element.
   Every element's `transition-property` is `all` by default (inert at
   0s), so under reduced motion every style change becomes a 0.01 ms
   transition, and a read in the same frame gets the old value. Ruled out
   if: the probe div shows a 0s duration under reduce. Result:
   **confirmed** (1e-05s and `all`; the value lands after the frame).
2. React applies the size a frame late. Evidence against: `--reading-size`
   on the book is already 19.5px after one frame in both modes; only the
   computed font-size differs. Result: ruled out.

### Root cause
`frontend/src/styles/base.css`, the `prefers-reduced-motion: reduce`
block: `transition-duration: 0.01ms !important` on `*`. With the default
`transition-property: all`, every element transitioned every change for
0.01 ms, so values read in the frame of a change were the old ones. The
reader measures its columns right after a text-size change, so it
paginated at the old size. It affected every reduced-motion reader since
C10.4; nothing earlier measured layout right after a style change.

### Fix
Transitions under reduced motion are `0s` (with `transition-delay: 0s`),
which means no transition at all: instant, as A11 intends. Animations
keep 0.01 ms and one iteration. No code in `src` listens for
`transitionend` (searched), so nothing waited on the old tiny
transitions. One attempt.

### Regression test
`frontend/src/styles/base.test.js` (`npm run test:unit`, Node's test
runner, agreed at C12 plan time): failed before the fix (7 passed, 1
failed: "reduced motion makes transitions instant rather than 0.01 ms
long"), 8 passed after. Repro re-run: `rm_probe.mjs` under reduce now
`{"duration":"0s","sync":"24px","frame":"24px"}`; `reader_lag.mjs`
under reduce now shows `pp. 1–2 of 7 | 19.5px` after one frame, the same
as without reduced motion.

### Commit
fix(ui): make reduced-motion transitions instant instead of 0.01 ms

## 2026-11-11 C12.5b — repo graph cannot match a fetchApi call that has a query string

**Status:** fixed

### Symptom
After staging C12.5b, the tooling tests failed and the commit went
ahead anyway: the check ran as `pytest tools/repo_graph/tests -q | tail -1`
in a `&&` chain, so the pipe's exit status was `tail`'s and the commit
step ran. Commit `a87eafc` therefore says "62 passed (after staging)",
which is false.

    pytest tools/repo_graph/tests -q
    1 failed, 61 passed
    FAILED tools/repo_graph/tests/test_build.py::test_real_graph_covers_routers_and_pages
    >       assert not [u for u in graph["unresolved"] if u["type"] == "calls_endpoint"]
    E       AssertionError: assert not [{'from': 'file:frontend/src/pages/ReadingSession.jsx', 'type': 'calls_endpoint',
            'target': 'GET /books/${bookId}/pages?start=${entry.chunk_index}&end=${entry.chunk_index + 1}'}]
    tools\repo_graph\tests\test_build.py:228: AssertionError

### Repro
    pytest tools/repo_graph/tests/test_build.py::test_real_graph_covers_routers_and_pages -q

### Hypotheses
1. `tools/repo_graph/build.py` `route_key` compares the whole call text,
   query string included, with the route path, which has none; the
   C12.5b call is the first `fetchApi` call in the codebase with a query
   string. Evidence: the unresolved target ends in `?start=…&end=…`; the
   C12.4 read-ahead builds its query outside `fetchApi(` (a fetcher
   argument), so it was never matched. Ruled out if: a call with a query
   string resolves in the fixture. Result: **confirmed** by the fixture
   test below.

### Root cause
`tools/repo_graph/build.py` `route_key` (line 290): the call text was
compared with the route including its query string, so
`/books/${bookId}/pages?start=…` never equalled `/books/{}/pages`.
Process: the standard checks before commit `a87eafc` ran in an `&&`
chain with `| tail -1`, which hides a failing exit status; the failure
was printed and missed.

### Fix
`route_key` drops everything from `?` before comparing. Checks are run
on their own (no pipe in a commit chain) and read before any commit.
One attempt.

### Regression test
`tools/repo_graph/tests/test_build.py`: the fixture page calls
`/books/${id}/open?start=${n}&end=${n + 1}` and
`test_calls_endpoint_matches_method_and_path` asserts no unresolved call
contains `?`. Before the fix: 2 failed, 12 passed (that test and
`test_real_graph_covers_routers_and_pages`). After: 62 passed (all
tooling tests); `query.py "GET /books/{book_id}/pages"` now lists
`ReadingSession.jsx` as its caller.

### Commit
fix(graph): match frontend calls to routes without their query string
(corrects the "62 passed" line of `a87eafc`, which was false)

## 2026-11-11 C12.6 — a proper=1 lookup can replace everyone's plain lookup of the same word

**Status:** fixed

### Symptom
Found in the C12 close review (an independent read of
`git diff readfocus-2.0...chunk/C12-book-reader`), not by a failing check.
`GET /lookup?term=bank&proper=1` asks Wikipedia first and stores the answer
in the shared `term_lookups` cache under `("bank", "en")`, the same key a
plain `GET /lookup?term=bank` uses. For 90 days every reader's plain "bank"
then shows the Wikipedia summary instead of the definition. `proper` comes
from the client, so any signed-in user could do this.

### Reproduce
`backend/tests/test_lookup.py::test_a_proper_lookup_never_answers_a_plain_lookup_of_the_same_word`:
`run` with `proper=1` (Wikipedia mocked), the in-process copy dropped, then
plain `run`: the plain lookup returned the Wikipedia answer. 1 failed, 37
passed.

### Upstream and downstream (repo graph)
`backend/services/lookup.py` is called by `backend/routers/lookup.py` only;
it reads and writes `term_lookups` (migration 015). The frontend client
(`frontend/src/reader/lookup.js`) already keeps names and words apart in its
own LRU (`P:` and `w:` keys), so only the shared cache was affected.

### Hypotheses
1. The cache key is the display text for Wikipedia-first lookups, and the
   display of a lower-case word equals its plain key. Ruled out if: the two
   keys differ for `run`. Result: **confirmed** (both `run`).

### Root cause
`look_up` set `key = term.display if wiki_first else term.key`. For a
capitalised name the two keys differed only by case, which hid the clash;
for a lower-case word sent with `proper=1` they were the same string.

### Fix
Wikipedia-first lookups (names and phrases) are keyed `P:<original
casing>`, plain words keep their lower-case key. Entries cached before the
fix under bare names on dev are simply not found again and are fetched
once more. One attempt.

### Regression test
The test above asserts the plain lookup goes to the dictionary and the
table holds `P:run` and `run` apart. Before: failed; after: 38 passed.

### Commit
fix(lookup): keep Wikipedia-first answers apart in the shared cache

## 2026-11-11 C13.4 — the last page's Start test cannot be clicked

**Status:** fixed

### Symptom
Found while writing the C13.4 e2e for the closing page: a mouse click on
"Start test" on the last page of today's reading never reached the button.
Playwright: `locator.click: Timeout 3000ms exceeded`, "`<div
class="rf-viewport">` intercepts pointer events". Keyboard (Tab, Enter) and
the toolbar's Done reading still worked, so the C12 tests, which never
clicked it, passed. Present on the committed code (`66cc26a`): probed with
`document.elementFromPoint` at the button's centre, which returned
`.rf-viewport`.

### Reproduce
`e2e/reader.spec.js` "the last page's Start test takes a mouse click and
finishes reading": End to the closing page, click Start test with a 3 s
timeout. 1 failed.

### Upstream and downstream (repo graph)
`reader/BookReader.jsx` renders each leaf's furniture (the closing page
`.rf-end` on the last page), then `.rf-viewport` (the text window) as a later
absolutely positioned sibling over the text block of every page; the turn
overlay (z 2), edges (z 3) and ribbon (z 4) sit above.

### Hypotheses
1. `.rf-viewport` comes later in the DOM at the same stacking level and
   covers `.rf-end`, which lies inside the text block. `.rf-leaf` sets no
   z-index or transform, so a z-index on `.rf-end` would lift it. Result:
   **confirmed**.

### Root cause
C12.5a placed the closing page "outside the flow" in the text block's box
but under the viewport that shows the flow on every page.

### Fix
`reader/reader.css`: `.rf-end { z-index: 1 }`, above the viewport and
below the turning leaf, edges and ribbon. One attempt.

### Regression test
The test above: failed before ("rf-viewport intercepts pointer events"),
passes after; `e2e/reader.spec.js` 9 passed.

### Commit
fix(reader): let the last page's Start test take a click

## 2026-11-11 C13.4 — the book-open entrance shrinks the reader's page count

**Status:** resolved before commit (the entrance was cut)

### Symptom
With the reading area entering through Motion's `bookOpen` preset (moment 2:
`rotateY` from -10 degrees with perspective, 600 ms),
`npx playwright test e2e/reader.spec.js` failed 2 of 8: "arrow keys, the turn
buttons and the page edge turn the page" timed out on a click (30 s), and
"the place is saved and restored after a reload" expected `/^Pages 5 and 6 of/`
and received "Page 5 of 5" after "Pages 3 and 4 of 5". The fixture book
normally paginates to more pages, so the count was too small.

### Reproduce
The two tests above, on the change with `bookOpen`; the reduced-motion test
(the same page with `fadeIn`) passed.

### Upstream and downstream (repo graph)
`pages/ReadingSession.jsx` renders `reader/BookReader.jsx`, which measures
the page on mount and on resize (`reader/geometry.js`, `reader/anchor.js`:
character rects and the frame's box).

### Hypotheses
1. The paginator measures while the area is rotated, so the frame and text
   rects are narrower on screen than in layout, and the page count and
   anchors come out wrong. Test: replace the rotation with a 2D entrance
   (`rise`: opacity and a 12 px translate, which keep widths).
   Result: **confirmed**, 8 of 8 passed.
2. The entrance's opacity 0 hides the edge button from the click. Not
   needed after 1.

### Root cause
`rotateY` with perspective changes the boxes `getBoundingClientRect` and
`getClientRects` report during the first 600 ms, which is when the reader
measures its first layout.

### Fix
First the reading area rose in (`rise`) instead of swinging open, and the
reader tests passed. Lighthouse then measured the page at performance 83
(84-85 without the entrance) with the toolbar caught mid-fade by the
contrast audit in 2 of 3 runs; a rise without the fade still gave 83. The
entrance is first in C13's cut order, so it was removed: the reading page
opens as before. The page turns themselves (C12.4) are unchanged.

### Regression test
None kept: no entrance ships. `e2e/reader.spec.js` failed 2 of 8 with
`bookOpen` and passed 8 of 8 with `rise`; a future entrance must keep
the reader's first measurement free of transforms that change sizes.

### Commit
feat(ui): polish the reading page with lamp notes and a gentle entrance

## 2026-11-11 C13.5 — the automatic submit at zero sends empty answers

**Status:** fixed

### Symptom
Found while planning the C13.5 test page (ESLint's `react-hooks/immutability`
error on `ComprehensionTest.jsx:71`, "`handleSubmitAnswers` accessed before
it is declared", pointed at it). When the 5-minute timer reaches zero the
page submits by itself, but it sent the answers and time from the render
that started the timer: every answer empty and `time_taken_seconds` 0. A
reader who runs out of time loses everything they wrote. The Submit button
was not affected (it calls the current render's function).

### Reproduce
Playwright with `page.clock.install()` on `/test/s9` (two questions, API
mocked): type an answer, `page.clock.runFor(301_000)`; the submit body was
`{"answers":["",""],"time_taken_seconds":0}`. Kept as
`e2e/test.spec.js` "when time runs out, the answers typed so far are
submitted": 1 failed (expected the typed answer and 300).

### Upstream and downstream (repo graph)
`pages/ComprehensionTest.jsx` calls `GET /sessions/{id}`,
`POST /sessions/{id}/evaluate-single` and `POST /sessions/{id}/submit-answers`,
then routes to `/results/{id}` with the answers in router state, which
`pages/Results.jsx` shows.

### Hypotheses
1. The timer effect depends on `[loading, isSubmitting]` only, so its
   interval keeps the `handleSubmitAnswers` closure of the render it was
   created in, with that render's `answers` and `timeLeft`. Result:
   **confirmed** (the body held the first render's empty answers).

### Root cause
A stale closure: the interval was never rebuilt as answers changed.

### Fix
`ComprehensionTest.jsx`: a ref holds the latest answers and time; the
submit reads it, and the automatic submit counts the full 300 seconds.
The router state carries the same answers. One attempt.

### Regression test
The test above: failed before, passes after.

### Commit
fix(test): submit the typed answers when the timer runs out

## 2026-11-11 C13.8a — the error boundary cut the route transition

**Status:** fixed

### Symptom
Before committing C13.8a part 4, `npm --prefix frontend run test:e2e`: 1
failed, 73 passed. `e2e/shell.spec.js` "with motion › a page change rises
in": `expect(received).toBeGreaterThan(expected)`, Expected `> 0`, Received
`0` (no transform on the incoming page during the change). Reproduced alone
with `npx playwright test e2e/shell.spec.js -g "rises in"`.

### Upstream and downstream (repo graph)
`App.jsx` wraps `AnimatedRoutes` (the fade-and-rise between screens) in the
new `components/RouteErrorBoundary.jsx`, inside `BackendGate`.

### Hypotheses
1. The boundary was rendered with `key={pathname}` so a new address would
   clear an error; a key change remounts the whole route tree, so
   `AnimatePresence` never sees an exit and an enter and nothing moves.
   Result: **confirmed** (without the key the test passes).

### Root cause
Using a remount (`key`) to reset the boundary also reset the animated
routes below it.

### Fix
`RouteErrorBoundary.jsx`: the boundary gets `pathname` as a prop and clears
its error in `componentDidUpdate` when the address changes. One attempt.

### Regression test
`e2e/shell.spec.js` "a page change rises in" (failed with the key, passes
without); `e2e/errors.spec.js` now also checks that browser Back from the
error screen clears it without a reload.

### Commit
Folded into C13.8a part 4 (the failure never reached a commit).

## 2026-11-11 C13.10a — sign out stopped at the landing page

**Status:** fixed

### Symptom
Before committing C13.10a, `npm --prefix frontend run test:e2e`: 1 failed,
86 passed. `e2e/shell.spec.js` "sign out leaves for the sign-in page":
`expect(page).toHaveURL(expected) failed` (expected `/login$`, stayed on
`/`). Also `npm --prefix frontend run test:unit`: 1 failed, 61 passed,
`wake.test.js` "does nothing without fetch": `true !== false`.

### Upstream and downstream (repo graph)
`App.jsx` now renders `pages/Landing.jsx` for signed-out visitors at `/`
(new `PublicHome`); `components/AccountMenu.jsx` signs out from `/`.

### Hypotheses
1. Sign out used to reach `/login` only through the Library route's
   `AuthGuard` redirect; with `/` signed out now the landing page, the
   redirect never runs. Result: **confirmed** (the URL stays `/` and the
   landing page shows).
2. The unit test passed `undefined` for `fetchImpl`, which takes the
   default parameter (`globalThis.fetch`, present in Node 22), so the call
   was sent. Result: **confirmed** (a test bug, not a code bug).

### Root cause
A redirect that the sign-out flow relied on was implicit in the route
table; and a default parameter swallowed the test's "no fetch" case.

### Fix
`AccountMenu.jsx`: Sign out navigates to `/login` (replace) and then signs
out, so it keeps its old destination. `wake.test.js` passes `null`. One
attempt each.

### Regression test
`e2e/shell.spec.js` "sign out leaves for the sign-in page" (failed before,
passes after); `wake.test.js` "does nothing without fetch".

### Commit
Folded into C13.10a (the failure never reached a commit).

## 2026-11-11 C13.10e — make graph stopped on the share image

**Status:** fixed

### Symptom
Before committing C13.10e, `make graph`: `Purpose for a file that is not
inventoried: ['frontend/public/og.png']`, `make: *** [Makefile:17: graph]
Error 1`; then `pytest tools/repo_graph/tests -q`: 4 failed, 58 passed.

### Hypotheses
1. The inventory skips binary files, so a purpose for `og.png` is an
   orphan and `make graph` stops before writing a consistent graph; the
   graph tests then read the half-updated files. Result: **confirmed**
   (the purpose removed, `make graph` completes and the tests pass).

### Root cause
A purpose was written for a binary file the inventory never lists.

### Fix
`tools/repo_graph/purposes.json`: the `og.png` entry removed (the image
is registered in `docs/ASSETS.md` instead). One attempt.

### Regression test
The repo-graph check itself (`make graph` fails on an orphan purpose);
`pytest tools/repo_graph/tests -q`: 62 passed after the fix.

### Commit
Folded into C13.10e (the failure never reached a commit).

## 2026-11-12 C14.1 — ruff count rose from 28 to 34

**Status:** fixed

### Symptom
Standard checks before committing C14.1: `ruff check backend/` printed
`Found 34 errors.` against the baseline of 28. Every other check passed.

### Hypotheses
1. The new `backend/tests/test_deploy_config.py` adds the 6 errors.
   Result: **confirmed** (`ruff check backend/tests/test_deploy_config.py`:
   6 x FURB167, "Use of regular expression alias `re.M`").

### Root cause
The new test passed `re.M` to `re.search`; the project's ruff rules
require the full name `re.MULTILINE`.

### Fix
`backend/tests/test_deploy_config.py`: `re.M` replaced by
`re.MULTILINE` in all six calls. One attempt.

### Regression test
The ruff check itself: `ruff check backend/` back to `Found 28 errors.`;
`pytest backend/tests/test_deploy_config.py -q`: 8 passed.

### Commit
Folded into C14.1 (the failure never reached a commit).

## 2026-11-12 C14.5 — pytest stops at collection on a clean Linux checkout

**Status:** fixed

### Symptom
Running the new CI backend job's commands on a fresh clone of `f1abfb2`
in a clean `python:3.11` container (no `.env`, no model cache), after
`pip install -r requirements.txt pytest==9.2.0 ruff==0.17.4`, pytest
stops before running anything. Locally (the `.venv`) the same suite
passes, 804 tests.

    pytest backend/tests -q

    ==================================== ERRORS ====================================
    _________________ ERROR collecting backend/tests/test_bench.py _________________
    ImportError while importing test module '/work/backend/tests/test_bench.py'.
    Hint: make sure your test modules/packages have valid Python names.
    Traceback:
    /usr/local/lib/python3.11/importlib/__init__.py:126: in import_module
        return _bootstrap._gcd_import(name[level:], package, level)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    backend/tests/test_bench.py:5: in <module>
        from scripts import bench
    scripts/bench.py:44: in <module>
        import psutil
    E   ModuleNotFoundError: No module named 'psutil'
    =========================== short test summary info ============================
    ERROR backend/tests/test_bench.py
    !!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
    1 error in 1.73s

### Repro

    docker run --rm -v "I:/readfocus:/src:ro" python:3.11 bash -c 'git clone -q /src /work && cd /work && pip install -q -r requirements.txt pytest==9.2.0 && pytest backend/tests -q'

### Hypotheses
1. `psutil` is in no requirements file: `scripts/bench.py` imports it,
   `backend/tests/test_bench.py` imports `scripts.bench`, and the local
   `.venv` has psutil 7.2.2 installed by hand (C3.4,
   `scripts/dev/measure_rss.py`). Ruled out if the clean install still
   fails with psutil added. Result: **confirmed**: with
   `psutil==7.2.2` added to the same install, `pytest backend/tests -q`
   gave 802 passed, 2 skipped (the two model tests skip when the model is
   not cached, as designed).
2. Other packages the tests or scripts import are also undeclared.
   Ruled out if an AST scan of `backend/tests/**/*.py` and `scripts/*.py`
   finds no third-party import outside `requirements.txt` except psutil
   and pytest. Result: **ruled out**: only `psutil` and `pytest`.

### Root cause
Test-time dependencies were declared nowhere: `requirements.txt` holds the
app's packages (checked by `test_requirements.py` for `backend/` only), and
`pytest` and `psutil` were installed by hand locally and by name in CI
(`scripts/bench.py:44`, imported by `backend/tests/test_bench.py:5`). CI
never had psutil, so its test job has failed at collection since
`bench.py` began importing psutil (`db14228`, C9.0a; `test_bench.py`
itself dates from C3.5). CI results on GitHub were never checked
(issue 19).

### Fix
`requirements-dev.txt` (new): `-r requirements.txt`, `pytest==9.2.0`,
`ruff==0.17.4`, `psutil==7.2.2`, not installed in the Docker image. One
attempt. The C14.5 workflow installs it.

### Regression test
`backend/tests/test_requirements.py::test_tests_and_scripts_dependencies_are_declared`
and `::test_dev_requirements_include_the_app_and_are_pinned`. Before the
fix: 2 failed, 3 passed. After: 5 passed. The repro with
`pip install -r requirements-dev.txt` in the clean container: 804 passed,
2 skipped; ruff 27.

### Commit
fix(ci): declare test and script dependencies in requirements-dev.txt

## 2026-11-12 C15.1 — the closing page jumps back to an earlier page

**Status:** fixed

### Symptom
The first local runs of the live journey (`frontend/e2e/journey.spec.js`,
real backend on :8000, test user A, `sample.pdf`, 4 text pages today) could
not reach the closing page: End (and ArrowRight from the last spread) left
the reader where it was, so Start test never showed. Expected: the closing
page with Start test.

    npm --prefix frontend run test:live
    Error: expect(locator).toBeVisible() failed
    Locator: locator('.rf-end').getByRole('button', { name: 'Start test' })
    Expected: visible
    Timeout: 5000ms
    Error: element(s) not found
        at I:\readfocus\frontend\e2e\journey.spec.js:146:67

Just before End: `{ active: 'rf-book', books: 1, turning: 'false', cards: 0 }`
(focus on the book, no leaf turning, no word card). The page after End read
"Pages 1 and 2 of 4". The first run, two ArrowRights: "Pages 3 and 4 of 4"
stayed after the second press.

### Repro
Offline, mocked (the fixtures' Walden session): End, then a theme change.

    npx playwright test e2e/<scratch>.spec.js
    Expected pattern: /End of today's reading/
    Received string:  "Pages 1 and 2 of 6"

Now `frontend/e2e/reading.spec.js` › "a re-pagination on the closing page
keeps the closing page".

### Hypotheses
1. A re-pagination while the closing page shows puts the reader back on the
   anchor's page: `goTo` moves the anchor only when `anchorForPage` finds
   text on the target page, and the closing page has none, so the anchor
   stays on the last text page reached; the layout effect then sets the
   page from the anchor. In the live session the closing page's fonts load
   when it first shows (`document.fonts` `loadingdone` bumps the relayout
   tick). Ruled out if a theme change (another tick) on the closing page
   keeps it. Result: **confirmed**: the offline repro above, and both live
   failures land exactly on the last anchored page (3-4, then 1-2).
2. Keys are lost: focus leaves the book, or a word card swallows them.
   Ruled out by the focus dump above (focus on `.rf-book`, no card).
3. The closing page is missing from the layout (`count` = `text`). Ruled
   out: the mocked End reaches it, and `count = text + 1` whenever there
   is an `endPage` (`BookReader.jsx:84`).

### Root cause
`frontend/src/reader/BookReader.jsx`: the reader's place is only an anchor
in the text, and the closing page (outside the flow) has no anchor, so any
re-pagination there (font load, theme, accent, resize, text size) restored
the last text page. In the live reader the font load happens the moment
the closing page first shows, so the reader could never stay on it.

### Fix
A `atEnd` ref, set by `goTo` when the target is the closing page alone
(`target >= layout.text` with an end page); the layout effect keeps the
closing page while it is set. Any move to a text page clears it. One
attempt.

### Regression test
`frontend/e2e/reading.spec.js` › "a re-pagination on the closing page keeps
the closing page". Failed before the fix (received "Pages 1 and 2 of 6"),
passes after.

### Commit
fix(reader): keep the closing page across re-pagination

## 2026-11-12 C15.2 — /sessions/start serves another reader's book (issue 17)

**Status:** fixed

### Symptom
Open since C2.5 (issue 17, from the code): `POST /sessions/start` never
checks that `book_id` is the caller's. A reader who knows another reader's
book id gets a session on it and that book's chunk text. Expected: 404,
nothing created, nothing returned.

    pytest backend/tests/test_api_sessions.py -q -k not_the_callers
    >       assert response.status_code == 404
    E       assert 200 == 404
    backend\tests\test_api_sessions.py:618: AssertionError

### Repro
`backend/tests/test_api_sessions.py::test_start_refuses_a_book_that_is_not_the_callers`
(in-memory database, a second user's book and chunks).

### Hypotheses
1. The handler filters the chunk read by `book_id` only and inserts the
   session without a book check (`backend/routers/sessions.py`,
   `start_session`: `chunks ... .eq("book_id", ...)`, no `books` read
   before the planner). Ruled out if the test still fails with a
   `books` ownership check in front. Result: **confirmed**: the three new
   tests pass with the check.
2. The service-role client bypasses RLS, so the database cannot stop it
   either. Evidence: `backend/database.py` builds the client with the
   service-role key. Not a separate cause: it is why the handler must check.

### Root cause
`backend/routers/sessions.py` `start_session`: the only endpoint taking a
`book_id` that never read `books` with `.eq("user_id", ...)`; the backend
uses the service-role key, so RLS does not apply.

### Fix
`owns_book(user_id, book_id)` reads `books` by id and user before the
planner runs; not the caller's (or missing) is 404 "Book not found.", and
a failed read is 503 (fail closed). The session fixtures now own their
book (`books` row for `user-1`). The old test "a failed book read never
fails the start" now expects 503: with `books` down, ownership cannot be
checked, and starting anyway was the hole. One attempt.

### Regression test
`backend/tests/test_api_sessions.py::test_start_refuses_a_book_that_is_not_the_callers`,
`::test_start_refuses_a_book_that_does_not_exist`,
`::test_start_fails_closed_when_ownership_cannot_be_checked`. Before the
fix: 3 failed (200 instead of 404 / 503). After: 3 passed.

### Commit
fix(api): check book ownership before starting a session

## 2026-11-12 C15 release — isolation check: A's question count moved during the probes

**Status:** fixed

### Symptom
Production re-run after the release (`main` at `b9fd808`). Every probe by
B was denied, but the closing count check failed:

    API_URL=https://readfocus-api.onrender.com npm --prefix frontend run test:isolation
    FAIL after    A's row counts unchanged -> {..."question_bank":55,...}
    92 probes, 91 denied as expected, 1 failed; 65 s against https://readfocus-api.onrender.com
    failed:
      after A's row counts unchanged: expected {"books":1,"chunks":7,"question_bank":47,...}, got {...,"question_bank":55,...}

No stack trace (a check, not an exception). Every other table was unchanged.

### Repro
Not every time: it depends on when the second ingestion batch finishes
on Render. The three earlier runs (local and production) passed. Any run in
which the "before" count is taken while the ingestion job is still running
fails this way.

### Hypotheses
1. A's own ingestion was still running. `books.status` becomes `ready`
   after the first batch (`backend/services/book_ingestor.py`, `mark_ready`
   inside the batch loop). Later batches keep storing questions through
   `QuestionGenerationAgent.run` (`question_bank` upsert), and the script
   stopped waiting at `ready`. Evidence: chunks were 7 in both counts
   (chunks are stored before a batch's questions); only `question_bank`
   grew; every B write probe was refused. Ruled out if the count still
   moves once the script waits for the job to be `done`. Result:
   **confirmed**. With the wait, A's own count is 55 before the probes and
   55 after, 92 of 92.
2. One of B's probes wrote to A's bank. Evidence against: B's
   `finish-reading` and `start` on A's ids returned 404 before any work, and
   the RLS inserts were refused. It would show up again with the wait in
   place. Result: ruled out by the re-run.

### Root cause
`frontend/scripts/live/check-isolation.mjs` took A's "before" counts once
the book was `ready`, which is the first batch, not the end of ingestion.
This is a race in the check, not a leak.

### Fix
The wait loop also requires the status endpoint's `ingestion.status` to be
`done` (or no job). A `failed` job stops the run. One attempt.

### Regression test
None automated: the script is a live check against the shared project and
is not part of the offline standard checks. Manual check: the production
re-run with the fix passed (92 of 92, A's counts unchanged at
`question_bank` 55, exit 0, 72 s). The run before the fix failed as above.

### Commit
fix(tooling): wait for ingestion to finish before the isolation baseline

## 2026-11-12 C16.4 — gemini-3.8-flash does not answer on the free tier

**Status:** open (outside the repo: Google's side; no code involved yet)

### Symptom
The C16.4 throwaway check (one "Reply with OK" request per configured
model, through the v1beta `generateContent` REST endpoint with the key in
the `x-goog-api-key` header; script in the session scratchpad, not
committed) got no answer from the chat model. Expected HTTP 200 and "OK"
from both models. The key is redacted from every output.

    python <scratchpad>/gemini_ping.py .env
    GEMINI_MODEL_CHAT=gemini-3.8-flash: HTTP 503, 4093 ms, reply 'UNAVAILABLE'
    GEMINI_MODEL_VISION=gemini-3.5-flash-lite: HTTP 200, 1734 ms, reply 'OK', tokens 4

    (retry, same command)
    GEMINI_MODEL_CHAT=gemini-3.8-flash: request failed (ReadTimeout)   # 60 s timeout
    GEMINI_MODEL_VISION=gemini-3.5-flash-lite: HTTP 200, 1330 ms, reply 'OK', tokens 4

No stack trace: the script catches `httpx.HTTPError` and prints its type.

### Repro
One `generateContent` request to `gemini-3.8-flash` with this key. Seen 3
times in 3 calls within a few minutes; not known whether it persists.

### Hypotheses
1. Google is short of capacity for `gemini-3.8-flash` on the free tier.
   Evidence: `503 UNAVAILABLE` is Google's overload status; the same key
   and endpoint work for `gemini-3.5-flash-lite`. Ruled out if: the model
   answers later in the day. Result: not ruled out; consistent with all
   three calls.
2. The model is not served for this key or project. Evidence: none
   beyond the failure. Ruled out if: `GET v1beta/models/gemini-3.8-flash`
   answers 200. Result: ruled out, 200 with `generateContent` among the
   supported methods and `thinking: true`.
3. Default thinking makes a reply slower than the timeout. Evidence: the
   model thinks by default and cannot be set to `minimal`. Ruled out if:
   a call with `thinkingConfig.thinkingLevel = "low"` and a 120 s timeout
   also fails. Result: ruled out, it timed out at 120 s.

Further experiment (the user chose to try another Flash model): one call
to `gemini-3.6-flash` with the same key, `HTTP 503, 3830 ms, UNAVAILABLE`.
Both Flash models refuse while Flash-Lite answers, which fits hypothesis 1.

### Root cause
Not established; hypothesis 1 stands. Further calls were stopped to keep
the key's 20-requests-a-day allowance for this model (observed in AI
Studio by the user, 2026-11-12).

### Fix
None in code (no Steve code exists). The user chose
`GEMINI_MODEL_CHAT=gemini-3.5-flash-lite`, the one model verified on this
key (200 "OK" twice, 1.3-1.7 s), for both variables; C22 (Steve backend, C21 before the C19 renumbering) re-tests
`gemini-3.8-flash` and `gemini-3.6-flash` and may switch chat back.

### Regression test
Not applicable: an external service's availability. Steve's backend
(C22) must treat 503 and timeouts as the paused state
(`steve-guardrails` section 6) and get offline tests for both.

### Commit
C16.4 `chore(steve): add Gemini env names and phase-2 progress sections`

## 2026-11-12 C17.2 — the new page-cache unit test hung

### Failure
`node --test src/originalview/pdf/*.test.js` did not finish within the
tool's 120 s limit (stopped by hand). Written test first; the module under
test (`pageCache.js`) had just been added.

### Reproduce
The last test, "a page released before its render finished is released
once it does", with radius 0: `focus(1)`, `get(1)`, `focus(5)`, then
`finish()`, then `await first`.

### Hypotheses (most likely first)
1. The test's fake `render` stored one `finish` callback, so rendering
   page 5 replaced page 1's resolver and page 1's promise never settled.
   Ruled out if: resolving page 1 by its own callback still hangs.
   Result: confirmed; with one resolver per page the test passes.
2. `createPageCache` never resolves a dropped slot. Ruled out by the same
   run: page 1 resolves and is released.

### Root cause
A bug in the test's fake, not in `pageCache.js`.

### Fix
`pageCache.test.js`: resolvers kept per page in a `Map`; the test also
checks nothing is released before the render finishes.

### Regression test
The fixed test itself; `timeout 60` used around the run afterwards.

### Commit
C17.2 `feat(pdf): lazy PDF.js renderer with aligned text layer and page cache`

## 2026-11-12 C17.3 — the new CSP blocked the inline theme script

### Failure
`npm run test:e2e` after adding the Content-Security-Policy meta: 2 failed,
102 passed. `landing.spec.js` "a deep link never shows the prerendered
landing page" and "signed in, the prerendered landing page is hidden from
the first paint": `[data-prerendered]` had no `hidden` attribute. Console:
"Executing inline script violates the following Content Security Policy
directive 'script-src ... 'sha256-/w41…''. Either ... a hash
('sha256-1Me3…')".

### Reproduce
`npm run build`, then any page of `vite preview`: the theme script in
`index.html` does not run.

### Hypotheses (most likely first)
1. The hash was taken over different bytes than the browser hashes.
   Evidence: the browser names another hash. Ruled out if hashing the
   script body from `dist/index.html` gives the browser's hash. Result:
   it gives ours (`/w41…`), but the file has CRLF line endings; the HTML
   parser turns CRLF into LF before hashing. Hashing the LF text gives
   `1Me3…`. Confirmed.
2. The prerender step changes the script after the hash is taken. Ruled
   out: only one inline script, unchanged by `scripts/prerender.mjs`.

### Root cause
`inlineScriptHashes` hashed the raw file text; on a Windows checkout
`index.html` has CRLF, which the browser normalises before hashing.

### Fix
`src/deploy/csp.js`: CRLF and CR become LF before hashing.

### Regression test
`csp.test.js` "line endings are hashed as the browser parses them". The
two landing tests pass again (`landing.spec.js`: 20 passed).

### Commit
C17.3a `feat(ci): add a Content-Security-Policy to the built app`

## 2026-11-12 C17.3 — fixed-layout EPUB pages rendered at 0 x 0

### Failure
The C17.3 check script on `/__epub?book=fixed`: blank screen; the page
iframe was 0 x 0 although its image had loaded.

### Reproduce
Open `fixed.epub` in `/__epub`; `frameElement.getBoundingClientRect()` of
the page's document is 0 x 0.

### Hypotheses (most likely first)
1. Our sanitizer removed `<meta name="viewport">`, from which foliate's
   fixed-layout renderer takes the page size. Evidence: `meta` was in
   `FORBID_TAGS`. Ruled out if the page body has no viewport meta and
   restoring it gives a size. Result: confirmed; with viewport metas kept
   the frame is 535 x 713.
2. foliate needs `rendition:spread` set differently. Not tested; 1 fixed it.

### Root cause
`FORBID_TAGS` included `meta` to stop `http-equiv` refreshes, which also
removed the viewport meta a fixed-layout page needs.

### Fix
`sanitize.js`: `meta` allowed through DOMPurify, then every meta except
`name="viewport"` without `http-equiv` is removed.

### Regression test
`hostile.epub` gained a `<meta http-equiv="refresh">`; the check script
asserts no `http-equiv` meta survives and the page does not navigate, and
that both fixed-layout pages render with a non-zero frame.

### Commit
C17.3d `feat(epub): sanitize sections and open EPUBs through foliate-js`

## 2026-11-12 C17.4 — lamplight PDF recoloured part of an image

### Failure
The C17.4 frame check: in Lamplight, page 4's raster image was half
recoloured (its grey right part turned page-coloured), against the rule that
images are never touched.

### Reproduce
`/__book?kind=pdf` in Lamplight, page 4; the image's low-chroma pixels change.

### Hypotheses (most likely first)
1. `imageRects` mis-reads PDF.js's corner points. Ruled out if the points it
   gets are empty. Result: they were empty: `task.imageCoordinates` returned
   `[]` (a scratchpad script on page 4).
2. PDF.js stores the coordinates elsewhere. Evidence: in `pdf.mjs` the render
   callback sets `this.imageCoordinates` on the page proxy, while the task's
   getter reads the internal task. Result: confirmed; `page.imageCoordinates`
   holds `[0.2385, 0.5454, 0.2385, 0.8486, 0.7612, 0.5454]`, the image's place.

### Root cause
PDF.js 6.4.299 records image positions on the page, not on the render task.

### Fix
`pdfjs.js`: `page.imageCoordinates ?? task.imageCoordinates`.

### Regression test
`recolour.test.js` covers the rectangles from corner points; the frame
check reads a pixel inside the image in Paper, Lamplight and Lamplight with
original colours: (80, 110, 134) in all three.

### Commit
C17.4 (PDF lamplight)

## 2026-11-12 C17.4 — lamplight PDF text had coloured fringes

### Failure
Lamplight PDF text looked ragged (screenshot): letters with bright edges.

### Reproduce
Count the canvas's colours in Lamplight: (255, 255, 183), (183, 87, 0),
(87, 183, 255)... among the text.

### Hypotheses (most likely first)
1. The canvas draws text with LCD (subpixel) antialiasing, whose fringes are
   coloured, so the recolouring keeps them as "coloured ink". Ruled out if a
   canvas with alpha (which Chrome antialiases in grey) still has them.
   Result: confirmed; with `getContext('2d', { alpha: true })` every text
   pixel lies between the page and text colours.

### Root cause
LCD antialiasing on an opaque canvas.

### Fix
`pdfjs.js`: Lamplight renders get a context with alpha.

### Regression test
The frame check's colour count and a close-up screenshot (scratchpad).

### Commit
C17.4 (PDF lamplight)

## 2026-11-12 C17.4 — the page-turn leaf jumped to its end state

### Failure
Sampling the leaf every 60 ms during a turn: from the first sample it was
at `rotateY(-180deg)`, opacity 0; no animation ran.

### Reproduce
`/__book?kind=pdf`, `__book.reader.next()`, read the leaf's inline style.

### Hypotheses (most likely first)
1. Reduced motion: the machine has it on and Playwright follows the system.
   Ruled out with `reducedMotion: 'no-preference'` (matchMedia false): it
   still jumped.
2. The `m.div` with inline keyframes: tried the variants pattern C12 uses;
   still jumped. Motion's `animate()` on a plain element in the same page
   animated, so Motion itself works; the cause in the `m` component was not
   found.

### Root cause
Not established (an `m.div` mounted inside the reader frame applied its
`animate` values at once).

### Fix
`Reader.jsx` `TurnLeaf`: the leaf moves with the Web Animations API
(`element.animate`), timed from the `--dur-5` and `--ease-settle` tokens;
the page changes when the leaf stands on edge (`timeAtProgress`).

### Regression test
`frame.test.js` "the turn happens when the leaf stands on edge"; the
sampling script shows opacity rising to 1 by 130 ms and falling to 0 at
600 ms with two running animations.

### Commit
C17.4 (frame)

## 2026-11-12 C17.5 — an EPUB session opened at the cover, not at today's chapter

**Status:** fixed

### Symptom
The adapted e2e on reflow.epub: the planner's note never showed and a
reload did not restore the place; the reader stood on the cover.

    npx playwright test e2e/reader.spec.js e2e/reading.spec.js
    epub › the first page of today's reading carries the note ...
    Error: expect(locator).toContainText(expected) failed
    Locator: locator('.rf-ov-note .rf-note') ... element(s) not found

### Repro
A throwaway spec printing the session's located bounds:
`LOCATE {"start":null,"end":null,"starts":[]}`; logging inside
`EpubBook.find`: `EB FIND false undefined` (no view handle yet).

### Hypotheses
1. The section text search misses (bad squeeze or `doc.body` null on
   XHTML). Ruled out: `find` in the engine was never called.
2. The session asks before the engine is handed over. Evidence: the
   frame's onReady fires on the first relocate, which foliate sends
   during `view.init()`, before EpubView's `setEngine` gives the ref its
   handle. Result: confirmed (`view.current` null).

### Root cause
`EpubBook` reached the engine only through EpubView's imperative handle,
which exists one render after the engine reports its first place
(`frontend/src/originalview/epub/EpubBook.jsx`, the ref methods).

### Fix
`EpubBook` keeps the engine from `onReady` and a promise for it; `find`,
`goTo`, `next`, `prev`, `first`, `last` wait for it.

### Regression test
`e2e/reader.spec.js` epub "the place is saved as an anchor ... restored
after a reload" and `e2e/reading.spec.js` epub "the first page ...
carries the note": failed before, pass after (30 passed).

### Commit
C17.5b feat(reader): open every book in its original form for today's reading

## 2026-11-12 C17.5 — a turn asked for while the leaf turned was dropped

**Status:** fixed

### Symptom
`e2e/reader.spec.js` "arrow keys, the turn buttons and the page edge":
after ArrowRight, an immediate click on Next did nothing (the place
stayed `{"start":"2","end":"3"}`) on both books.

### Repro
ArrowRight then Next within the leaf's 600 ms.

### Hypotheses
1. The Next button is disabled. Ruled out: enabled in the snapshot.
2. `move()` returns early while `busy` (the leaf is turning). Confirmed:
   C17.4's frame drops it; C12's reader queued it.

### Root cause
`Reader.jsx` `move`: `if (busy.current) return false`.

### Fix
The last turn asked for mid-turn is queued and run when the leaf lands.

### Regression test
The same e2e case: failed before, passes after.

### Commit
C17.5b feat(reader): open every book in its original form for today's reading

## 2026-11-12 C17.5 — the lookup e2e found no words in the EPUB

**Status:** fixed

### Symptom
Every EPUB lookup case failed before touching the reader:

    npx playwright test e2e/reader.spec.js
    epub › a known word shows its card ...
    Error: expect(received).not.toBeNull()  Received: null
    > expect(lamp).not.toBeNull();

### Repro
`wordPoint(page, 'lamp')` on reflow.epub returns null; on sample.pdf it
finds the word and the card opens.

### Hypotheses
1. The section iframes are not reached: the helper walked open shadow
   roots, but foliate's paginator keeps its iframe in a closed one
   (`el.shadowRoot` is null). Confirmed: no frames found, so it searched
   the page's own document.
2. Lookup itself fails inside iframes. Not the cause: after the helper
   fix the same cases pass.

### Root cause
`frontend/e2e/fixtures.js` `wordPoint` (a test helper, not app code).

### Fix
`wordPoint` reaches sections as Playwright frames (`page.frames()`),
shifted by each frame element's box.

### Regression test
`e2e/reader.spec.js` epub lookup cases: failed before, pass after.

### Commit
C17.5c feat(reader): look up words inside PDF and EPUB pages

## 2026-11-12 C17.6 — an EPUB reopened one page early after a text-size change

**Status:** fixed

### Symptom
The new e2e "after a text-size change the saved anchor reopens the same
place": after Larger text twice the page showed characters 1157-2685 of
section 1; after a reload at that size it showed 0-1157.

    npx playwright test e2e/reader.spec.js -g "text-size change"
    Error: the same place after a reload at the new size
    Expected: true  Received: false

### Repro
Traced relocates: the resume went to `epubcfi(/6/4!/4/8/1:435)` (the saved
point, character 1157, the page's first) and foliate reported the visible
range ending exactly there.

### Hypotheses
1. A collapsed range has no box on its own page. Tried: aim at its first
   character (`goToPoint`). Ruled out: foliate already uncollapses, and the
   result was the same.
2. A point at a page's very first character is ambiguous: foliate can
   place it at the end of the page before. Confirmed by the trace; the
   saved point sat on the boundary.

### Root cause
`EpubBook.anchor()` saved the collapsed start of the visible range
(`frontend/src/originalview/epub/EpubBook.jsx`), a page boundary.

### Fix
The reading position is a point a little inside the text shown (up to 40
characters, a quarter of the page at most), `engine.pointAt`.

### Regression test
`e2e/reader.spec.js` "after a text-size change the saved anchor reopens the
same place": failed before, passes after.

### Commit
C17.6 feat(reader): PDF and EPUB anchors, reading position and contents

## 2026-11-12 C17.6 — the position backfill would move a short place to its chunk's start

**Status:** fixed

### Symptom
`python scripts/backfill_positions.py --dry-run` on the project: the EPUB
place (block `0.14`, "Chapter II", 10 characters) would get
`epubcfi(/6/2!/4/2/1:0)`, the first element of the book, a chapter before
the reader's place. Expected: Chapter II's heading.

### Repro
`backend/tests/test_backfill_positions.py::test_a_short_block_is_found_with_the_text_after_it_not_by_its_chunks_start`:
a "Chapter 2" block mapped to `/6/4!` (chapter 1) instead of `/6/6!`.

### Hypotheses
1. The block's text is shorter than the shortest snippet (20 squeezed
   characters), so only the chunk's start was searched. Confirmed: a
   read-only query gave the block 10 characters; the second PDF place
   had 17 left after its offset and took the same fallback.
2. The spine order differs from ingestion's document order. Not the
   cause: the fix alone moves the place to the right section.

### Root cause
`scripts/backfill_positions.py` `snippets`: the block's text from the
offset, alone.

### Fix
The snippet runs from the offset through the blocks after it in the
chunk; the chunk's start stays the last fallback.

### Regression test
The test above: failed before (`/6/4!`), passes after (7 passed). The dry
run then gave `epubcfi(/6/4!/4/2/1:0)` for that place.

### Commit
fix(tooling): search past short blocks when backfilling reading positions

## 2026-11-12 C17.6 — the EPUB page-turn e2e fails now and then

**Status:** mitigated in the test on your call ("Harden the test"); the root cause is still not proven

### Symptom
`npm --prefix frontend run test:e2e` before the backfill-record commit: 123
passed, 1 failed, `reader.spec.js:16` "epub: pages and turns › arrow keys,
the turn buttons and the page edge turn the page". It had passed in the
three full runs before, and only `docs/PROGRESS.md` had changed.

    > 31 |       await expect.poll(() => shown(page)).toEqual(third);
    Error: expect(received).toEqual(expected) // deep equality

### Repro
`npx playwright test e2e/reader.spec.js:16 --repeat-each=8`: 1 failure in
16 runs, at the same line. Not reproduced since: 10 x 2, 24 and 40 runs on
the EPUB (the last with every place change traced), and 15 runs at 4x CPU
throttling all passed (79 in all).

### Hypotheses
1. The test records `third` at the first place change it sees after a
   turn; if foliate reports an in-between place while moving into the next
   section, that reading is not the page it settles on. Not confirmed (no
   failure with the trace on).
2. A page-edge click while a leaf is still turning is queued and runs
   against a stale place. Not confirmed.

### Root cause
Not established.

### Fix
`frontend/e2e/fixtures.js` `settled(page, away)`: a place is read only
once no leaf is turning and two reads 300 ms apart agree (and it differs
from `away`); the turn test reads every place through it. No app code
changed: hypothesis 1, if right, is a test race, not a reader bug.

### Regression test
`npx playwright test e2e/reader.spec.js:16 --repeat-each=40`: 80 passed
(both books). Before the change the failure was 2 in about 100 runs, so
this is evidence, not proof.

### Commit
test(reader): read each place in the turn test once its turn has landed

## 2026-11-13 C18.2b — the repo-graph test does not know the new table

**Status:** fixed (an expected test update, not a bug in the graph)

### Symptom
`pytest tools/repo_graph/tests -q` before the C18.2b commit: 61 passed,
1 failed, `test_build.py::test_real_graph_has_the_schema_and_the_agents`,
`assert {defines_table targets} == {the listed tables}`.

### Repro
Every run, after `make graph` with `018_page_regions.sql` staged.

### Hypotheses
1. The test lists the schema's tables by hand and `page_regions` is new.
   Confirmed: the graph's `defines_table` edges hold every listed table
   plus `table:page_regions`, which migration 018 creates.
2. The graph mis-parses 018's DO block as a table. Ruled out: the only
   new table node is `page_regions`.

### Root cause
The test's hand-written table list predates migration 018.

### Fix
`tools/repo_graph/tests/test_build.py`: `page_regions` added to the list.

### Regression test
The same test, which now pins the table set with `page_regions` in it.

### Commit
feat(regions): store page regions from a resumable regions job

## 2026-11-13 C18.4 — make graph rejects a purpose for the fixture PDF

**Status:** fixed

### Symptom
`make graph` before the C18.4 commit: "purposes.json is out of date ...
Purpose for a file that is not inventoried:
['backend/tests/fixtures/code_sample.pdf']"; then `pytest
tools/repo_graph/tests -q`: 4 failed, 58 passed (the graph was stale).

### Repro
Every run with the entry in `tools/repo_graph/purposes.json`.

### Hypotheses
1. The inventory leaves binary files such as PDFs out, so a purpose for
   one is stale by definition. Confirmed: the e2e `sample.pdf` and the
   other fixture PDFs have no purpose entry either.
2. The fixture was not staged. Ruled out: `git status` showed it added.

### Root cause
I added a purpose line for a file type the inventory does not list.

### Fix
The `code_sample.pdf` entry removed from `purposes.json`; its generator
`scripts/dev/make_code_fixture.py` keeps the description.

### Regression test
`make graph` runs clean and `pytest tools/repo_graph/tests -q` passes.

### Commit
feat(regions): detect code blocks and rebuild indentation exactly

## 2026-11-13 C18.6c — prose backfill not idempotent on books with over 1000 regions

**Status:** fixed

### Symptom
After the approved real run of `scripts/backfill_prose.py` (all 7 books
"handled"), a read-only `--dry-run` straight after said Dagano's chapter
would still store 6 of 70 chunks and re-question 5, with 2411 placeholders
against the 2395 just stored (the first dry run had said 2433). Expected:
"would store 0" for every book. No exception or trace.

    python scripts/backfill_prose.py --dry-run
      3e3040a3  'Dagano 14 Chapter Operational Amplifiers.Pdf': regions done; would store 6 of 70 chunks, re-question 5, 2411 placeholders, 13 garbled

### Repro
Read-only, against the shared project (count with `count="exact"`, then
`prose_job._rows("page_regions", "id", book_id, "order_in_page")` twice):

    3e3040a3 count 3422 fetched 3422 distinct 3390
    58a7d7e4 count 10624 fetched 10624 distinct 10181
    5c7fdf10 count 10624 fetched 10624 distinct 10179
    51fd1ff0 count 1498 fetched 1498 distinct 1498   (and every book under 1000 rows)

### Hypotheses
1. `_rows` pages with `.order("order_in_page").range(...)`; `order_in_page`
   is not unique within a book (every page restarts at 0), so Postgres may
   return tied rows in a different order for each range: some rows come
   twice, others never. Evidence: only books over one page of 1000 rows are
   hit. Ruled out if: fetched ids are all distinct. Result: confirmed (above).
2. The regions job stored different rows on two runs (classification not
   deterministic). Ruled out by 1: the stored count is fixed, the fetch is
   what varies.

### Root cause
`backend/services/prose_job.py` `_rows`: paging ordered by a non-unique key.
The chunk select (ordered by `chunk_index`, unique per book) was not hit.

### Fix
Order every page by the given column and then by `id`, a unique tiebreak,
so ranges partition the rows exactly.

### Regression test
`backend/tests/test_prose_job.py::test_paging_orders_by_a_unique_tiebreak`
(a fake query that returns ties in a different order on each call). Failed
before the fix (fix stashed: 1 failed, 7 passed), passes after (8 passed). The
fixture rows of `test_prose_job.py` and `test_backfill_prose.py` gained ids, as
real rows have. Re-run of the repro after the fix, read-only: 3e3040a3 3422
fetched, 3422 distinct; both 58a7d7e4 and 5c7fdf10 10624 / 10624. Standard
checks: ruff 27, pytest 1059, ESLint 4, build, import, graph 62, contrast and
images 0 failing, unit 120, e2e 127.

The stored prose of the three books over 1000 regions was built from an
incomplete region set; it is rebuilt by running the backfill again (your
approval). The 9 chunks without prose belong to two device-only books (no
file on the server, so no regions job): expected, not this bug.

### Commit
`b6f596d` fix(ingest): page regions by a unique order when rebuilding prose

Rerun after the fix (approved): the 32 chunks were stored, and a dry run straight
after would store 0 chunks in every book.

## 2026-11-13 C18.G — EPUB prose rebuild fails on blocks outside the spine

**Status:** fixed

### Symptom
Gate G5's offline ingestion of the shelf's Alice EPUB stored no prose
(`with_prose: 0`); expected every chunk to get prose. The job printed:

    python scripts/dev/gate_g5.py --book alices-adventures-in-wonderland.epub
    Prose of book alices-adventures-in-wonderland not rebuilt: unsupported operand type(s) for +: 'NoneType' and 'int'

    Traceback (most recent call last):
      File "I:\readfocus\backend\services\prose_job.py", line 86, in rebuild
        writes, report = plan(book, file_bytes, *load(book["id"]))
      File "I:\readfocus\backend\services\prose_job.py", line 68, in plan
        built = prose.epub_prose(contents, blocks if all(blocks) else None, paths if all(paths) else None, regions)
      File "I:\readfocus\backend\regions\prose.py", line 254, in epub_prose
        first = first or {"spine_index": spine, "cfi": _cfi(spine, path), "location": location}
      File "I:\readfocus\backend\regions\prose.py", line 238, in _cfi
        return f"epubcfi(/6/{2 * (spine + 1)}!{path})"
    TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'

### Repro
`book_structure.build_with_paths` on Alice: 25 of 913 blocks (chunk 45) have
`spine_index: None` (a document read by ingestion but not in the spine);
`prose.epub_prose` on those paths raises every time. None of the seven books
in the Supabase project is an EPUB, so the C18.6c backfill never met it.

### Hypotheses
1. `epub_prose` builds a CFI for every block, and a block outside the spine
   has no spine index. Evidence: the trace and the 25 blocks. Ruled out if
   the first chunk with such a block does not raise. Result: confirmed.

### Root cause
`backend/regions/prose.py` `epub_prose`: anchors are built for blocks with
no spine index (`_cfi(None, path)`).

### Fix
Blocks without a spine index still count toward the skeleton position but
give no anchor place; a chunk with no spine block has `start` and `end` null.

### Regression test
`backend/tests/test_prose.py::test_epub_blocks_outside_the_spine_get_no_anchor`. Failed
with the fix stashed (1 failed, 13 passed), passes with it (14 passed). The
repro after the fix: Alice's offline ingestion stores prose on 46 of 46
chunks, no garbled item. Standard checks: see the commit.

### Commit
fix(regions): skip blocks outside the spine when anchoring EPUB prose

## 2026-11-13 C18.G — a garbled run split across lines passes the question filter

**Status:** fixed

### Symptom
Gate G5's offline ingestion of the shelf flagged 2 question prompts as
garbled (expected 0): no exception, found by the gate's scan.

    python scripts/dev/gate_g5.py
    sicp.pdf  PROMPT: 'Fill in the blank: D E A B S C Figure 3.25:A half-adder circuit. circuit shown inFigure 3.25consists of an or-gate, two and-gates, and an _____.' ['spaced_letters']
    interactive-linear-algebra.pdf  PROMPT: 'Fill in the blank: Consider the system of two _____ n x + y + z = 1 x − z = 0.' ['spaced_letters']

### Repro
`backend/tests/test_question_generation_agent.py::test_a_garbled_run_split_across_lines_is_still_dropped`
(figure labels one per line before a sentence).

### Hypotheses
1. `body_sentences` runs `is_garbled` on the sentence's verbatim span, where
   the single letters sit on separate lines; the detector's spaced-letter run
   only joins single spaces, so the run shows only in the prompt, whose
   whitespace is collapsed. Evidence: both prompts are `spaced_letters`,
   both sources have one letter per line. Ruled out if the span with its
   lines joined is not garbled. Result: confirmed (it is).

### Root cause
`backend/agents/question_generation/agent.py` `body_sentences` checked the
span as printed only; `evaluator_agent.reference_from_passage` likewise.

### Fix
`agent.garbled(span)`: the detector on the span as printed and with its
whitespace collapsed (as a question shows it); the evaluator's reference
sentences are checked with whitespace collapsed.

### Regression test
`test_question_generation_agent.py::test_a_garbled_run_split_across_lines_is_still_dropped`:
1 failed with the fix stashed, passes with it.

### Commit
fix(agents): check sentences for garble with their lines joined

## 2026-11-13 C18.G — garbled sentences stay in the agents' prose

**Status:** fixed

### Symptom
Gate G5 scans every sentence of every chunk's prose with `is_garbled`;
expected 0 flagged, got SICP 2,105 of 14,003 and Interactive Linear Algebra
172 of 5,375 (Calculus, Circuits, Alice 0):

    python scripts/dev/gate_g5.py
    sicp.pdf: prose_garbled 2105 (reasons: private_use 2089, control 27, ligature 3, symbol_in_word 2)
      'e Massachuses Institute of Technology'   ("The Massachusetts")
    interactive-linear-algebra.pdf: prose_garbled 172 (control 155, private_use 18)
      'form matrix was \x81 1 0 5 1\n0 1 2 −1\n\x8b\n.'   (matrix brackets)

### Repro
`backend/tests/test_prose.py::test_a_garbled_sentence_becomes_an_unreadable_placeholder_with_its_page`
and the three tests after it.

### Hypotheses
1. C18.6 counts garbled sentences and keeps them out of questions and
   evidence, but `pdf_prose` and `epub_prose` leave their text in `prose`,
   which Steve and any later reader of `prose` would see. The C18 plan
   asked for an `unreadable` placeholder instead. Evidence: every flagged
   item is a sentence that `prose` still holds verbatim. Ruled out if the
   flagged sentences were not in `prose`. Result: confirmed.
2. The detector over-flags. Ruled out: the reasons are Linux Libertine's
   Private Use Area ligatures (U+E049 "Th", U+E03C "tt") and control
   characters for ILA's matrix brackets, real artefacts (C18.1).

### Root cause
`backend/regions/prose.py`: garbled sentences were counted, never replaced.

### Fix
`prose.unreadable` replaces each garbled sentence (checked without its
placeholders, as printed and with its lines joined) with "[Unreadable text,
p. N]" ("sec. N" in an EPUB), keeping the placeholders it held after it; the
page comes from the skeleton position of the sentence's first character
(`_apply` now records one per character). The placeholder is listed in the
chunk's anchors (`kind: unreadable`), counted in `garbled` and stored as
`garbled_sentences`; question generation already leaves out sentences with
a placeholder.

### Regression test
`test_prose.py`: the four unreadable tests failed with the fix stashed (4
failed, 14 passed), pass with it (18 passed).

### Commit
fix(regions): replace garbled sentences in prose with unreadable placeholders

## 2026-11-13 C18.G — a 769-page PDF runs out of memory in the 512 MB container

**Status:** fixed

### Symptom
Gate G5, the whole pipeline (ingestion, regions job, prose rebuild) on the
shelf's Calculus Volume 1 (52 MB, 769 pages) in the Render-sized container:
killed by the kernel. Expected: peak under Render Free's 512 MB.

    docker run --rm --network none --memory=512m --memory-swap=512m -v <repo>:/repo:ro -w /repo -e SUPABASE_URL=http://127.0.0.1:9 -e SUPABASE_SERVICE_KEY=offline -e PYTHONPATH=/repo readfocus-c18g-measure python scripts/dev/gate_g5.py --book calculus-volume-1.pdf
    (no output after "model loaded, RSS 211.4 MB"; exit 137, State.OOMKilled true)

With `--memory=2g`: peaks ingest 749 MB, regions job 848 MB, prose rebuild
1,036 MB (each phase's peak includes what earlier phases kept). The other
four shelf books finish at 402 to 464 MB.

### Repro
The command above (12 minutes; fails every time at 512 MB).

### Hypotheses
1. Each pypdf parse of the whole file costs about 190 MB at once, and the
   pipeline parses it three times (ingestion's text, `book_structure`'s
   page starts for the outline, the prose rebuild's page texts); on Linux
   the freed memory stays with the process, so each phase starts higher.
   Evidence (step-by-step profile in the container, `/proc/self/status`):
   file read 299 MB, every page's text 493 MB, after `gc` and
   `malloc_trim(0)` 303 MB; `build_with_paths` 496 MB, trimmed 305 MB;
   regions job 461 MB, trimmed 410 MB; page texts again 590 MB, trimmed
   415 MB. Ruled out if a batched parse peaks as high. Result: confirmed.
   One reader for all 769 pages: 88 to 288 MB; a fresh reader per 50
   pages: 88 to 136 MB peak (20 pages: 129 MB), and the text of every page
   identical (same sha256 of all 769 texts).
2. pdfplumber holds the regions job's pages. Partly: 364 to 461 MB over 769
   pages with the file reopened per 20 pages, 410 MB after a trim; smaller
   than 1.

### Root cause
`backend/services/book_ingestor.py` `extract_text_from_pdf`,
`book_structure.pdf_contents` and `prose_job.pdf_page_texts` each parsed
the whole PDF with one pypdf reader (about 200 MB for this book), and on
Linux no phase gave freed memory back, so the job's peaks stacked; the
prose rebuild also held every region's full `meta` (fonts, garble scores,
boxes) for 15,000 regions.

### Fix
`backend/services/pdf_text.py` (new): `page_texts` reads 50 pages per fresh
reader (same text for every page), used by all three; `release_memory`
(`gc` + glibc `malloc_trim(0)`, a no-op elsewhere) after ingestion's parse,
after each ingest batch, after each regions batch and once the prose plan
is built. `prose_job.load` keeps only the six `meta` keys prose reads.
`book_structure.pdf_contents` still reads the page texts (batched) for its
page starts: passing them from ingestion would change the stubbed
`extract_text_from_pdf` seam the ingestion tests use; it costs time, not
memory.

Container, 512 MB, Calculus: before, killed (2 GB cap: 749 / 848 / 1,036
MB); after the batching and trims, finished at 398 / 476 / 524 MB; after the
slim regions, finished at 399 / 475 / 502 MB, the gate's in-memory
database holding 12 MB of that.

### Regression test
`backend/tests/test_pdf_text.py` (failed at collection without the module):
batched text equals one reader's on every page, ingestion text unchanged,
the structure reads through the batched reader, `release_memory` never
raises; `test_prose_job.py::test_regions_are_loaded_with_only_the_meta_prose_needs`
(failed before `_slim`). Memory itself is checked by hand in the container
(`scripts/dev/gate_g5.py`), not in pytest.

### Commit
fix(ingest): read PDF text a few pages at a time and hand memory back

## 2026-11-13 C18.G — `make graph` leaves a diff at the chunk close

**Status:** fixed

### Symptom
Closing C18, `make graph` on a clean tree changed `docs/repo-graph/inventory.json`
and `REPO_MAP.md`; expected no diff:

    make graph && git status --short docs/repo-graph
     M docs/repo-graph/REPO_MAP.md
     M docs/repo-graph/inventory.json
    (docs/BENCHMARKS.md lines 1386 -> 1405, size 79000 -> 80101;
     docs/PROGRESS.md lines 3729 -> 3731, size 695554 -> 699295)

### Repro
`make graph && git diff --stat docs/repo-graph` at `2556493`.

### Hypotheses
1. The last docs-only commits (`f9b0f96`, `30b4bc8`, `2556493`) changed
   `docs/BENCHMARKS.md` and `docs/PROGRESS.md` without regenerating the
   graph, whose inventory records every tracked file's lines and size.
   Ruled out if other entries differ. Result: confirmed (only those two).

### Root cause
Docs commits were made without `make graph`; the inventory tracks docs too.

### Fix
Regenerate and commit the graph. No code change.

### Regression test
None automated: the check is `make graph` leaving no diff, re-run after this
commit (clean).

### Commit
fix(graph): refresh the inventory after the C18.G docs commits

## 2026-11-13 C19.1 — epubcheck: `annotation` not allowed in the converted fixture

**Status:** fixed

### Symptom
epubcheck 5.4.0 (in Docker, `eclipse-temurin:21-jre`, after the user's
"Yes, download") on the committed e2e fixture and on the builder's test
book. Expected 0 errors and 0 warnings for both; the test book passed, the
fixture did not:

    docker run --rm -v "<scratchpad>/epubcheck-dl/ex/epubcheck-5.4.0:/ec:ro" -v "<scratchpad>/books:/books:ro" eclipse-temurin:21-jre sh -c 'for f in /books/*.epub; do echo "== $f"; java -jar /ec/epubcheck.jar "$f" 2>&1; done'
    == /books/converted.epub
    Validating using EPUB version 3.4 rules.
    ERROR(RSC-005): /books/converted.epub/OEBPS/chapter-002.xhtml(3,891): Error while parsing file: element "annotation" not allowed here; expected the element end-tag or element "ns:maction", "ns:maligngroup", "ns:malignmark", "ns:menclose", "ns:merror", "ns:mfenced", "ns:mfrac", "ns:mi", "ns:mlongdiv", "ns:mmultiscripts", "ns:mn", "ns:mo", "ns:mover", "ns:mpadded", "ns:mphantom", "ns:mroot", "ns:mrow", "ns:ms", "ns:mspace", "ns:msqrt", "ns:mstack", "ns:mstyle", "ns:msub", "ns:msubsup", "ns:msup", "ns:mtable", "ns:mtext", "ns:munder", "ns:munderover" or "ns:semantics" (with xmlns:ns="http://www.w3.org/1998/Math/MathML")

    Check finished with errors
    Messages: 0 fatals / 1 error / 0 warnings / 0 infos
    == /books/test-book.epub
    Validating using EPUB version 3.4 rules.
    No errors or warnings detected.
    Messages: 0 fatals / 0 errors / 0 warnings / 0 infos

### Repro
The same command on `frontend/e2e/fixtures/books/converted.epub` (fails
every time; deterministic file). Without Java:
`pytest backend/tests/test_epub_builder.py -q -k "fixture or semantics"`.

### Hypotheses
1. The fixture's MathML is invalid: `<annotation>` sits directly in
   `<math>`, but MathML allows it only inside `<semantics>` (with the
   presentation in an `<mrow>` first). Evidence: line 3, column 891 of
   chapter 2 is the end of the math; the builder's own test book (MathML
   without annotation) passes. Ruled out if: the same markup wrapped in
   `<semantics>` still fails. Result: confirmed (see Fix: the rebuilt
   fixture passes epubcheck with 0/0).
2. The builder serialises MathML wrongly (namespace lost, prefixes).
   Evidence: none beyond the error's `ns:` prefixes, which are
   epubcheck's own. Ruled out if: the test book's MathML passes. Result:
   ruled out, the test book passes.

### Root cause
`tools/make_converted_fixture.py:27` wrote `<annotation>` as a direct
child of `<math>`. The builder passed it through, and `check_epub`
(`backend/convert/epub_builder.py`) had no MathML rule, so only epubcheck
saw it.

### Fix
The fixture's math is now `<math><semantics><mrow>…</mrow><annotation
encoding="application/x-tex">…</annotation></semantics></math>`, as KaTeX
writes it (`regions/epub.py` finds the annotation anywhere inside
`<math>`). `check_epub` now reports an `annotation` or `annotation-xml`
whose parent is not `semantics`, so the structural checks catch it
without Java. First attempt.

### Regression test
`backend/tests/test_epub_builder.py::test_check_epub_flags_an_annotation_outside_semantics`
and `::test_the_committed_converted_fixture_is_sound`. Before the fix
(`git stash push -- backend/convert/epub_builder.py
tools/make_converted_fixture.py frontend/e2e/fixtures/books/converted.epub`):
1 failed, 1 passed (the semantics test fails; the fixture test passes
because `check_epub` had no MathML rule yet). With the new rule but the
old fixture: the fixture test fails (1 failed, 1 passed). After the whole
fix: 2 passed; `test_epub_builder.py` 15 passed. epubcheck on the rebuilt
fixture (3,663 bytes) and the test book: 0 fatals / 0 errors / 0 warnings
/ 0 infos each.

### Commit
fix(convert): wrap the fixture's TeX annotation in MathML semantics

## 2026-11-13 C19.4 — a resumed ingest would take OCR text into a mixed book's chunks

**Status:** fixed

### Symptom
Found in the C19 close's self-review of `git diff readfocus-2.0...HEAD`, not
by a failing check. `book_ingestor.run_job` (C19.4a) loads every stored
`page_ocr` text and lets it stand in for its page on every run. A book with
text of its own (a mixed book) is ingested once without OCR; if its job is
run again later (the startup sweep resumes stale jobs, common on Render
Free) after the reader has OCR'd a scanned page, the pages hold more text,
`chunk_text` cuts different chunks, and they are upserted by index over the
first run's: stored chunk text changes under questions that quote it
(C18's rule, ANCHORS A6). Expected: OCR text only for a book whose own text
gives no chunks at all (a fully scanned book), the case re-ingest is for.

    pytest backend/tests/test_ocr_pages.py -q -k "fully_scanned_book_is_read or own_text_never"
    E       AssertionError: assert ['Some text o...on page two.'] == ['Some text o... first page.']
    E         Left contains one more item: 'Read by OCR on page two.'
    1 failed, 1 passed, 19 deselected in 2.08s

### Repro
`pytest backend/tests/test_ocr_pages.py::test_a_book_with_its_own_text_never_takes_ocr_text_into_chunks -q`
(a two-page PDF, page 1 with text, page 2 scanned with stored OCR text).

### Hypotheses
1. `run_job` passes `ocr_pages.load_texts(book_id)` to `extract_text_from_pdf` whatever the book's own
   text is. Evidence: `backend/services/book_ingestor.py`, the C19.4 branch of `run_job`. Ruled out if:
   the repro's chunks hold no OCR text. Result: confirmed by reading the code and the repro's output.

### Root cause
`backend/services/book_ingestor.py` `run_job`: the OCR texts were loaded and
substituted unconditionally, not only for a book with no text of its own.

### Fix
Attempt 1: `run_job` read the PDF's own text first and loaded OCR text only
when that gave no chunks. The repro passed, but the companion test (a
fully scanned book whose second page carries a stray " 3 ") failed: a page
number or a scanner's stamp makes chunks, so such a book would never be
read from its OCR text (and, with chunks, never re-ingested).

Attempt 2 (kept): `extract_text_from_pdf(file_bytes, ocr, scanned)` takes
an OCR *loader* and calls it only when every page is a scanned page (fewer
than `OCR_MIN_PAGE_CHARS` visible characters); then the stray marks are
dropped and the OCR text is the book's text (before any OCR: no text, so
no chunks and the pages-only opening). A book with any page of its own
text never asks for OCR text, so its chunks are the same on every run.
`run_job` passes a loader that also records what it loaded (the region
job is still skipped for a book read from OCR).

### Regression test
`backend/tests/test_ocr_pages.py::test_a_book_with_its_own_text_never_takes_ocr_text_into_chunks`,
`::test_ingestion_flags_pages_without_text_and_keeps_a_mixed_books_own_text`
and `::test_a_fully_scanned_book_takes_its_ocr_text_and_drops_stray_marks`.
With `backend/services/book_ingestor.py` stashed: 3 failed. With the fix:
3 passed; `test_ocr_pages.py` 22 passed; `pytest backend/tests -q` 1159
passed.

### Commit
fix(ingest): read OCR text only for books with no text of their own

## 2026-11-14 C20.1 — repo graph tests fail after the C20.1 commit: purposes.json out of date

**Status:** fixed

### Symptom
After `2d589ff` (`feat(steve): add Steve spec, consent and settings`), the
repo graph tests fail; they passed in the C20.1 standard checks run before
the commit. Expected: 62 passed.

    pytest tools/repo_graph/tests -q
    4 failed, 58 passed in 0.66s
    FAILED tools/repo_graph/tests/test_build.py::test_real_graph_covers_routers_and_pages
    FAILED tools/repo_graph/tests/test_build.py::test_real_graph_has_the_schema_and_the_agents
    FAILED tools/repo_graph/tests/test_inventory.py::test_repo_inventory_is_complete_and_deterministic
    FAILED tools/repo_graph/tests/test_render.py::test_real_map_has_two_diagrams_and_is_deterministic
    >           raise InventoryError(
    E           tools.repo_graph.inventory.InventoryError: purposes.json is out of date.
    tools\repo_graph\inventory.py:151: InventoryError

    make graph
    python tools/repo_graph/inventory.py
    purposes.json is out of date.
      No purpose (read the file, then add one): ['backend/routers/steve.py', 'backend/steve/__init__.py', 'backend/steve/consent.py', 'backend/tests/test_steve_settings.py', 'docs/STEVE.md', 'supabase/migrations/023_steve.sql']
      Purpose for a file that is not inventoried: []
    make: *** [Makefile:17: graph] Error 1

### Repro
    pytest tools/repo_graph/tests/test_inventory.py::test_repo_inventory_is_complete_and_deterministic -q

### Hypotheses
1. The inventory lists `git ls-files` only, so `make graph` and the graph
   tests run while the six new files were untracked saw nothing missing;
   committing them made them tracked without a purpose. Evidence:
   `tools/repo_graph/inventory.py:77` `tracked_files` runs
   `git ls-files -z`; the six paths listed are exactly the files C20.1
   added. Ruled out if: the tests fail on `readfocus-2.0`'s tree too.
   Result: confirmed (the failure names only the C20.1 files; the C20
   plan commit `f6db534` passed the same tests).
2. A stale purpose for a removed file. Ruled out if the "not inventoried"
   list is empty. Result: ruled out (it is `[]`).

### Root cause
`tools/repo_graph/purposes.json` has no entry for the six files C20.1
added; the C20.1 checks ran before the files were staged, so the
inventory (tracked files only) did not see them.

### Fix
A purpose for each of the six files in `purposes.json` (appended, file
order kept; a first attempt re-sorted the file and was reverted before
any test), then `make graph` with the files tracked, and the regenerated
`docs/repo-graph/` committed. That left one failure:
`test_build.py::test_real_graph_has_the_schema_and_the_agents` lists the
schema's tables exactly, and migration 023 adds `steve_usage`,
`steve_threads` and `steve_messages`; they are added to its expected set
(the test stays exact, as it was for `page_ocr` in C19.4).
Process: run `make graph` and the graph tests after `git add`, or after
`git add -N` for new files.

### Regression test
`tools/repo_graph/tests/test_inventory.py::test_repo_inventory_is_complete_and_deterministic`
already guards this. Failed before the fix: yes
(`git stash push -- tools/repo_graph/purposes.json`: 1 failed, the
InventoryError above). Passes after: yes (`git stash pop`: 1 passed).
`pytest tools/repo_graph/tests -q`: 62 passed.

### Commit
`fix(graph): add purposes for the C20.1 files`

## 2026-11-14 C20.8a — `make graph` exits 2 once, right after `git add`

**Status:** open (intermittent; cause found in C20.8c, fix not made)

### Symptom
Twice in C20 (C20.2 and C20.8a) the first `make graph` after staging a
change exited 2 with its output sent to /dev/null; the next run exited 0
and wrote a different `docs/repo-graph/REPO_MAP.md` (the failed run had
stopped before render.py). Expected: exit 0 every time.

    git add <files> ; make graph >/dev/null 2>&1 ; echo $?
    2

### Repro
Not reproduced: `make graph` three times in a row with output captured,
exit 0 each time (2026-11-14, after the C20.8a failure).

### Hypotheses
1. A race with git's index right after `git add` (inventory.py runs
   `git ls-files`). Evidence: both failures came straight after a
   `git add` in the same shell command. Ruled out if: it fails with no
   `git add` before it. Result: untested.
2. An inventory check that depends on staged versus working-tree text
   (line endings: every `git add` warns LF will become CRLF). Ruled out
   if: the captured output of a failing run names another cause.
   Result: untested; the failing runs' output was discarded.

### Root cause
Found on the third occurrence (C20.8c), with the output kept:

    python tools/repo_graph/inventory.py
    Traceback (most recent call last):
      File "I:\readfocus\tools\repo_graph\inventory.py", line 194, in <module>
        sys.exit(main())
      File "I:\readfocus\tools\repo_graph\inventory.py", line 184, in main
        OUT_FILE.write_text(render(inventory), encoding="utf-8", newline="\n")
      ...
    OSError: [Errno 22] Invalid argument: 'I:\\readfocus\\docs\\repo-graph\\inventory.json'
    make: *** [Makefile:17: graph] Error 1

Opening `docs/repo-graph/inventory.json` for writing fails on Windows
right after `git add` has staged it: hypothesis 1 (a race), as a
sharing violation that Windows reports as EINVAL while another process
(git, or a file scanner) still holds the file. Not a logic error: the
content written by the next run is the same.

### Fix
Not made (tooling, outside C20; your call): retry the write a few times
in `inventory.py` (and build.py, render.py) on OSError. Working rule
meanwhile: run `make graph` with its
output kept, and run it again after staging until a second run leaves no
diff (done for C20.2 and C20.8a; both commits' graphs are stable).

### Regression test
None (not reproduced).

### Commit
Recorded with `feat(steve): equation LaTeX cache, region details and figure context`.
