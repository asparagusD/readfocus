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

## Local models and dependencies

One row per model or heavy dependency (the memory rule in the
`free-intelligence` skill). RSS is measured with psutil in a fresh process.

| Date | Subchunk | What was added | RSS before | RSS after | Delta | Backend RSS after startup |
|---|---|---|---|---|---|---|
| 2026-11-10 | C4.1 | `fastembed` 0.9.1 with `sentence-transformers/all-MiniLM-L6-v2` (ONNX, 384 dimensions, 86 MB on disk), loaded | 19 MB (Windows), 15 MB (Linux container) | 180 MB (Windows), 213 MB (Linux container, 0.1 CPU) | 161 MB, 198 MB | Windows: 135 MB with `backend.main` imported, 264 MB once the model is loaded. Unchanged at startup, because the model loads on first use. Not measured on Linux |
| 2026-11-10 | C4.4 | `yake` 0.7.3 (brings `networkx`, `jellyfish`, `segtok`, `regex`, `tabulate`, `click`), imported | 16.7 MB (Windows) | 47.9 MB; 48.6 MB after one 600-word extraction | 31 MB, of which `numpy` is already paid for by the embedder | Unchanged: nothing the app imports at startup uses `backend/nlp/concepts.py` yet. A process with `backend.nlp.concepts` and `book_ingestor` imported is 137 MB, and 279 MB after the first extraction with embeddings (model loaded) |
| 2026-11-10 | C4.4 | `rapidfuzz` 3.14.6, imported | 16.9 MB (Windows) | 19.0 MB | 2 MB | as above |

Concept extraction time per chunk, Windows, `sample.pdf` chunks of 507, 740
and 814 words, model already loaded: 72, 71 and 142 ms with the embedding
merge; 24, 30 and 37 ms without it. Not measured in the throttled
container.

### C6.2: answer grader (2026-11-10)

No new dependency. `backend/agents/evaluation/grader.py` imports
`rapidfuzz`, `numpy` and `backend/nlp/concepts.py` (which imports `yake`):
RSS in a fresh process 18.9 MB before the import, 59.5 MB after, all of it
packages the backend already loads. The embedding model is the one
ingestion uses and is not loaded by the import.

Agreement with the 34 labelled answers in
`backend/tests/fixtures/answers.json`, real model, Windows, one-off script
(not committed); a grade agrees when it is within 0.25 of `human_score`:

| Constants | Agree | Share |
|---|---|---|
| As first written (`GRADE_COSINE_FLOOR` 0.2, `GRADE_COSINE_FULL` 0.75) | 25 of 34 | 73.5% |
| Committed (floor 0.1, tuned on these same cases) | 26 of 34 | 76.5% |
| Range over floors 0.0 to 0.3 and full values 0.65 to 0.85 | 24 to 27 | 70.6% to 79.4% |

Target 75%. The committed figure passes it by one case, on the cases it was
tuned on, with scores given by one labeller: read it as "about three in
four", not as a pass.

| Category | Agree | Notes |
|---|---|---|
| correct | 5 of 5 | |
| paraphrase | 1 of 5 | scored 0.44 to 0.79 against 0.90 to 0.95: literal key-term coverage is 0 to 0.4 for a paraphrase; the misspelt cloze ("gutenburg", ratio 88.9) gets 0.5 at low confidence |
| partial | 5 of 5 | |
| wrong | 1 of 5 | the four on-topic wrong answers score 0.53 to 0.91; two are at **high** confidence (0.86 and 0.91): they reverse the evidence in its own words |
| off-topic | 5 of 5 | 0.00 to 0.04 |
| empty | 4 of 4 | |
| copy of the question | 5 of 5 | |

Confidence over the 34: 19 high, 10 medium, 5 low. Since C6.2b free text
is capped at medium: 8 high (closed questions and empty answers), 21
medium, 5 low, and no high-confidence grade disagrees with its human
score. Scores and agreement are unchanged (26 of 34). Time: 213 ms to grade
all 34 with the model warm (about 6 ms per answer; 33 distinct texts
embedded in one call).

### C5.5: session tests from the question bank (2026-11-10)

Windows, backend started with `uvicorn backend.main:app` against the dev
project, `sample.pdf` uploaded as dev test user A, then 8 sessions in a
row (`POST /sessions/start`, wait for the background assembly,
`POST /sessions/{id}/finish-reading`, `GET /sessions/{id}`). Client-side
wall time per request, authentication included:

