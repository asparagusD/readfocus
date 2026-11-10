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
| [x] C1.7 | this commit | Added `docs/PROGRESS.md` and `docs/DEBUG_LOG.md`. | Hashes and times checked against `git log`; standard checks. | see `git log` | Issue 9 |

Not done in C1: the chunk is not merged into `readfocus-2.0` and nothing is
pushed.

## C2 — repo graph tooling

Builds `tools/repo_graph/`, `make graph` and `docs/repo-graph/` (per the C1.4
prompt). Full title and subchunks to be filled from the promptbook.

| Step | Commit | Change | Verified by | Time | Open issues |
|---|---|---|---|---|---|

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
