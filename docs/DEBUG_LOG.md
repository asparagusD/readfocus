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