| Step | C3.5 baseline | C5.5 |
|---|---|---|
| `POST /sessions/{id}/finish-reading` | 1.2 to 1.8 s, on LLM fallbacks ("not measurable") | p50 187 ms, max 197 ms |
| `GET /sessions/{id}` | not recorded | p50 184 ms |
| `POST /sessions/start` | as above | p50 1,090 ms (the planner is unchanged) |
| Test stored after start (background) | n/a | 0.4 s |

Each test had 5 questions. `finish-reading` is one Supabase round trip
after the token check. With the bank rows of the book deleted first, the
test was stored 1.0 s after start (one chunk generated on demand) and
`finish-reading` took 248 ms. An earlier run of 6 sessions on the same code
path had one request at 274 ms. Not measured: Render; a session of several
chunks; `finish-reading` arriving before the background assembly is done.

### C5.4: question bank generated during ingestion (2026-11-10)

No new dependency; `yake` and `rapidfuzz` are now imported at startup
through `book_ingestor`. Windows, backend started with
`uvicorn backend.main:app`, one upload of `sample.pdf` (7 chunks) as dev
test user A through `POST /books/upload`, three runs:

| Measure | C4.6 (embeddings only) | C5.4 (embeddings and questions) |
|---|---|---|
| upload -> status ready | 3.81 s | 3.45, 2.93, 3.65 s |
| upload -> all 7 chunks stored | 3.92 s | about 6 to 7 s (polled) |
| upload -> question bank complete | n/a | 7.68, 7.05, 7.79 s |
| Server RSS | 120 MB before, 306 MB peak | 143 MB idle, 346 to 347 MB peak during ingestion |

Question generation for the 7 chunks, run again in the same process with
the model loaded: 4.2 s, about 0.6 s per chunk, nearly all of it embedding
(sentences, concept labels, prompts). Result: 55 rows, 6 to 11 per body
chunk; 43 factual, 6 inference, 6 summary; average quality 0.83.

The peak is 47 MB over the 300 MB line set at Gate G2, on Windows. Not
measured: Linux or Render, where C4.1 puts a short text at about 0.06 s, so
a chunk's 70 or so sentences and prompts come to roughly 4 s; a long book.

### C4.6: ingestion on local embeddings (2026-11-10)

Windows, backend started with `uvicorn backend.main:app` and
`GOOGLE_AI_STUDIO_KEY` empty, one upload of `sample.pdf` (3.6 MB, 7 chunks)
as dev test user A through `POST /books/upload`, one run:

| Measure | Before (C3.5 baseline, Google AI Studio) | After (local model) |
|---|---|---|
| `POST /books/upload` | 1.72 s p50 | 2.57 s |
| upload -> status ready | 5.07 s p50 | 3.81 s |
| upload -> all 7 chunks stored | not recorded | 3.92 s |
| Server RSS | 142 MB idle | 120 MB before the upload, 306 MB peak during ingestion, 303 MB after |

The first upload after a start also loads the model (about 0.7 s on this
machine). Not measured: Render, where C4.1 puts embedding at about 0.6 s
per chunk; a long book; two uploads at once.

Backfill of the dev database with `python
scripts/backfill_local_embeddings.py`: 622 chunks in 106.7 s (5.8 per
second, one update per chunk), after a `--limit 20` run of 4.1 s. A second
full run embedded 0 chunks in 0.1 s. All 642 chunks now have
`embedding_local`.

### C4.1: embedding model, Gate G2 (2026-11-10)

Gate G2 thresholds: RSS after load above 300 MB, or a throttled 32-text
batch above 5 s. The first candidate, `BAAI/bge-small-en-v1.5`, was stopped
at the gate; the user chose `sentence-transformers/all-MiniLM-L6-v2`, which
is what `backend/nlp/embedder.py` loads. Both sets of numbers are kept.

#### Committed model: all-MiniLM-L6-v2

Same commands and settings as in the next section (one thread, four texts
per model call). The model truncates at 256 tokens, so a 600-word chunk
costs the same as a 300-word one and is represented by its opening.

| Measure | Windows, no limit (3 runs) | Linux container, no limit | Linux container, 0.1 CPU and 512 MB |
|---|---|---|---|
| Model load, files on disk | 0.67 s | 0.85 s | 4.80 s |
| RSS after load | 179 to 180 MB | 209 MB | 213 MB |
| 32 short texts, median | 0.18 s | 0.18 s | **1.80 s** (max 1.80 s, 3 runs) |
| RSS after short batches | 184 MB | 211 MB | 215 MB |
| 32 chunk texts, median | 1.77 to 1.79 s | 1.83 s | **18.3 s** (max 18.8 s, 3 runs) |
| RSS after chunk batches | 240 to 242 MB | 264 MB | 267 MB |

