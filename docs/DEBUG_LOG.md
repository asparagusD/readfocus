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

## 2026-11-10 C7.4 — finish-reading returns 500 once: "Server disconnected" from Supabase

**Status:** open (outside C7.4; logged, not fixed)

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
