---
name: atomic-commit
description: "Use before every git commit in this repo: checks the change is one focused, working subchunk, stages files explicitly, runs the standard checks, and writes the commit message in the project format (header, Chunk: C<n>.<m>, What/Why/How verified/Notes). Also use for chunk merge commits and when a change is too big and needs splitting."
---

# Atomic commit

One subchunk = one focused, working change = one commit. Follow the steps in
order. The rules come from `CLAUDE.md`; this skill is how to apply them.

## 1. Check the size

- The commit does one thing. If the message needs "and" to describe it, split
  it.
- At most ~200 changed lines. Lockfiles, Supabase migrations and generated
  graph files (`docs/repo-graph/`) do not count.
- If it is larger, split it into `C<n>.<m>a` and `C<n>.<m>b`. Each half must
  leave the app working on its own.
- Tests for the change go in the same commit, not a later one.

Measure before staging:

```bash
git diff --stat
```

## 2. Run the pre-commit checklist

- [ ] Standard checks are green (run from the repo root, virtualenv active):

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
  ```

  Never commit failing checks. `CLAUDE.md` holds a baseline table for checks
  that already failed before the sprint: those counts may not go up, and
  every other check must pass. If a check gets worse, stop and load
  `debug-protocol`.
- [ ] Repo graph regenerated with `make graph` if files were added, removed
  or rewired, and `docs/repo-graph/` is part of this commit.
- [ ] The subchunk's row in `docs/PROGRESS.md` is ticked. (Available from
  C1.7.)
- [ ] No secrets in the diff: no `.env` files, keys or tokens.

## 3. Stage explicitly

Name every path. Never `git add -A`, `git add .` or `git commit -a`.

```bash
git add backend/services/embeddings.py backend/tests/test_embeddings.py
git status --short
git diff --cached --stat
```

Read the staged list before committing. Anything you did not mean to change
gets unstaged with `git restore --staged <path>`.

## 4. Write the message

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

- Header is at most 72 characters, imperative mood, lower case after the
  colon, no trailing full stop.
- `How verified` lists only commands that were actually run, with their real
  output. If something was not run, say so under `Notes`.
- End with the `Co-Authored-By` trailer when Claude wrote the change.

### Types

| Type | Use for |
|---|---|
| `feat` | New user-facing behaviour |
| `fix` | A bug fix; needs a regression test and a `docs/DEBUG_LOG.md` entry |
| `refactor` | Structure change with no behaviour change |
| `perf` | Faster or lighter, same behaviour |
| `test` | Tests only |
| `docs` | Documentation only |
| `chore` | Tooling, config, dependencies, skills |
| `merge` | Chunk merge commits only (see step 5) |

### Scopes

| Scope | Covers |
|---|---|
| `backend` | `backend/` outside the areas below |
| `agents` | `backend/agents/` |
| `api` | `backend/routers/` |
| `ingest` | Book parsing, chunking, embeddings |
| `frontend` | `frontend/src/` logic and routing |
| `ui` | Visual design, styles, components |
| `db` | `supabase/migrations/` |
| `tooling` | `CLAUDE.md`, `.claude/`, `scripts/`, `tools/`, `Makefile`, env examples |
| `graph` | Repo graph tooling and `docs/repo-graph/` |
| `ci` | `.github/workflows/`, deploy config |
| `docs` | `docs/`, `README.md` |

Use one scope: the area where the main change lives.

## 5. Merge commits

When a chunk is finished, merge it into `readfocus-2.0` without
fast-forwarding:

```bash
git switch readfocus-2.0
git merge --no-ff chunk/C1-guardrails -m "merge(C1): guardrails, agent skills and project memory"
```

The header is `merge(C<n>): <title>`. The body lists the subchunks merged.
`main` is merged into only at release.

## Good example

```
feat(ingest): embed chunks with a local fastembed model

Chunk: C4.2

What:
- backend/services/embeddings.py: replace the Google AI Studio call with
  a fastembed TextEmbedding model loaded once at import.
- backend/tests/test_embeddings.py: add tests for vector length and for
  batching 50 chunks.

Why:
- Hard constraint 1: no embedding API calls. Local embedding also removes
  the network wait during ingestion.

How verified:
- pytest backend/tests -q: 11 passed.
- ruff check backend/: 84 errors (baseline 84, unchanged).
- npm --prefix frontend run build: built.
- python -c "import backend.main": exit 0.
- psutil RSS after loading the model: 212 MB.

Notes:
- GOOGLE_AI_STUDIO_KEY is still read by retriever.py; removed in C4.3.
```

It names one change, says why, and every claim under `How verified` can be
re-run. (The example is illustrative; its numbers are not real results.)

## Bad examples

| Header | What is wrong |
|---|---|
| `update files` | No type, scope or subject; says nothing about the change |
| `fix stuff` | Does not name the bug or the fix; cannot be tied to a `DEBUG_LOG.md` entry |
| `WIP` | Not a working change; unfinished work stays uncommitted |
| `big refactor` | Too large to review or revert; split into subchunks |
| `final` | Describes the author's mood, not the code |

Also wrong: a correct header with no `Chunk:` line, a `How verified` section
that lists commands nobody ran, and one commit that covers two subchunks.

## After committing

```bash
git log -1 --stat
git status --short
```

Confirm the commit holds only the files you staged and the tree is clean
apart from files that were deliberately left out. Do not amend a commit that
has been pushed; add a new one.
