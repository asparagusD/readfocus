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
| 2026-11-11 | C8.8 | **Removed**: `langchain`, `langchain-community`, `langchain-groq`, `groq`, `langchain-google-genai`, `tenacity` from `requirements.txt` (`langgraph` 1.2.20 and its `langchain-core` 1.7.6 kept) | 132.4 MB with `backend.main` and the LangGraph workflow imported; 327.0 MB with the embedding model loaded and 8 chunks embedded (Windows, median of 3) | 132.0 MB; 327.0 MB (same stages, the removed packages made unimportable) | 0 MB at run time: no app code had imported them since C8.4b | 134.0 MB idle, 2 processes, before and after (`scripts/dev/measure_rss.py`, 3 runs each) |
| 2026-11-11 | C9.3 | No new dependency: the embedding model (C4.1) is now **loaded at startup** on a background thread (`EMBED_PRELOAD`, default on), not on first use | Windows: 136 MB idle (3 runs) | Windows: 266 to 267 MB idle, ready 2.6 to 3.7 s after process start (3 runs). Container at 0.1 CPU and 512 MB: 110 to 126 MB idle before, 272 to 275 MB after, ready 29.2 to 29.9 s after start (download included) | about +130 MB (Windows), about +150 MB (container) | The idle server now holds the model: 267 MB Windows, 275 MB in the container, against 512 MB on Render Free. Peak during ingestion in the container 328 to 335 MB (316 to 350 MB in C9.2) |

Gate G3 (C8.G), 2026-11-11: after one full journey on the dev project
(upload, start, finish-reading, submit, results, dashboard) with no AI
provider key in the server's environment, the uvicorn server process held
336.4 MB RSS with the embedding model loaded (plus 4.4 MB for the Windows
venv launcher process that started it). Same order as the 327 MB measured
in one process above, with the web server, LangGraph runs and Supabase
client on top.

C8.8 install size, fresh Python 3.11.9 venvs on Windows (`pip install -r
requirements.txt`): 123 packages and 363.3 MB of site-packages with the
C8.7 requirements, 106 packages and 296.4 MB with C8.8's: 17 packages and
67 MB fewer to install and ship in the Docker image. `pip check` is clean
and `import backend.main` works with no provider key set. Not measured in
the Linux container.

Concept extraction time per chunk, Windows, `sample.pdf` chunks of 507, 740
and 814 words, model already loaded: 72, 71 and 142 ms with the embedding
merge; 24, 30 and 37 ms without it. Not measured in the throttled
container.

### C9.0: ingestion and cold start before C9 (2026-11-11)

The "before" for C9 (speed and durability), at `5e5fcfb`: ingestion is
still a FastAPI background task, the model is downloaded and loaded on
first use. Each run starts a fresh server (`--cold`), uploads the book as
dev test user A, polls once a second (twice in the container), and deletes
the book afterwards. Books:

- `sample.pdf`: 3.6 MB journal paper, 7 chunks, 55 bank questions.
- `pride-and-prejudice.epub`: Project Gutenberg ebook 1342 (public
  domain, 609 KB, `https://www.gutenberg.org/ebooks/1342.epub.noimages`),
  kept in the git-ignored `.cache/bench/`. 204 chunks, 130,536 words,
  1,718 bank questions. Extraction 0.29 s and chunking 0.008 s in process.

"Done" is the last change to the book's chunk, embedding and question
counts once every chunk is stored and embedded and nothing has moved for
`--quiet` seconds (there is no done signal before C9). "Chunk 0 questions"
is the first moment the bank has a question for chunk 0, which the first
session reads. The tables were pasted from the script's output.

Windows, the machine above:

```bash
python scripts/bench.py --ingest sample.pdf .cache/bench/pride-and-prejudice.epub --flow-runs 3 --cold --quiet 30
```

<!-- bench:c9-before-windows:start -->
| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `POST /books/upload (sample.pdf)` | 3 | 1.58 s | 2.33 s | |
| `upload -> ready (sample.pdf)` | 3 | 2.33 s | 2.58 s | |
| `upload -> chunk 0 questions (sample.pdf)` | 3 | 4.67 s | 5.05 s | |
| `upload -> done (sample.pdf)` | 3 | 4.67 s | 5.05 s | |
| `POST /books/upload (pride-and-prejudice.epub)` | 3 | 1.09 s | 1.10 s | |
| `upload -> ready (pride-and-prejudice.epub)` | 3 | 2.36 s | 2.38 s | |
| `upload -> chunk 0 questions (pride-and-prejudice.epub)` | 3 | 4.70 s | 4.73 s | |
| `upload -> done (pride-and-prejudice.epub)` | 3 | 138.34 s | 148.44 s | |
<!-- bench:c9-before-windows:end -->

