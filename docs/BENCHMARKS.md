# ReadFocus 2.0 — benchmarks

Measured numbers only. Each entry says what was run, on what, and when, so
it can be repeated. Numbers from this machine are not Render's: use them to
compare before and after, not as absolute limits.

## Machine

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| Python | 3.11.9 (`.venv`) |
| RAM | 31.9 GB |
| psutil | 7.2.2 |

## Backend memory at idle

Command, from the repo root with the virtualenv active:

```bash
python scripts/dev/measure_rss.py
```

It starts `uvicorn backend.main:app` with the real `.env`, waits for
`GET /health` to answer, waits 8 more seconds, then reads the resident set
size (RSS) of the server process and every child with psutil. No request
other than `/health` is made, so no LLM or embedding API is called.

On Windows each `.venv` Python shows up as two processes: a 4 MB launcher
and the real interpreter. Both are counted.

### C3.4: stop spawning the unused MCP subprocess (2026-11-10)

Three runs each. "Before" is commit `dde7af3`; "after" is the C3.4 commit.

| | Run 1 | Run 2 | Run 3 | Processes |
|---|---|---|---|---|
| Before: total RSS | 216.1 MB | 215.7 MB | 216.1 MB | 4 |
| After: total RSS | 142.0 MB | 141.9 MB | 142.0 MB | 2 |

Per process, run 1:

| Process | Before | After |
|---|---|---|
| uvicorn launcher | 4.2 MB | 4.2 MB |
| uvicorn interpreter (`backend.main:app`) | 138.0 MB | 137.7 MB |
| `backend/mcp_server.py` launcher | 4.2 MB | not started |
| `backend/mcp_server.py` interpreter | 69.7 MB | not started |
| **Total** | **216.1 MB** | **142.0 MB** |

Saved: 74 MB, 34% of the idle total. The server process itself is unchanged
at about 138 MB, which is the import cost of FastAPI, Supabase, LangChain
and the provider clients.

Not measured: Linux or Render, where there is no launcher process and the
numbers will differ; memory under load; memory during book ingestion.

## Baseline

API timings before the 2.0 migration, as seen by a client on the same
machine as the backend. Recorded in C3.5 on 2026-11-10 against the code at
`b202cca` plus the C3.5 commit, which changes no application code.

Command, from the repo root with the virtualenv active and the backend
running on port 8000 (`uvicorn backend.main:app --port 8000`, no reload):

```bash
python scripts/bench.py --runs 20 --flow-runs 3 --write
```

The script signs in as dev test user A through Supabase Auth (credentials in
the git-ignored `.env.test`), then times each call with `time.perf_counter`
around the HTTP request. The table between the markers is written by the
script; do not edit it by hand.

<!-- bench:baseline:start -->
| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `GET /health` | 20 | 1 ms | 4 ms | |
| `GET /books` | 20 | 193 ms | 242 ms | |
| `POST /books/upload` | 3 | 1.72 s | 2.24 s | sample.pdf, 3.6 MB |
| `upload -> status ready` | 3 | 5.07 s | 5.10 s | polled every 0.5 s; ready after 5 chunks are embedded |
| `POST /sessions/start` | 3 | 1.24 s | 1.35 s | LLM path not measurable: the LLM call failed, so this is the time of the app's fallback |
| `POST /sessions/{id}/finish-reading` | 3 | 1.69 s | 1.76 s | LLM path not measurable: the LLM call failed, so this is the time of the app's fallback |
| `POST /sessions/{id}/submit-answers` | 3 | 1.21 s | 1.36 s | LLM path not measurable: the LLM call failed, so this is the time of the app's fallback |
| `GET /dashboard` | 20 | 465 ms | 486 ms | |
<!-- bench:baseline:end -->

How to read it:

- **The LLM path is not measurable.** Every Groq call in both runs came back
  `404 model_not_found` for `llama-3.3-70b-versatile` with the key in
  `.env` (21 such lines in the server log for three flows). The app hides
  this: the planner returns its canned plan ("MOCK LLM: ..."), the grader
  scores every answer 10/10 (all three flows scored 50/50 on answers that
  say "I do not remember"), and the optimizer returns "Fallback duration.".
  The three session rows are therefore the time of a failed Groq round trip
  plus the fallback, not the time of real planning, question generation or
  grading. There is no "before" number for LLM quality or latency.
- **Question generation never reaches the LLM.** The test generator's prompt
  fails to format (`Input to ChatPromptTemplate is missing variables
  {'0,1', 'z '}`), twice per flow, before any request is sent, and the
  generic fallback questions are returned.
- **Embeddings are real.** Each upload embedded its chunks through Google AI
  Studio with no retry and no ingestion failure in the log, so
  `upload -> status ready` is a true number for the old path: about 5 s for
  the first five chunks, roughly 1 s per chunk, one call at a time.
- **p95 over 3 runs is close to the maximum.** The flow steps ran 3 times to
  limit calls to the banned providers; treat their p95 as indicative.
- `GET /books` and `GET /dashboard` are dominated by round trips to the
  hosted Supabase project (one query for books, several for the dashboard),
  not by backend work; `GET /health`, which touches nothing, takes 1 ms.

A first run a few minutes earlier, without `--write`, gave the same picture:
`GET /books` 193 / 265 ms, upload 1.25 / 2.16 s, ready 5.20 / 5.23 s, start
1.29 / 1.44 s, finish-reading 1.71 / 1.75 s, submit-answers 1.18 / 1.23 s,
`GET /dashboard` 465 / 520 ms (p50 / p95).

Side effects of a run: three books uploaded to the dev project and deleted
again (sessions and results go with them by cascade), about 24 embedding
calls, and about 21 failed Groq calls. All free tier, $0.

Not measured: the frontend, cold start, Render, concurrent users, and
`evaluate-single`.
