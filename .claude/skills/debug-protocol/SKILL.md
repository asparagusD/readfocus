---
name: debug-protocol
description: "Use on any failure in this repo: a failing test or standard check, a stack trace, a server that will not start, a wrong result, or behaviour that differs from what was expected. Runs the 10-step debug protocol (capture in docs/DEBUG_LOG.md, reproduce, locate via the repo graph, ranked hypotheses, one test at a time, minimal root-cause fix, regression test, re-run checks, record and commit) and stops after 3 failed attempts."
---

# Debug protocol

Follow the ten steps in order. Do not edit code before step 6. The aim is the
root cause, fixed once, with a test that keeps it fixed.

## The ten steps

### 1. Capture

Before changing anything, add an entry to `docs/DEBUG_LOG.md` under the
heading

```
## <date> C<n>.<m> — <symptom>
```

with the date as `YYYY-MM-DD`, the subchunk being worked on, and the symptom
in a few words. Paste the exact command, the exact error and the full stack
trace. Do not paraphrase or trim the trace. Use the template at the end of
this file.

Never paste secrets: redact keys, tokens and passwords from the output first.

### 2. Reproduce

Find the smallest command or test that fails every time and write it in the
entry. For example:

```bash
pytest backend/tests/test_ingestor.py::test_chunk_text -q
```

If it does not fail every time, say so, and record how often and under what
conditions. A failure that cannot be reproduced cannot be shown to be fixed.

### 3. Locate

Read the failing file and its upstream and downstream files using the repo
graph:

```bash
python tools/repo_graph/query.py <file>
```

Until C2 adds this tool, find the neighbours by hand: search for the module's
imports and for where it is imported.

Read the code along the path of the failure before forming an opinion. Check
what changed recently:

```bash
git log --oneline -10 -- <file>
git diff readfocus-2.0 -- <file>
```

### 4. Hypothesise

Write one to three hypotheses in the entry, ranked by likelihood. Each needs
the evidence for it and the observation that would rule it out. "Something is
wrong with the database" is not a hypothesis; "the `sessions` insert fails
because `test_questions` is null for books ingested before migration 003" is.

### 5. Test one at a time

Take the top hypothesis. Run the cheapest experiment that can confirm it or
rule it out: a print, a narrower test, a query. Record the result in the
entry. Change one thing per experiment and undo it afterwards. Do not stack
speculative fixes.

### 6. Fix the root cause

Make the smallest change that removes the cause, not the symptom. Not allowed
as fixes:

- catching and discarding the exception;
- skipping, deleting or loosening the failing test;
- adding a retry or sleep around a deterministic failure;
- special-casing the one input that failed.

### 7. Add a regression test

Write a test that fails without the fix and passes with it, and run it both
ways to prove that:

```bash
git stash push -- <fixed files>      # test must FAIL here
git stash pop                        # test must PASS here
```

Record both results in the entry. If the bug cannot be covered by an
automated test, say why and record the manual check instead.

### 8. Re-run the standard checks

```bash
ruff check backend/
pytest backend/tests -q
npm --prefix frontend run lint
npm --prefix frontend run build
python -c "import backend.main"
```

Compare against the baseline table in `CLAUDE.md`. Nothing may be worse than
before the bug appeared.

### 9. Record and commit

Complete the entry: root cause, fix, regression test, commit. Then commit the
fix, the test and the `docs/DEBUG_LOG.md` entry together, using the
`atomic-commit` skill, with the header

```
fix(<scope>): <what was wrong, in the imperative>
```

Add the commit hash to the entry in the next commit that touches the log, or
write the header text if the hash is not known yet.

### 10. Stop after three failed attempts

An attempt is one fix that was applied and did not make the reproduction
pass. After the third:

1. Stop. Do not try a fourth.
2. Restore the last green state. Keep the work if it may be useful:

   ```bash
   git stash push -u -m "debug C<n>.<m>: <symptom>, attempt 3"
   ```

   or discard it:

   ```bash
   git restore --staged --worktree -- <files>
   ```

3. Re-run the standard checks to confirm the tree is green again.
4. Mark the entry `Status: open` and report to the user: the symptom, the
   reproduction, each hypothesis and what ruled it out, the three attempts,
   and what you would try next.

Restoring covers tracked files only. Ask before discarding anything that
cannot be recovered, and never use `git reset --hard` or `git clean` here.

## Rules that apply throughout

- Never claim a fix works unless the reproduction from step 2 was re-run and
  passed.
- If the failure is in a standard check that already failed before the sprint
  (see the baseline in `CLAUDE.md`), it is not a new bug. Do not start the
  protocol for it unless the count went up.
- If the cause is outside the current subchunk's scope, log it, tell the
  user, and do not fix it in passing.
- Database fixes follow hard constraint 2: additive migrations only, dev
  database only.

## DEBUG_LOG.md entry template

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