Process start to `/health`: 2.60 to 2.63 s. Peak server RSS (sampled each
poll): 320 to 321 MB for `sample.pdf`, 349 to 352 MB for the long book.

Linux container like Render Free: the repo `Dockerfile` built as
`readfocus-c9-before` (728 MB image), `--cpus=0.1 --memory=512m`, only the
Supabase variables passed and no model cache, so every start downloads the
model from Hugging Face as Render does today. `sample.pdf` only: at 0.1 CPU
the long book would take close to an hour per run.

```bash
python scripts/bench.py --base-url http://127.0.0.1:8001 --ingest sample.pdf --flow-runs 3 --cold --quiet 120 --poll 2 --docker rf-c9 --server-cmd "docker run --rm --name rf-c9 --cpus=0.1 --memory=512m -p 8001:8000 --env-file <supabase-only env file> readfocus-c9-before" --stop-cmd "docker stop rf-c9"
```

<!-- bench:c9-before-container:start -->
| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `POST /books/upload (sample.pdf)` | 3 | 1.84 s | 2.12 s | |
| `upload -> ready (sample.pdf)` | 3 | 26.29 s | 27.87 s | |
| `upload -> chunk 0 questions (sample.pdf)` | 3 | 53.64 s | 55.08 s | |
| `upload -> done (sample.pdf)` | 3 | 61.70 s | 63.39 s | |
<!-- bench:c9-before-container:end -->