| Check | Result | Verdict |
|---|---|---|
| RSS after load, embedder alone | 180 MB Windows, 213 MB Linux | under 300 MB |
| RSS after load, whole backend | 264 MB Windows; Linux not measured | under on Windows |
| Throttled batch of 32 short texts | 1.80 s | under 5 s |
| Throttled batch of 32 chunk texts | 18.3 s, 267 MB | over 5 s; accepted by the user with this model. About 0.6 s per chunk, so ingestion embeds in the background |

#### First candidate: bge-small-en-v1.5 (stopped at the gate)

Commands, from the repo root. Windows, virtualenv active, model already in
`.cache/fastembed`:

```bash
python scripts/dev/measure_embedder.py
```

Linux container with Render-like limits (`readfocus-g2` is
`python:3.11-slim` plus `fastembed==0.9.1 numpy==2.4.6 psutil==7.2.2`; the
repo is mounted read-only and the model is in a mounted cache):

```bash
docker run --rm --cpus=0.1 --memory=512m -v <repo>:/app:ro -v <cache>:/cache -e FASTEMBED_CACHE=/cache -e HF_HUB_OFFLINE=1 readfocus-g2 python scripts/dev/measure_embedder.py --runs 3 --words 25
```

Settings: one ONNX Runtime thread, four texts per model call.
"Short" texts are 25 words (a question or an answer); "chunk" texts are 600
words, the size ingestion stores, which the model truncates to 512 tokens.
Docker Desktop 29.9.2 on the machine above, 12 logical CPUs.

| Measure | Windows, no limit | Linux container, no limit | Linux container, 0.1 CPU and 512 MB |
|---|---|---|---|
| Model load, files on disk | 0.76 to 0.79 s (3 runs) | 1.06 s | 5.80 s |
| RSS after load | 198 to 199 MB | 263 MB | 263 MB |
| 32 short texts, median | 0.41 to 0.43 s | not run with these settings | **4.00 s** (max 4.00 s, 3 runs) |
| RSS after short batches | 206 MB | | 266 MB |
| 32 chunk texts, median | 9.6 to 10.0 s | not run with these settings | **98.1 s** (3 runs) |
| RSS after chunk batches | 334 MB | | 365 MB |

First load with a download (64 MB from Hugging Face, no key): 11.8 s on
Windows, 11.5 s in the container.

What the defaults were chosen from (32 texts, median):

| Setting | Short texts | Chunk texts | RSS after chunk texts |
|---|---|---|---|
| Windows, 12 threads, 32 per call (fastembed-style defaults) | 0.10 s | 5.5 s | 1,247 MB |
| Windows, 12 threads, 8 per call | | 5.2 s | 463 MB |
| Windows, 12 threads, 4 per call | | 4.6 s | 335 MB |
| Windows, 12 threads, 1 per call | | 3.6 s | 233 MB |
| Windows, 1 thread, 4 per call | 0.43 s | 10.6 s | 331 MB |
| Container 0.1 CPU, default threads (12), 32 per call | 39.6 s | killed by the 512 MB limit after 14 s (exit 137) | |
| Container 0.1 CPU, 1 thread, 32 per call | 4.10 s | | |

So: 32 chunk-sized texts in one model call do not fit in 512 MB, and on a
0.1-CPU container the runtime's default of one thread per core is ten
times slower than one thread.

Against the gate:

| Check | Result | Verdict |
|---|---|---|
| RSS after load, embedder alone | 199 MB Windows, 263 MB Linux | under 300 MB |
| RSS after load, whole backend | 283 MB Windows; Linux not measured, and the embedder alone is 64 MB heavier there | under on Windows, likely over on Linux |
| Throttled batch of 32 short texts | 4.00 s | under 5 s, by a small margin |
| Throttled batch of 32 chunk texts | 98.1 s, 365 MB | over 5 s, about 20 times |

Probe of the options before the choice, Windows, 1 thread, 4 per call, 32
texts, one process per model:

| Model | RSS after load | 25 words | 150 words | 300 words | 600 words | RSS after 600 words |
|---|---|---|---|---|---|---|
| `BAAI/bge-small-en-v1.5` (512-token window) | 199 MB | 0.43 s | 2.52 s | 5.12 s | 9.93 s | 369 MB |
| `sentence-transformers/all-MiniLM-L6-v2` (256-token window, also 384 dimensions) | 180 MB | 0.20 s | 1.09 s | 1.92 s | 1.92 s | 246 MB |

Not measured: Render itself; the whole backend in a Linux container;
retrieval quality of either model; concurrent requests during a batch.

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