Process start to `/health`: 12.40, 13.21 and 14.41 s. The model download
took about 12 s of each run (the server log's "Fetching 5 files" bar).
Peak container memory (`docker stats`, cgroup usage, not RSS): 319 to
326 MB.

What this says for C9, read from these numbers only:

- On Render-like CPU the reader waits about 26 s for `ready` and about
  54 s before the first session's questions exist; on Windows 2.3 and
  4.7 s. The download, the model load and the first batch's five
  embeddings all sit before `ready`.
- Extraction is not a cost worth streaming (0.29 s for 204 chunks), so
  C9.2 drops streaming extraction.
- A long book keeps the server busy for over two minutes on Windows,
  which on Render is the window a restart or spin-down can cut.

Not measured: Render itself; the long book in the container; requests
from a reader during ingestion; a restart mid-ingestion (C9.1b and C9.5).

### C9.5: After C9, and Before/After (2026-11-11)

#### After

Everything rerun at `3294058` (C9.1 to C9.4), same commands, books and
settings as the C9 "before" runs. Ingestion: three cold runs per book on
Windows and three of `sample.pdf` in the 0.1-CPU, 512 MB container
(image rebuilt as `readfocus-c9-5`). API:
`python scripts/bench.py --runs 20 --flow-runs 5` against the backend
from `.claude/launch.json`. Idle memory: `python scripts/dev/measure_rss.py`
three times. Every benchmark book was deleted by the script; no container
was left.

<!-- bench:c9-after-windows:start -->
| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `POST /books/upload (sample.pdf)` | 3 | 2.01 s | 2.29 s | |
| `upload -> ready (sample.pdf)` | 3 | 4.81 s | 4.90 s | |
| `upload -> chunk 0 questions (sample.pdf)` | 3 | 4.81 s | 4.90 s | |
| `upload -> done (sample.pdf)` | 3 | 4.81 s | 4.90 s | |
| `POST /books/upload (pride-and-prejudice.epub)` | 3 | 1.35 s | 1.39 s | |
| `upload -> ready (pride-and-prejudice.epub)` | 3 | 4.86 s | 4.86 s | |
| `upload -> chunk 0 questions (pride-and-prejudice.epub)` | 3 | 2.39 s | 2.42 s | |
| `upload -> done (pride-and-prejudice.epub)` | 3 | 132.68 s | 141.53 s | |
<!-- bench:c9-after-windows:end -->

Windows: process start -> `/health` 2.59 to 3.10 s; peak RSS 322 MB and
349 to 351 MB; idle RSS 266.6 to 266.9 MB (2 processes).

<!-- bench:c9-after-container:start -->
| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `POST /books/upload (sample.pdf)` | 3 | 2.15 s | 5.98 s | |
| `upload -> ready (sample.pdf)` | 3 | 53.29 s | 59.55 s | |
| `upload -> chunk 0 questions (sample.pdf)` | 3 | 51.49 s | 59.37 s | |
| `upload -> done (sample.pdf)` | 3 | 57.87 s | 64.75 s | |
<!-- bench:c9-after-container:end -->

Container: process start -> `/health` 13.21 to 16.14 s; peak memory 330,
332 and 391 MB (`docker stats`).

<!-- bench:c9-after-api:start -->
| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `GET /health` | 20 | 0.8 ms | 2 ms | |
| `GET /books` | 20 | 185 ms | 232 ms | |
| `POST /books/upload` | 5 | 1.70 s | 2.32 s | sample.pdf, 3.6 MB |
| `upload -> status ready` | 5 | 4.23 s | 4.35 s | polled every 0.5 s |
| `POST /sessions/start` | 5 | 625 ms | 815 ms | planner |
| `POST /sessions/{id}/finish-reading` | 5 | 679 ms | 709 ms | called right after start |
| `POST /sessions/{id}/submit-answers` | 5 | 1.08 s | 1.09 s | 5 grades, then the optimizer |
| `GET /dashboard` | 20 | 193 ms | 211 ms | |
<!-- bench:c9-after-api:end -->

One reading in the long-book run is not explained: the bench saw chunk
0's questions 2.4 s after upload and `ready` 2.5 s later, although since
C9.2 the code marks the book ready right after the first batch's
questions are stored (`sample.pdf` shows both at the same moment, and in
C9.2 the long book did too). Not investigated.

#### Before/After

"Before" for ingestion and cold start is C9.0 (`5e5fcfb`, the start of
the chunk); for the API it is the C9.4 "before" (`83b4f1f`), since C9.0
did not time the API, and C9.1 to C9.3 did not change those endpoints'
reads. p50 unless stated. The verdict says what the numbers support, not
what the code was meant to do.

| Measure | Before | After | Verdict |
|---|---|---|---|
| `GET /dashboard` | 455 ms (p95 490) | 193 ms (p95 211) | **Faster**: measured twice (194 ms in C9.4, 193 ms here), outside the before spread |
| `POST /sessions/start` | 590 ms | 625 ms | No clear change: 503 ms in C9.4, not reproduced here |
| `GET /books` | 189 ms | 185 ms | No change |
| `POST /sessions/{id}/finish-reading` | 750 ms | 679 ms | No change claimed: code not changed, noise |
| `POST /sessions/{id}/submit-answers` | 1.07 s | 1.08 s | No change |
| Windows `upload -> ready`, `sample.pdf` | 2.33 s | 4.81 s | **Slower** (C9.2: ready now waits for the first batch's questions) |
| Windows `upload -> chunk 0 questions`, `sample.pdf` | 4.67 s | 4.81 s | No change |
| Windows `upload -> ready`, 204-chunk EPUB | 2.36 s | 4.86 s | **Slower** (C9.2) |
| Windows `upload -> chunk 0 questions`, EPUB | 4.70 s | 2.39 s | Lower, but inconsistent with `ready` (above); not claimed |
| Windows `upload -> done`, EPUB | 138.34 s (p95 148.44) | 132.68 s (p95 141.53) | No clear change |
| Container `upload -> ready` | 26.29 s | 53.29 s | **Slower** (C9.2) |
| Container `upload -> chunk 0 questions` | 53.64 s (p95 55.08) | 51.49 s (p95 59.37) | No clear change |
| Container `upload -> done` | 61.70 s (p95 63.39) | 57.87 s (p95 64.75) | No clear change |
| Container process start -> `/health` | 12.4 to 14.4 s | 13.2 to 16.1 s | No change |
| Container process start -> model ready | first use | 29.2 to 29.9 s (C9.3) | New: the load happens at boot, not in a request |
| Idle RSS, Windows | 136 MB (C9.3 before; 134 MB in C8.8) | 266.6 to 266.9 MB | **Heavier**: about +130 MB, the preloaded model (C9.3) |
| Idle memory, container | 110 to 126 MB | 272 to 275 MB (C9.3) | **Heavier**: about +150 MB |
| Peak memory during ingestion, Windows | 321 MB; 349 to 352 MB | 322 MB; 349 to 351 MB | No change |
| Peak memory during ingestion, container | 319 to 326 MB | 330, 332, 391 MB | Higher in one run of three; not separated from noise |
| Ingestion after a hard kill mid-book | book stuck in `processing`, no retry (issue 20) | resumed from cursor 53 of 204 by the sweep, 0 duplicate chunks or questions, counts equal to an uninterrupted run (C9.1b) | **Durable** (measured once on dev) |

Measured improvements from C9: the dashboard (about 260 ms faster), and
ingestion that survives a restart. Everything else is unchanged within
noise, slower by choice (`ready` waits for the first questions), or
heavier (the preloaded model). Not measured: Render itself, a cold start
followed by a grade, the indexes on tables larger than dev's, more than
three runs per ingestion measure.

### C9.4: fewer and lighter reads, and indexes (2026-11-11)

`python scripts/bench.py --runs 20 --flow-runs 5` against the backend on
this machine (`.claude/launch.json`, model preloaded) and the dev project,
as test user A; before at `83b4f1f`, after with the C9.4 code and
migration 011 applied. Books deleted by the script.

| Step | Runs | Before p50 (p95) | After p50 (p95) |
|---|---|---|---|
| `GET /dashboard` | 20 | 455 ms (490 ms) | 194 ms (351 ms) |
| `POST /sessions/start` | 5 | 590 ms (918 ms) | 503 ms (620 ms) |
| `GET /books` | 20 | 189 ms (210 ms) | 183 ms (219 ms) |
| `POST /sessions/{id}/finish-reading` | 5 | 750 ms (765 ms) | 575 ms (655 ms) |
| `POST /sessions/{id}/submit-answers` | 5 | 1.07 s (1.09 s) | 1.05 s (1.09 s) |

What changed: `GET /dashboard` ran four reads one after another and read
the `answers` jsonb of every test result; now its reads run at once and
answers are read for a page of the newest results (5 at a time) until
three feedback quotes are found. `POST /sessions/start` reads the chunk
text and inserts the session at the same time. The dashboard gain (about
260 ms, a little more than two round trips at about 100 ms) and the start
gain (about 90 ms, one round trip) match those changes.
`finish-reading` and `submit-answers` were not changed: their difference
is run-to-run noise, and `finish-reading`'s 175 ms shows how large it can
be over five runs.

The five indexes of migration 011 cannot be told apart from noise here:
the dev tables are small (8 books, under 100 sessions), where Postgres
scans the table anyway. `npx supabase inspect db index-stats --linked`
lists all five right after the migration (16 kB each, not yet used).
They are for larger tables; not measured on one.

### C9.3: embedding model preloaded at startup (2026-11-11)

The lifespan starts a daemon thread that loads the model and embeds one
text; `/health` returns `model_ready` and never waits for it;
`submit-answers` and `evaluate-single` wait up to `EMBED_WAIT_SECONDS`
(20) and answer 503 if the model is still not loaded. "Before" is
`c65ba2b` (C9.2): lazy load on first use. Startup times come from a
one-off scratchpad script that starts the server, polls `/health` every
0.25 s and reads memory 3 s after `model_ready` (psutil RSS on Windows,
`docker stats` in the container); 3 runs each.

| Measure | Before | After |
|---|---|---|
| Windows: process start -> `/health` | 2.60 to 2.70 s | 2.59 to 3.71 s |
| Windows: first `/health` response time | 23 to 35 ms | 22 to 28 ms, one run 1,045 ms |
| Windows: process start -> model ready | on first use | 2.60 to 3.72 s |
| Windows: idle RSS | 136 MB | 266 to 267 MB |
| Container: process start -> `/health` | 12.84 to 14.80 s | 13.08 to 13.24 s |
| Container: first `/health` response time | 32 to 105 ms | 281 to 470 ms |
| Container: process start -> model ready | on first use | 29.20 to 29.87 s |
| Container: idle memory | 110 to 126 MB | 272 to 275 MB |

Cold ingestion of `sample.pdf` in the container (`bench.py --ingest
--cold`, same command as C9.0 with image `readfocus-c9-3`; the bench
uploads as soon as `/health` answers, so the model load overlaps the first
batch):

| Step | C9.2 p50 (p95) | C9.3 p50 (p95) |
|---|---|---|
| `upload -> ready` | 56.55 s (58.26 s) | 50.38 s (63.69 s) |
| `upload -> chunk 0 questions` | 53.70 s (57.97 s) | 50.38 s (59.52 s) |
| `upload -> done` | 63.74 s (64.98 s) | 55.04 s (68.95 s) |

How to read it: the medians are 3 to 9 s lower, but the spreads overlap
with three runs each, so this is not a clear speed-up for ingestion. What
the preload does change is where the model load is paid: before, the
first request that graded or ingested after a cold start loaded it (about
0.7 s on Windows, 12 s download and about 5 s load at 0.1 CPU); now it is
paid from boot, and a request that arrives after `model_ready` does not
pay it. A request that arrives earlier waits up to 20 s, then gets a 503.
Not measured: the first grade after a cold start (a session needs a
ready book first, which already loads the model in both versions). The
cost is memory: the idle server is about 130 to 150 MB larger. On 0.1 CPU
the load also slows the first `/health` answers to 0.3 to 0.5 s.
A first attempt at the C9.3 ingestion runs stopped after one run without
a table; the cause was hidden by an output filter (most likely the
previous container's name still in use) and the runs were repeated.

### C9.2: ready after the first batch's questions (2026-11-11)

Same commands, books and settings as C9.0 (three cold runs each), at the
C9.2 working tree: ingestion is a `processing_jobs` job in batches of 5
then 16 (C9.1), and the book is marked ready only once the first five
chunks **and their questions and concepts** are stored (before C9.2 it was
marked ready as soon as the chunks were stored). Container image rebuilt
as `readfocus-c9-2`.

Windows (p50 of 3):

| Step | C9.0 before | C9.2 after |
|---|---|---|
| `upload -> ready (sample.pdf)` | 2.33 s | 4.97 s |
| `upload -> chunk 0 questions (sample.pdf)` | 4.67 s | 4.97 s |
| `upload -> done (sample.pdf)` | 4.67 s | 4.97 s |
| `upload -> ready (pride-and-prejudice.epub)` | 2.36 s | 4.83 s |
| `upload -> chunk 0 questions (pride-and-prejudice.epub)` | 4.70 s | 4.83 s |
| `upload -> done (pride-and-prejudice.epub)` | 138.34 s | 134.54 s |
| Peak server RSS | 320 to 321 MB; 349 to 352 MB | 321 MB; 348 to 351 MB |

Container, 0.1 CPU and 512 MB, `sample.pdf` (p50 of 3):

| Step | C9.0 before | C9.2 after |
|---|---|---|
| Process start -> `/health` | 12.4 to 14.4 s | 13.2 to 15.3 s |
| `upload -> ready` | 26.29 s | **56.55 s** |
| `upload -> chunk 0 questions` | 53.64 s | 53.70 s |
| `upload -> done` | 61.70 s | 63.74 s |
| Peak container memory | 319 to 326 MB | 316 to 350 MB |

What it says: `ready` comes **later**, by the first batch's question
generation (about 2.5 s on Windows, about 30 s at 0.1 CPU), and the first
questions arrive at the same time as before. The change is in what
`ready` means: a reader who starts the first session gets a test from the
bank, instead of `finish-reading` generating one on demand. No speed-up is
claimed. The long book now has 1,760 questions (1,718 in C9.0) because of
the 16-chunk batches (C9.1b). One container run peaked at 350 MB, the
other two at 316 and 320 MB; with three runs that is not separated from
noise.

### C8.6: session lifecycle through the LangGraph workflow (2026-11-11)

Backend on this machine (`uvicorn backend.main:app --port 8000`, from
`.claude/launch.json`) against the dev project, as test user A. No LLM and
no embedding API anywhere in the path.

Before C8.6, at `a01d635` (C8.5): `python scripts/bench.py --runs 3
--flow-runs 5`, which starts a session as soon as the book is ready.

| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `POST /sessions/start` | 4 | 1.04 s | 1.09 s | at least one 500: "Server disconnected" during ingestion (issue 29) |
| `POST /sessions/{id}/finish-reading` | 3 | 1.77 s | 2.55 s | at least one 500, same cause |
| `POST /sessions/{id}/submit-answers` | 3 | 2.13 s | 2.19 s | evaluator, knowledge state, optimizer, planner |

After C8.6: a one-off script (scratchpad, not committed), five flows, each
uploading `sample.pdf`, waiting 15 s after `ready` so background ingestion
is finished (keeping issue 29 out of the numbers), then start, a 3 s pause,
finish-reading, submit, a second start and abandon. Every book was deleted
afterwards. No failure in the 25 requests.

| Step | n | p50 | max | Notes |
|---|---|---|---|---|
| `POST /sessions/start` | 10 | 1,039 ms | 1,149 ms | planner run; decisions saved after the response |
| `POST /sessions/{id}/finish-reading` | 5 | 199 ms | 219 ms | test already assembled in the background |
| `POST /sessions/{id}/submit-answers` | 5 | 1,893 ms | 2,338 ms | **target under 500 ms: missed; about 2.2 times C7.4** |
| `POST /sessions/{id}/abandon` | 5 | 203 ms | 207 ms | the abandon flow runs after the response |

Where the time goes, from the `duration_ms` the nodes store (first flow):
planner 723 ms at start; on submit, evaluator 537 ms, knowledge state
206 ms, optimizer 386 ms and planner 891 ms. The planner makes up to seven
Supabase round trips at about 100 ms each and now runs on the submit path
too (C8.5), which is most of the rise from about 0.9 to 1.0 s in C7.4.
Saving decisions moved no number: it is one insert after the response.

### C8 follow-up: fewer round trips on submit and start (issue 28, 2026-11-11)

`python scripts/bench.py --runs 3 --flow-runs 5 --keep` against the dev
project (start right after ready), per-node times from `agent_decisions`
of the kept sessions, books deleted afterwards. Before: the same runs at
`196191a` (issue 29 fixed, reads still one by one).

| Step | Before p50 | After p50 | After p95 |
|---|---|---|---|
| `POST /sessions/start` | 921 ms | 594 ms | 654 ms |
| `POST /sessions/{id}/submit-answers` | 1.88 s | 1.12 s | 1.27 s |
| submit nodes: evaluator, knowledge state, optimizer, planner | about 490, 185, 360, 455 ms | about 320, 200, 190, 200 ms | |

What changed: the planner reads progress, then chunks, concepts, mastery,
bank difficulty and profile in one parallel round trip; the optimizer reads
progress, sessions and profile at once; the evaluator stores the result
and reads history and progress at once; `submit-answers` claims the session
with an update that returns its row, so it no longer selects it first.
About 10 round trips remain in sequence on submit (auth, claim, evaluator
2, knowledge state 2, optimizer 2, planner 2) at about 100 ms each: the
500 ms target is still missed.

Upload measured 3.28 s p50 in this run against 1.23 s at `196191a`; the
upload path did not change between the two.

### C6.4: answers graded inline (2026-11-10)

Backend on this machine against the dev project, `sample.pdf` uploaded as
test user A, five sessions in a row (one-off script, not committed; the
book was deleted afterwards). The Groq client was pointed at a local stub
that answers 404 at once (`GROQ_API_BASE`), which is what the dev key gets
from Groq (issue 22), so no request left for a banned provider.

| Step | p50 | max | Notes |
|---|---|---|---|
| `POST /sessions/{id}/submit-answers` | 840 ms | 854 ms | **target under 500 ms: missed** |
| `POST /sessions/{id}/evaluate-single` | 502 ms | 514 ms | one free-text answer; inline, was a background task |
| Grading five answers, in process, model warm | 96 ms | 96 ms | `evaluator_agent.grade_answers` |
| One Supabase query from this machine | 101 ms | 105 ms | |

Where `submit-answers` spends its 840 ms: about eight Supabase round trips
in sequence (the auth check, the session read, the `test_results` insert,
two reads for the rolling average, two reads by the optimizer, the session
update) at about 100 ms each, plus the grading. The grader is roughly a
tenth of it. With the Groq client pointed at a closed port instead of the
stub, the optimizer's retries alone took 7.7 s and the endpoint 8.3 s.

No new dependency. The grading model is the one ingestion loads; it is now
also loaded when a session starts (`warm_up`), in the web process.

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
