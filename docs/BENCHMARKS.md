# ReadFocus 2.0 — benchmarks

Measured numbers only. Each entry says what was run, on what, and when, so
it can be repeated. Numbers from this machine are not Render's: use them to
compare before and after, not as absolute limits.

## Summary at the end of the sprint (C15, 2026-11-12)

The headline numbers, each from the section named; that section has the
command and the conditions. Desktop numbers are this machine's (below);
container numbers are Docker at 0.1 CPU and 512 MB, the Render Free size.

| Measure | Value | Section |
|---|---|---|
| Embedding model | all-MiniLM-L6-v2, ONNX, 384 dims, 86 MB on disk; about 5x faster than bge-small-en-v1.5 on chunk-sized texts | C4.1, Gate G2 |
| Backend idle memory, model loaded | 267 MB desktop; 251-255 MiB in the container | C9.3, C14.1 |
| Peak memory while ingesting `sample.pdf` | 301-308 MiB in the container (512 MB limit) | C14.1 |
| Docker image | 885 MB (model layer 91.3 MB) | C14.1 |
| Container start to `model_ready` | 20.0-21.0 s, no download | C14.1 |
| `sample.pdf` (13 pages) upload to ready | 5.1 s desktop p50; 39.9 s container p50 | C9.5, C14.1 |
| Pride and Prejudice (EPUB) upload to ready / done | 5.3 s / 133.7 s desktop p50 | C9.5 |
| `POST /sessions/start`, local | 625 ms p50, 815 ms p95 | C9.5 |
| `POST /sessions/{id}/submit-answers` (5 grades, then the optimizer) | 1.08 s p50 | C9.5 |
| `GET /dashboard` | 193 ms p50 | C9.5 |
| Word lookup, cached in process / in `term_lookups` | 2.7 ms / 96 ms p50 | C12.6 |
| Hover to word card, cached | 356-366 ms (350 ms of it is the hover intent) | C12.10 |
| Page turns | 75 fps, worst frame 13.7-14.0 ms; 74.3 fps at 4x CPU slowdown | C12.10 |
| Lighthouse, mobile performance | 81-90 across eight pages; accessibility 95-100 | C13 close |
| Grader agreement with 34 labelled answers | 26 of 34 (76.5%) within 0.25; leave-one-out after a 3,060-setting search: 26 | C15.3 |
| Full reading journey in a browser, local stack | 30.0 s end to end | C15 |
| Cross-user isolation, 92 probes | local 30 s, all denied; production 66 s, all denied but issue 17 (fix not deployed) | C15 |

Not measured in the sprint: API latency on Render (no `scripts/bench.py`
run against production), a timed Render cold start after 15 idle minutes,
Render's own memory graph, Lighthouse on the live site, and a long book
ingested in the container or on Render.

### C15: live runs on the real stack (2026-11-12)

The journey (`npm --prefix frontend run test:live`, C15.1) and the
isolation check (`npm --prefix frontend run test:isolation`, C15.2) run
against a real backend and the shared Supabase project as test users, and
delete what they create. Local: backend on this machine
(`uvicorn backend.main:app --port 8000`), frontend on Vite dev. Production:
`readfocus-lake.vercel.app` and `readfocus-api.onrender.com`, which at the
time did not have the C15 fixes. Times are seconds per step, as the spec
prints them; one run each, so no percentiles.

| Journey step | Local (final run) | Production (one run) |
|---|---|---|
| Wait for `/health` `model_ready` | 0.0 | 35.1 (the API had been idle; not a controlled cold start) |
| Sign in | 2.0 | 3.1 |
| Upload `sample.pdf` | 3.1 | 3.3 |
| Upload to ready (shelf toast) | 6.9 | 36.3 |
| Session open | 1.7 | 2.6 |
| Turn pages, position saved | 2.0 | 2.3 |
| Hover to a definition card (real `/lookup`) | 0.5 | 0.8 |
| Test (5 questions) answered | 2.3 | not reached: the closing-page bug, fixed in `73ffa25` |
| Submit to Results | 3.1 | not reached |
| Dashboard with the book's mastery | 1.8 | not reached |
| Next session open | 2.9 | not reached |
| Book removed | 3.1 | not reached (deleted by id afterwards) |
| Hosts the page contacted | the site, the API, the Supabase project | the same three |

| Isolation check | Local | Production |
|---|---|---|
| Probes denied | 92 of 92 | 91 of 92 (issue 17, fixed in `cf5e877`, not deployed) |
| Run time, including A's upload, session and cleanup | 30-31 s | 66 s |
| Rows and PDF left afterwards | none | none |

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

### C20.2: Google's Gen AI SDK for Steve (2026-11-14)

`python -c "import psutil, os; import backend.main; ...; print(rss)"`, three
runs each, Windows, `.venv` Python 3.11, no server started:

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `import backend.main` | 130.4 MB | 130.4 MB | 130.8 MB |
| `import backend.main` + `from google import genai` + `types`, `errors` | 148.6 MB | 148.4 MB | 148.5 MB |

`google-genai` 2.34.0 costs about 18 MB when loaded. `backend/steve/provider.py`
imports it on the first Steve call only, so the idle server is unchanged
until someone asks Steve something. No new transitive package: `.venv` already
held `google-genai` 3.0.0 (C16.4's throwaway check), which the 2.34.0 pin
replaced; `pip freeze` before and after differ only in that line, and
`pip check` reports no broken requirements.

Not measured: Linux or Render; memory during a streamed answer.

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
| 2026-11-13 | C18.2 | `pdfplumber` 0.11.10 (brings `pdfminer.six` 20260107, `pypdfium2` 5.14.0; `Pillow` already installed), imported through `backend.regions.extract` | 18.4 MB (Windows) | 32.9 MB; whole-book peaks below | 14.5 MB to import; reading a book in 20-page batches peaks at 136 MB (52 MB of it the file) | Unchanged in C18.2a: nothing the app imports at startup uses it yet (the regions job in C18.2b does; measured there) |

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

### C18.2: pdfplumber on the technical test shelf (2026-11-13)

`pdfplumber` 0.11.10 with `pdfminer.six` 20260107 and `pypdfium2` 5.14.0,
read through `backend/regions/extract.py`. Command, Windows, fresh
process, shelf from `scripts/fetch_test_shelf.py`:
`python scripts/dev/measure_regions.py --all --batch 20` (and `--batch 0`,
`--batch 50`, `--pages 40`). RSS includes the book's bytes held in memory
(52 MB for Calculus).

| Book | Pages | s/page | Peak RSS, file opened once | Peak RSS, reopened every 20 pages |
|---|---|---|---|---|
| Calculus Volume 1 | 769 | 0.227 (once), 0.244 (per 20) | 274.4 MB | 135.5 MB (143.1 MB per 50) |
| Interactive Linear Algebra | 455 | 0.095, 0.121 | 279.7 MB | 126.3 MB |
| Lessons in Electric Circuits I | 557 | 0.147, 0.153 | 80.8 MB | 72.3 MB |
| SICP | 883 | 0.101, 0.128 | 80.7 MB | 71.3 MB |

Import alone: 18.4 MB before, 32.9 MB after (+14.5 MB). Opened once,
pdfminer keeps every parsed object of the document, so a whole book costs
up to 280 MB even with each page closed: on top of the 267 to 275 MB idle
server (C9.3) that passes Render Free's 512 MB. Reopening the file every
20 pages keeps the peak near 136 MB for about 7% more time, so the
regions job (C18.2b) works in batches of 20 pages with the file reopened
for each. Sampling 40 pages per book with a reopen per page costs 0.28 to
0.64 s/page: opening is the expensive part.

Linux, the `readfocus-api` image at `--cpus=0.1 --memory=512m` (Render
Free's share), pdfplumber installed into `/tmp` at run time, shelf
mounted read-only: import 17.9 MB to 38.6 MB (+20.8 MB). 15 pages per book
with a reopen per page: Calculus 4.67 s/page (peak 137.3 MB), Linear
Algebra 5.03 (88.6 MB), Circuits 2.41 (90.9 MB), SICP 5.28 (90.5 MB).
Every SICP page in 20-page batches: **1.055 s/page**, 883 pages in about
15.5 minutes, peak 67.5 MB. By the Windows ratio Calculus would take about
2 s/page, about 26 minutes for the book: the regions job runs after a
book is readable and must never hold up ingestion. Not measured in the
container: the other three books page by page, the backend server with
a job running (C18.2b).

C18.2b, the regions job itself (`backend/services/region_job.py`, 20-page
batches), Windows, one process with `backend.main` imported
(`INGEST_SWEEP=0`; embedding model not loaded), the in-memory database
standing in for Supabase with each batch's rows dropped once written (a
server sends them away), the book's bytes held as the job holds them:

| Book | Pages | Regions | s/page | RSS after imports | Peak | After the job |
|---|---|---|---|---|---|---|
| Calculus Volume 1 | 769 | 15,082 | 0.253 | 128.4 MB | 248.8 MB | 231.0 MB |
| SICP | 883 | 4,291 | 0.132 | 128.4 MB | 176.5 MB | 175.0 MB |

So a job adds up to about 120 MB on the largest shelf book (52 MB of it
the file, which ingestion hands over rather than copying). On the 267 to
275 MB idle server with the embedding model (C9.3) that is about 390 MB
against Render Free's 512 MB, not measured in the container. The process
does not give the memory back after the job (231 MB at the end): Gate G5
measures the server in the container, and running the job in a child
process or with smaller batches is the fallback if it is too close.

C18.3, the same job with math classification (`backend/regions/classify.py`)
on every page, same harness: Calculus 0.256 s/page (was 0.253), peak
247.7 MB; SICP 0.137 s/page (was 0.132), peak 176.2 MB; Interactive Linear
Algebra 455 pages 0.132 s/page, peak 173.7 MB. Classification costs about
3 to 5 ms a page; reading the PDF is the rest.

C18.4, with code detection and rebuilding as well: SICP 0.139 s/page,
peak 177.5 MB; Calculus 0.265 s/page, peak 249.5 MB.

C18.5a, with graphics, figures, drawn math and pdfplumber's table finder
(28 to 400 ms a page when it runs, so it runs only on pages with at least
two long thin edges each way: 365 of Calculus's 769 pages, 117 of
Circuits's 557, 95 of ILA's 455, 14 of SICP's 883), extraction and
classification of every page, Windows: Calculus 0.275 s/page, Circuits
0.174, ILA 0.129, SICP 0.135 (`fig_survey`-style loop over
`extract.iter_pages` and `classify.classify_page`, 20-page batches).

C18.5b, EPUB regions from structure (`backend/regions/epub.py`), Windows, fresh
process: Alice (18.4 MB, 20 spine documents, 927 regions) in 0.25 s, about
13 ms a document, RSS 18 to 72 MB with ebooklib, BeautifulSoup and the
book's bytes loaded. EPUBs need no pdfplumber.

### C18.G: Gate G5, the whole pipeline on the technical shelf (2026-11-13)

`python scripts/dev/gate_g5.py --book <file>`, one fresh process per book,
Windows, no CPU limit: the real `book_ingestor.run_job` (extraction,
chunks, local embeddings, questions), then the regions job and the prose
rebuild (which embeds and questions changed chunks again), on the in-memory
database. RSS sampled every 0.2 s; each phase's peak is the process's RSS,
so it includes what earlier phases kept. The model loaded first: 179 to
180 MB.

| Book | Pages / chunks | Seconds | Peak: ingest | Peak: regions job | Peak: prose rebuild |
|---|---|---|---|---|---|
| Calculus Volume 1 (52 MB, over the 50 MB upload limit) | 769 / 246 | 688 to 749 | 519 MB | 481 to 484 MB | 662 to 663 MB |
| SICP | 883 / 269 | 289 | 436 MB | 407 MB | 426 MB |
| Lessons in Electric Circuits I | 557 / 253 | 353 | 337 MB | 386 MB | 414 MB |
| Interactive Linear Algebra | 455 / 184 | 240 | 337 MB | 370 MB | 408 MB |
| Alice (EPUB) | 20 spine documents / 46 | 35 | 326 MB | 344 MB | 349 MB |

Against Render Free's 512 MB (the container limit every earlier
measurement used; Gate G2's 300 MB line is the model's own load): region
extraction stays under it for every book; Calculus goes over it while
ingesting (519 MB, before any C18 code runs) and in the prose rebuild
(663 MB).

Linux container (your choice at C18.G, "Measure in container first"): the
repo `Dockerfile` built at `13c5d52` as `readfocus-c18g` (916 MB; model
baked in) plus `psutil==7.2.2` (`readfocus-c18g-measure`), repo mounted
read-only, `--network none`, no CPU limit (memory does not depend on it),
`--memory=512m --memory-swap=512m`:

    docker run --rm --network none --memory=512m --memory-swap=512m -v <repo>:/repo:ro -w /repo -e SUPABASE_URL=http://127.0.0.1:9 -e SUPABASE_SERVICE_KEY=offline -e PYTHONPATH=/repo readfocus-c18g-measure python scripts/dev/gate_g5.py --book <file>

Model loaded: 208 to 216 MB.

| Book | 512 MB cap | Seconds | Peak: ingest | Peak: regions job | Peak: prose rebuild |
|---|---|---|---|---|---|
| Calculus Volume 1 | **killed: out of memory (exit 137, OOMKilled)** | 640 (2 GB cap) | 749 MB | 848 MB | 1,036 MB (2 GB cap) |
| SICP | finished | 249 | 462 MB | 444 MB | 464 MB |
| Lessons in Electric Circuits I | finished | 311 | 382 MB | 433 MB | 452 MB |
| Interactive Linear Algebra | finished | 208 | 374 MB | 400 MB | 435 MB |
| Alice (EPUB) | finished | 35 | 377 MB | 400 MB | 402 MB |

Linux keeps more than Windows (each phase starts from what the last one
left: glibc does not hand freed memory back). Calculus is over 512 MB while
ingesting, before any C18 code runs; it is also over the 50 MB upload limit,
so the app refuses it today. Every shelf book under the limit finishes inside
512 MB, the highest at 464 MB (SICP).

After the memory fix (`48e7fc3`: PDF text read 50 pages per pypdf reader,
freed memory handed back with `malloc_trim` after each phase and batch,
regions loaded with only the meta prose needs), same container, same
command, `--memory=512m --memory-swap=512m`:

| Book | 512 MB cap | Seconds | Peak: ingest | Peak: regions job | Peak: prose rebuild | Held by the gate's in-memory database at the end |
|---|---|---|---|---|---|---|
| Calculus Volume 1 | finished | 651 | 399 MB | 475 MB | 502 MB | 12 MB |
| SICP | finished | 257 | 362 MB | 386 MB | 410 MB | 9 MB |
| Lessons in Electric Circuits I | finished | 315 | 344 MB | 383 MB | 397 MB | 9 MB |
| Interactive Linear Algebra | finished | 219 | 340 MB | 373 MB | 401 MB | 5 MB |
| Alice (EPUB) | finished | 35 | 345 MB | 379 MB | 387 MB | 1 MB |

The pypdf step on its own (Calculus, one process, `/proc/self/status`):
one reader for all 769 pages 88 to 288 MB; a fresh reader per 50 pages 88
to 136 MB, the same text for every page. Calculus keeps about 10 MB under
the limit; the books the app accepts (50 MB upload limit) keep 100 MB or
more.

### C14.1: Render-ready image with the model baked in (2026-11-12)

The model is downloaded at build time into `FASTEMBED_CACHE`
(`/app/.cache/fastembed`) and the image runs with `HF_HUB_OFFLINE=1`, so
a cold start loads it from disk. "Before" is the C13 `Dockerfile` built at
`7306c01` as `readfocus-api-before` (model downloaded from Hugging Face at
every start); "after" is `readfocus-api`. Both run as
`docker run --memory=512m --cpus=0.1 -e PORT=8000 -p 8000:8000 --env-file .env <image>`
against the dev project.

```bash
docker build -t readfocus-api .
python scratchpad/coldstart.py <image> 3 .env   # one-off: polls /health every 0.25 s, docker stats 3 s after model_ready
python scripts/bench.py --base-url http://127.0.0.1:8000 --ingest sample.pdf --flow-runs 3 --cold --quiet 120 --poll 2 --docker rf-c14 --server-cmd "docker run --rm --name rf-c14 --memory=512m --cpus=0.1 -e PORT=8000 -p 8000:8000 --env-file .env readfocus-api" --stop-cmd "docker stop rf-c14"
```

| Measure | Before | After |
|---|---|---|
| Image size (`docker images`) | 728 MB | 885 MB; the model layer is 91.3 MB |
| Build time, requirements layer not cached | not measured | 74 s (pip 45 s, model bake 13 s) |
| Process start -> first `/health` | 13.88 to 15.24 s | 17.13 to 18.35 s (3 cold-start runs); 15.80 to 18.30 s (3 bench runs) |
| Process start -> `model_ready` | 29.77 to 32.33 s, download included | 20.04 to 21.04 s, no download in the log |
| Idle memory, 3 s after `model_ready` (`docker stats`) | 267.4 to 292.5 MiB | 251.2 to 254.5 MiB |

Cold ingestion of `sample.pdf` (7 chunks, 55 questions in every run; the
bench uploads as soon as `/health` answers and deletes the book after).
Before is the C9.5 container run (`readfocus-c9-5`, same command and
settings); the before image above was not benched for ingestion.

| Step | C9.5 p50 (p95) | C14.1 p50 (p95) |
|---|---|---|
| `POST /books/upload` | not recorded | 2.40 s (2.48 s) |
| `upload -> ready` | 50.08 s | 39.89 s (40.62 s) |
| `upload -> chunk 0 questions` | 51.20 s (52.20 s) | 40.28 s (40.94 s) |
| `upload -> done` | 60.34 s (60.91 s) | 46.39 s (47.07 s) |
| Peak memory during ingestion (`docker stats`) | 328, 331, 368 MB | 305, 301, 308 MiB |

How to read it: the model is ready about 10 s sooner and nothing is
fetched at boot, which on Render is every wake from a spin-down. The
first `/health` answer comes 2 to 4 s later, most likely because loading
from disk now competes for the 0.1 CPU while uvicorn starts, where before
the download left the CPU idle (not separated). Ingestion finishes about
10 to 14 s sooner, because the first batch no longer waits on a download;
that comparison crosses a day and two chunks of code, so treat it as
direction, not size. Peak memory stays under 310 MiB of the 512 MB limit
in all three runs. Not measured: Render itself, the image pulled and
started on Render, a long book in the container.

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

The ingestion tables below were taken after the bench fix described
under "Measurement resolution" (each reading stamped when its answer
arrives). A first After run with the old stamping gave, p50: Windows
ready 4.81 s / 4.86 s, chunk 0 questions 4.81 s / 2.39 s, done 4.81 s /
132.68 s; container ready 53.29 s, chunk 0 questions 51.49 s, done
57.87 s, peak 330, 332 and 391 MB.

<!-- bench:c9-after-windows:start -->
| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `POST /books/upload (sample.pdf)` | 3 | 1.99 s | 2.56 s | |
| `upload -> ready (sample.pdf)` | 3 | 5.12 s | 5.24 s | |
| `upload -> chunk 0 questions (sample.pdf)` | 3 | 6.25 s | 6.32 s | |
| `upload -> done (sample.pdf)` | 3 | 6.25 s | 6.32 s | |
| `POST /books/upload (pride-and-prejudice.epub)` | 3 | 1.23 s | 1.33 s | |
| `upload -> ready (pride-and-prejudice.epub)` | 3 | 5.27 s | 5.41 s | |
| `upload -> chunk 0 questions (pride-and-prejudice.epub)` | 3 | 3.84 s | 4.00 s | |
| `upload -> done (pride-and-prejudice.epub)` | 3 | 133.69 s | 134.56 s | |
<!-- bench:c9-after-windows:end -->

Windows: process start -> `/health` 2.59 to 2.61 s; peak RSS 322 MB and
350 MB; idle RSS 266.6 to 266.9 MB (2 processes).

<!-- bench:c9-after-container:start -->
| Step | Runs | p50 | p95 | Notes |
|---|---|---|---|---|
| `POST /books/upload (sample.pdf)` | 3 | 2.58 s | 2.61 s | |
| `upload -> ready (sample.pdf)` | 3 | 50.08 s | 51.11 s | |
| `upload -> chunk 0 questions (sample.pdf)` | 3 | 51.20 s | 52.20 s | |
| `upload -> done (sample.pdf)` | 3 | 60.34 s | 60.91 s | |
<!-- bench:c9-after-container:end -->

Container: process start -> `/health` 13.57, 14.43 and 27.08 s (one slow
start); peak memory 328, 331 and 368 MB (`docker stats`).

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

#### Measurement resolution

The first After run showed the long book's chunk 0 questions 2.5 s before
`ready`. Investigated (`docs/DEBUG_LOG.md`, C9.5): the questions do come
first, by design (C9.2 stores them, then marks the book ready), but by
about 0.4 s, not 2.5 s: a scratchpad poll every 0.1 s, each reading
stamped on arrival, saw them at 5.45 s and `ready` at 5.82 s. The bench
had stamped both readings of a poll iteration with the time at its top,
and one iteration takes about 2.9 s on Windows (status 0.75 s, four
counts 1.1 s, a 1 s sleep), longer in the container (2 s sleep). Fixed:
each reading is now stamped when its answer arrives.

That fix removes the shared stamp, not the coarse sampling: every
ingestion time here is the moment a reading first saw the change, up to
one iteration after it happened. Differences smaller than about 3 s
(Windows) or 5 s (container) are not resolved, including the order of
`ready` and chunk 0 questions. All earlier ingestion numbers (C9.0, C9.2,
C9.3) used the old stamping and share that resolution.

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
| Windows `upload -> ready`, `sample.pdf` | 2.33 s | 5.12 s | Later by design (C9.2: ready waits for the first batch's questions); the gap is about one poll iteration, so its size is not resolved |
| Windows `upload -> chunk 0 questions`, `sample.pdf` | 4.67 s | 6.25 s | No clear change (within one iteration) |
| Windows `upload -> ready`, 204-chunk EPUB | 2.36 s | 5.27 s | Later by design (C9.2); size not resolved, as above |
| Windows `upload -> chunk 0 questions`, EPUB | 4.70 s | 3.84 s | No clear change (within one iteration) |
| Windows `upload -> done`, EPUB | 138.34 s (p95 148.44) | 133.69 s (p95 134.56) | No clear change |
| Container `upload -> ready` | 26.29 s | 50.08 s | **Slower** (C9.2), well beyond the resolution |
| Container `upload -> chunk 0 questions` | 53.64 s (p95 55.08) | 51.20 s (p95 52.20) | No clear change |
| Container `upload -> done` | 61.70 s (p95 63.39) | 60.34 s (p95 60.91) | No clear change |
| Container process start -> `/health` | 12.4 to 14.4 s | 13.6 to 14.4 s, one 27.1 s | No change, one slow start |
| Container process start -> model ready | first use | 29.2 to 29.9 s (C9.3) | New: the load happens at boot, not in a request |
| Idle RSS, Windows | 136 MB (C9.3 before; 134 MB in C8.8) | 266.6 to 266.9 MB | **Heavier**: about +130 MB, the preloaded model (C9.3) |
| Idle memory, container | 110 to 126 MB | 272 to 275 MB (C9.3) | **Heavier**: about +150 MB |
| Peak memory during ingestion, Windows | 321 MB; 349 to 352 MB | 322 MB; 350 MB | No change |
| Peak memory during ingestion, container | 319 to 326 MB | 328, 331, 368 MB (330, 332, 391 MB in the first After run) | Higher in one run of three each time; not separated from noise |
| Ingestion after a hard kill mid-book | book stuck in `processing`, no retry (issue 20) | resumed from cursor 53 of 204 by the sweep, 0 duplicate chunks or questions, counts equal to an uninterrupted run (C9.1b) | **Durable** (measured once on dev) |

Measured improvements from C9: the dashboard (about 260 ms faster), and
ingestion that survives a restart. Everything else is unchanged within
noise, slower by choice (`ready` waits for the first questions), or
heavier (the preloaded model). Ingestion times are resolved to about one
poll iteration (3 to 5 s). Not measured: Render itself, a cold start
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

### C12.1c: reader structure during ingestion (2026-11-11)

`book_structure.build` now runs once per ingestion job, on a worker
thread, before the first batch. No new dependency: BeautifulSoup, ebooklib
and pypdf were already imported by ingestion. Measured in one Python 3.11
process on this machine (an inline script: extract, `chunk_text`, then
`build`, timed with `perf_counter`, RSS from `psutil`):

| Book | Chunks | `build` | For comparison |
|---|---|---|---|
| `sample.pdf` (13-page journal paper) | 7 | 1 ms | |
| Synthetic EPUB: 60 chapters, 80,760 words, an `<em>` in every sentence | 134 | 303 ms | extract + chunk of the same file: 167 ms |

- Process RSS 97.9 MB before loading the books and building, 118.2 MB
  after (the EPUB, its text and blocks held in memory together).
- Stored size for the EPUB: blocks as JSON 652 KB against 389 KB of chunk
  text (the marks on every sentence inflate it); a book without emphasis
  stores about the text size again.
- Against an ingestion of minutes (embedding and questions per batch),
  0.3 s is small; it is paid once per job, also on a resume.

Not measured: a real published EPUB or novel PDF, Render, memory of a
book over 100,000 words.

### C12.3: reader pagination (2026-11-11)

`frontend/src/reader/BookReader.jsx` lays today's text out as CSS columns
(one column a page) and reads the page count from `scrollWidth`. Measured
in headless Edge 157 over CDP on `/__reader` (dev server), on the 4×
fixture: 8 chapters, 3,541 words of *Walden*. "Layout" is the time from
the start of the layout effect to the page count and anchor (forced
column layout included, `data-paginate-ms`); "whole" is from the click
on a text size to the new page count on screen (React render, commit and
layout). Six text-size changes each; mount is the click that first
renders the long text. Scratchpad script `reader_timing.mjs`.

| CPU | Width | Mount (whole / layout) | Text size, layout max | Text size, whole max | Per chapter (whole / 8) |
|---|---|---|---|---|---|
| 1x | 1440 | 11.8 / 4.1 ms | 10.8 ms | 16.9 ms | about 2 ms |
| 1x | 375 | 11.5 / 4.9 ms | 7.2 ms | 11.4 ms | about 1.5 ms |
| 4x throttled | 1440 | 51.0 / 17.8 ms | 29.1 ms | 51.5 ms | about 6 ms |
| 4x throttled | 375 | 52.6 / 20.9 ms | 29.9 ms | 48.5 ms | about 6 ms |
| 6x throttled | 1440 | 80.0 / 27.7 ms | 42.0 ms | 72.3 ms | about 9 ms |
| 6x throttled | 375 | 87.7 / 33.4 ms | 50.3 ms | 83.9 ms | about 11 ms |

Budget: under 100 ms per chapter (C12.3 prompt). Met with room at every
setting; even all eight chapters together stay under 100 ms at 6x.
A session is one to four chunks of about 600 words, smaller than this
fixture. Not measured: a real phone, Firefox or Safari (whose column
layout differs), books with very long paragraphs.

### C12.6: word and phrase lookup (2026-11-11)

`GET /lookup` through FastAPI's TestClient on this machine, against the
dev Supabase project and the live Free Dictionary API and Wikipedia
(scratchpad `lookup_live.py`). "In-process" is a repeat answered by the
LRU in front of the table; "table" clears that LRU before every call, so
each repeat reads `term_lookups` on dev. 50 calls each.

| Case | p50 | p95 |
|---|---|---|
| Cached, in-process | 2.7 ms | 2.9 ms |
| Cached, `term_lookups` table only | 96.0 ms | 113.9 ms |

Budget: cached p95 under 150 ms locally (C12.6 prompt). Met by both.

First (uncached) lookups: `serendipity` 984 ms (dictionary), `wandered`
1,048 ms (dictionary), `Henry David Thoreau` 398 ms and `Mercury` 500 ms
(Wikipedia, the second a disambiguation page). Single calls: the Free
Dictionary API answered in 190–1,430 ms and Wikipedia in 380–1,010 ms,
but **4 of 12 dictionary lookups of made-up words hit the 2.5 s timeout**,
so an unknown word is sometimes reported as "couldn't look this up"
rather than "not found" (nothing is cached then).

Follow-up, same day (Wikipedia after a failed source): 12 more made-up
words, cache table bypassed. 6 came back "not found" (1.4–2.6 s, both
sources asked) and 6 "unavailable": one dictionary timeout (3.7 s in all)
and five fast failures that turned out to be intermittent **502s from the
dictionary's Cloudflare front with `Retry-After: 60`**, each followed by a
Wikipedia 404. A word cannot be called "not found" while the dictionary
has not answered, so these stay unavailable and uncached. Real terms were
unaffected: `serendipity` (dictionary) and `Walden Pond` (Wikipedia, 298 ms).

Second follow-up (busy sources are skipped): 12 more made-up words. The
second one met a dictionary 502 with `Retry-After: 60`; the ten after it
went to Wikipedia only (500–1,720 ms, one request each) until the minute
was up, instead of each waiting on the dictionary first.

Memory: importing `backend/services/lookup.py` in a fresh process with
httpx and the Supabase client already loaded: 55.8 → 57.1 MB RSS (+1.3
MB). No new dependency (httpx was already pinned). The in-process LRU
holds at most 2,000 compact answers.

### Markdown and notebook conversion (C19.2a, 2026-11-13)

New: `markdown-it-py==4.2.0`, `mdurl==0.1.2`, `mdit-py-plugins==0.6.1`
(MIT, licence files read after install) and `latex2mathml==3.81.1` (MIT in
its metadata); pure Python, about 250 KB of wheels. Windows, Python 3.11,
fresh process, measured with psutil:

| Step | RSS |
|---|---|
| `import backend.main` (the app as served) | 129.1 MB |
| + `backend.convert.markdown` and the EPUB builder | +2.5 MB |
| converting `sample.md` x 40 (31,960 characters, 80 chapters, 67 KB EPUB) | +2.6 MB more, 108 ms |

Command: the inline script recorded in the C19.2a PROGRESS row. Not
measured in the Linux container; well inside the 450 MB bar either way.

### pandoc for LaTeX sources (C19.3, measured, not adopted; 2026-11-13)

A throwaway image: `readfocus-c18g-measure` (the C18.G container, 917 MB)
plus `apt-get install --no-install-recommends pandoc` (Debian's pandoc
3.1.11.1, GPL-2.0-or-later). In a `--memory=512m` container, psutil polling
the pandoc process every 10 ms, `pandoc <file> -f latex -t epub3 --mathml`:

| What | Result |
|---|---|
| Image | 917 MB -> 1.16 GB (+243 MB; `/usr/bin/pandoc` is 189 MB) |
| A 1.4 KB LaTeX source (sections, math, align, 3 figures, a table) | 0.05 s, peak RSS 71 MB |
| The same body 40 times (41 KB, a long paper) | 0.31 s, peak RSS 119 MB |

Against Gate G5's container peaks (Calculus Volume 1: 399 MB ingesting,
475 MB in the regions job, 502 MB in the prose rebuild, under the 512 MB
limit), a 70-120 MB pandoc process during another book's ingestion would
pass the limit, so pandoc was not added and C19.3 was skipped.

### In-browser OCR for scanned pages (C19.4b, 2026-11-13)

tesseract.js 7.0.0 and tesseract.js-core 7.0.0 (Apache-2.0, licence files
read after install), English model from @tesseract.js-data/eng 1.0.0 (MIT
package; `4.0.0_best_int`). Served from our origin (`/ocr/`, copied at
build): worker 111 KB, one core of three by browser support (3.9 MB each,
wasm inline), model 2.95 MB gzipped; about 7 MB on a reader's first OCR,
then cached by the browser (the model also in IndexedDB). The tesseract.js
library is a lazy chunk of 17.2 KB (7.2 KB gzip); the entry bundle does not
include it. The server gains no dependency or memory.

Seconds per page, `npx playwright test e2e/ocr.spec.js -g "fully scanned"`
three times (headless Edge on this machine, the app from `vite preview` on
loopback, the 2-page `scanned.pdf` at 150 dpi, 185 words a page, drawn for
OCR at about 300 dpi capped at 2,400 px):

| Step | Time |
|---|---|
| First page, from the worker request to the page's words posted (engine and model loaded from the local server) | 1.2 s, 1.2 s, 1.2 s |
| Second page, from the first page's post to its own | 0.8 s, 0.8 s, 0.8 s |

Not measured: a phone, a real network download of the 7 MB, long dense
pages.

## Frontend: Lighthouse and image budgets

### C20.8b-c: block actions and mathml-to-latex (2026-11-14)

`npm --prefix frontend run build` after C20.8c, against C20.7b above:

| Chunk | C20.7b (gzip) | C20.8c (gzip) |
|---|---|---|
| `index-*.js` (initial) | 96.74 kB (35.07 kB) | 96.74 kB (35.08 kB) |
| `ReadingSession-*.js` | 77.47 kB (26.60 kB) | 90.03 kB (30.54 kB) |
| `dist-*.js` (new, lazy: `mathml-to-latex` + `@xmldom/xmldom`) | none | 172.48 kB (52.17 kB) |

`mathml-to-latex` 1.8.0 (MIT, released 2026-06-10; one dependency,
`@xmldom/xmldom` 0.9.12, MIT) is imported only when an EPUB equation with
no TeX annotation is copied or explained; `npm audit` names neither.

### C20.7b: Steve's panel and KaTeX (2026-11-14)

`npm --prefix frontend run build`, before (C20.7a's tree, the panel not
imported) and after:

| Chunk | Before (gzip) | After (gzip) |
|---|---|---|
| `index-*.js` (initial) | 96.70 kB (35.02 kB) | 96.74 kB (35.07 kB) |
| `ReadingSession-*.js` | 53.56 kB (18.62 kB) | 77.47 kB (26.60 kB) |
| `ReadingSession-*.css` | 17.06 kB (3.85 kB) | 26.16 kB (5.26 kB) |
| `katex-*.js` (new, lazy) | none | 259.69 kB (77.81 kB) |

KaTeX 0.19.1 (MIT, released 2026-10-23; its one dependency, `commander`, is
for its command line only) is imported on the first equation Steve
writes, with `output: "mathml"`, so no KaTeX fonts or CSS are shipped;
the MathML goes through DOMPurify's MathML profile. Code in answers is
tinted by `frontend/src/steve/highlight.js`, no dependency. `npm audit`
names neither package.

### C17.5: page turns on the original view (2026-11-12)

`e2e/reader.spec.js` "page-turn frame rate", Playwright on Edge against the
production build (`vite preview`), 1440 x 900, API mocked: four turns
(two forward, two back, 800 ms apart) with the leaf animation, frames
sampled with requestAnimationFrame; written to
`frontend/test-results/reader-benchmarks-{pdf,epub}.json`.

| Book | fps | worst frame | frames over 33 ms |
|---|---|---|---|
| `sample.pdf` (6 pages) | 75 | 13.7 ms | 0 |
| `reflow.epub` (4 sections, 9 images) | 75 | 13.8 ms | 0 |

A cached word's card opens within 600 ms of the pointer reaching the word
on both (asserted, not recorded). Not measured: the 4x CPU throttle run of
C12, a long PDF's text search for today's chunks, phones.

### C17.3: EPUB renderer (2026-11-12)

foliate-js vendored at `78914aef4466` (MIT; decision D-C17.3 in
`docs/DECISIONS.md`) and `dompurify@3.4.17` (MPL-2.0 or Apache-2.0).
Minified + `gzip -9`: foliate-js for a reflowable EPUB 37.2 KB (view, CFI,
progress and overlayer 8.2, EPUB parser 8.1, paginator 7.1, zip 13.8;
fixed layout +2.4), bundled with rolldown in the evaluation; DOMPurify
`purify.min.js` 29,828 B raw, 11,757 B gzip. As with PDF.js, the production
build has no EPUB chunk yet (only the dev gallery imports the renderer;
`grep` finds neither in `dist/assets/*.js`).

Checks: `/__epub` on the Vite dev server, Microsoft Edge through
Playwright, on the generated fixtures (`tools/make_reader_fixtures.py`).
Script in the scratchpad, not committed. Every image shown on any page is
fetched and hashed (SHA-256) and matched against the package's image files.

| Check | Result |
|---|---|
| `reflow.epub` images: packaged vs shown, 1440 px, DPR 1 (two pages side by side) | 9 packaged, 8 shown: `wide-2x.png` is the `srcset` 2x candidate of `wide.png`, so a DPR 1 screen shows `wide.png` |
| Same, 800 px, DPR 2 (one page) | 9 packaged, 8 shown: `wide-2x.png` instead of `wide.png` |
| `diagram.svg` | shown at 400 x 200 with its shapes; its bytes differ from the package because foliate loads SVG files as text and our sanitizer re-serialises them (no script inside) |
| Kinds covered | `<img>` PNG and GIF, `<img>` of an SVG, inline `<svg>` `<image>` by `xlink:href` and by SVG 2 `href`, a CSS background, a `<figure>` with `<figcaption>`, a `srcset`, the cover |
| Figure and caption | same column (left 77 px both), caption 7 px under the image; the image has `width="1200" height="800"` from its header before it decodes |
| MathML | `<math>` is a `MathMLElement`, 53 px high; its `<mfrac>` 33 px |
| Code | `<pre><code>` text identical to the source, indentation kept (`white-space: pre-wrap`) |
| `fixed.epub` | both pages' images shown; page one alone on the right of the first spread, frame 535 x 713 |
| `hostile.epub` | no script ran (top window and section), 0 scripts, 0 event handlers, 0 iframe/form/input/object/embed, 0 `javascript:` links, 0 `http-equiv` metas, 0 references to `example.invalid` left, the local image shown, no request off `localhost` |
| CSP backstop (`vite preview` of the production build, a blob: iframe with an inline script, an `onerror` handler, a remote image and a remote background) | script and handler did not run; 4 CSP violations reported; the remote loads refused |
| Style switch | Publisher: `Georgia, serif` (the book's CSS); ReadFocus: `"ReadFocus Lora", Georgia, serif` at 18 px, the font loaded inside the section |
| CFI | a location's CFI, after going elsewhere, `goTo` it: the same CFI back |
| Page turn (call to `relocate`) | 300 to 306 ms with foliate's slide animation (that is its duration); 0 to 1 ms with reduced motion |
| JS heap (`performance.memory`) before and after paging the whole fixture | 18.9 to 22.7 MB (DPR 1), 18.8 to 22.9 MB (DPR 2) |

Images load per section (foliate) and, inside a section, with
`loading="lazy"` and `decoding="async"`, so the browser decodes the ones
near the visible page; this was not measured page by page. Not measured: a
real publisher EPUB, a phone, a production build of the renderer.

### C17.2: PDF.js renderer (2026-11-12)

`pdfjs-dist@6.4.299` (Apache-2.0, checked in the installed `package.json`
and `LICENSE`; released 2026-10-03; its only optional dependency,
`@napi-rs/canvas`, is for Node and is never bundled). Sizes of the files
the browser loads, `gzip -9`:

| File | Raw | Gzip | Loaded |
|---|---|---|---|
| `build/pdf.min.mjs` (library) | 458,904 B | 131,443 B | when a PDF opens |
| `build/pdf.worker.min.mjs` (worker) | 1,264,342 B | 374,642 B | when a PDF opens |
| `/pdfjs/wasm/*.wasm` (JPEG 2000, JBIG2, colour) and `/pdfjs/standard_fonts/*` | 1,249,437 B together | n/a | only when a page needs one |

A production build has **no** PDF.js chunk yet: only the dev gallery
(`/__pdf`) imports the renderer, and `grep -l "GlobalWorkerOptions\|pdfjs"
dist/assets/*.js` finds nothing, so the first-load bundle is unchanged. The
chunk sizes in the build are measured when the reader imports it (C17.4/5).
`dist/pdfjs/` (1.4 MB with licences) is copied into every build and fetched
on demand only. `quickjs-eval` (JavaScript inside PDFs) and the JS decoder
fallbacks are not served.

Timing: `/__pdf` on the Vite dev server (unminified app code; the worker is
the minified file), Microsoft Edge through Playwright, 1440 x 1100, on the
593-page "Digital Design And Computer Architecture" PDF (5,073,556 B) from a
Supabase Storage signed URL, opening at page 40. Script in the scratchpad,
not committed.

| Measure | Result | Target |
|---|---|---|
| First page shown (canvas and text layer), new browser context each run | run 1: 3,135 ms (Vite still compiling `pdfjs-dist`), 1,312, 1,335 ms; run 2 (final code): 1,994 ms, 1,289, 1,289 ms | < 1.5 s |
| First page, same context again (HTTP cache warm), DPR 2 | run 1: 1,276, 846 ms; run 2: 1,333, 854 ms | |
| Signing the URL (`create_signed_url`, what `GET /books/{id}/file` calls), 6 calls from this machine | 180, 109, 112, 126, 105, 103 ms | |
| Page turn, page already in the ±2 cache, DPR 2 (click to text layer rendered) | run 1: 7, 6, 4, 4, 4 ms; run 2: 8, 7, 5, 4, 3 ms | < 200 ms |

The first new context of each run is the slowest (3.1 s and 2.0 s, over
the target): the dev server's first transform and a cold connection to
Storage; later contexts land at about 1.3 s.

In the gallery the source is ready at once. For a book, `usePdfDocument`
starts loading PDF.js and asks `GET /books/{id}/file` at the same moment,
so the signing time overlaps the library download instead of adding to it;
added in full it would make a cold first page 1.42 to 1.52 s, at the 1.5 s
target rather than clearly under it. The endpoint was not timed through
the backend (it needs a signed-in reader); its select and auth add to the
signing time above. Not measured: a production build, a
phone, Render's region.

Checked by eye (screenshots): a selected line's highlight sits on its glyphs
at 100 % (span 288.1 x 13.3 px) and 200 % (576.2 x 26.7 px, exactly double);
the cover (raster), a photograph page (p. 31) and a vector figure with
hatching (p. 52, Figure 1.29) render complete. The canvas is 1535 x 1728 at
DPR 2 for a 767 px wide page. No pixel comparison with a second renderer.

### C13 close: every page (2026-11-11)

Lighthouse 12.8.2 through its Node API on an Edge 157 headless page
(puppeteer-core 24.10.0 connected to a Playwright persistent context), so
each run used the e2e suite's approach: an unexpiring fake Supabase
session in local storage and every API call answered locally (shelf of
three books, a dashboard with 10 scores, the Walden fixture in the
reader, a two-question test and its graded results). Nothing left the
machine; no sign-in to Supabase. Production build on `vite preview` port
5175; runner: a temporary script, not committed. Plan bar per page
(C13 plan): accessibility at least 95, performance at least 85, CLS
under 0.1.

| Page | Route | Signed in | Mobile perf | Mobile a11y | Desktop perf | Desktop a11y | Best pr. | SEO | Mobile LCP | CLS (max) |
|---|---|---|---|---|---|---|---|---|---|---|
| Landing | `/` | no | 88 | 100 | 99 | 100 | 100 | 100 | 3.5 s | 0 |
| Sign in | `/login` | no | 88 | 100 | 100 | 100 | 100 | 63 | 3.5 s | 0 |
| Library | `/` | yes | 86 | 100 | 99 | 100 | 100 | 100 | 3.8 s | 0 |
| Dashboard | `/dashboard` | yes | **81** | 100 | 99 | 100 | 100 | 63 | 4.3 s | 0 |
| Reading | `/read/walden` | yes | **82** | 95 | 99 | 100 | 100 | 63 | 4.3 s | 0.002 |
| Test | `/test/t1` | yes | 88 | 100 | 99 | 100 | 100 | 63 | 3.5 s | 0 |
| Results | `/results/r1` | yes | 87 | 100 | 99 | 100 | 100 | 63 | 3.6 s | 0.006 |
| Not found | `/no-such-page` | yes | 90 | 100 | 100 | 100 | 100 | 63 | 3.3 s | 0 |

- Accessibility and CLS meet the bar everywhere. The reading page's 95
  on mobile is one audit, colour contrast on the toolbar's clock and
  buttons, sampled while the toolbar was fading out (measured #cbc7c0 on
  #fbf9f4): the toolbar rests only at full opacity (`--ink-2` on
  `--surface`, a pair `check:contrast` passes) or at opacity 0, hidden.
- Performance under the bar on mobile: dashboard 81 (FCP 2.7 s; the
  dashboard chunk with Recharts is 90 KB, 38 KB of it unused on first
  paint) and reading 82. Every page is 99-100 on desktop.
- SEO 63 on app routes is `is-crawlable` alone: `robots.txt` disallows
  them on purpose (C13.10e).
- Mobile numbers use Lighthouse's default simulated slow 4G and 4x CPU;
  the first-load JavaScript common to every page (React, the router,
  Supabase: 120 KB, about 70 KB unused on any one page) is the shared
  cost.

### C13.10e: the public landing page (2026-11-11)

Lighthouse 12.8.2 (`npx lighthouse@12.8.2`), all four categories,
Microsoft Edge 157.0.4341.42 headless (`CHROME_PATH`). Production build
(`VITE_SITE_URL=http://localhost:5175 npm --prefix frontend run build`,
which now prerenders the landing page into `index.html`) served by
`vite preview --port 5175`; backend on port 8000 so the landing page's
one `GET /health` answers as it would deployed. `/` signed out, fresh
profile. Targets from the C13.10 brief: performance at least 90,
accessibility at least 95, best practices at least 95, SEO at least 95,
CLS under 0.1.

| Run | Throttling | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | Speed index | Transferred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Mobile 1 | simulated (default) | 88 | 100 | 100 | 100 | 2.49 s | 3.47 s | 10 ms | 0 | 2.49 s | 370 KB |
| Mobile 2 | simulated (default) | 88 | 100 | 100 | 100 | 2.49 s | 3.47 s | 0 ms | 0 | 2.49 s | 370 KB |
| Mobile | applied (`--throttling-method=devtools`) | 95 | 100 | 100 | 100 | 2.27 s | 2.45 s | 0 ms | 0.0006 | 2.31 s | 370 KB |
| Desktop | `--preset=desktop` | 99 | 100 | 100 | 100 | 0.59 s | 0.77 s | 0 ms | 0 | 0.59 s | 411 KB |

Met: accessibility, best practices, SEO and CLS on every run; performance
on desktop and with applied throttling. **Not met: mobile performance with
the default simulated throttling, 88 of 90.** Its estimate still counts the
app's scripts toward first paint: unused JavaScript is 102 KB, 81 KB of it
the Supabase client in the vendor chunk, which the auth check loads before
anything else. Taking it off the first load is the remaining lever (a
follow-up, not done here). Dropping the DM Sans preload was tried and made
it worse (87, FCP 2.8 s).

LCP element: text in every run, never an image (the page has no raster
image): the lead paragraph under the headline on mobile (it is larger
than the two-line headline at 412 px), the spread's text on desktop.

Changes behind these numbers: every page but the landing page is
`React.lazy` (initial JS for `/` went from about 285 KB to about 175 KB gzip;
the dashboard's charts, 93 KB gzip, now load with the dashboard only);
the vendor chunk holds only React, the router and Supabase; the landing
page is prerendered into `index.html` (`src/prerender.jsx`,
`scripts/prerender.mjs`); Playfair Display joins Lora and DM Sans in the
font preloads.

### C12.10: page turns and lookup in the e2e run (2026-11-11)

`npm --prefix frontend run test:e2e` (Playwright 1.64.1 on the installed
Microsoft Edge, headless, 1440x900, a production build under `vite preview`,
every API call mocked; `e2e/reader.spec.js`, last test). Page turns:
`requestAnimationFrame` sampled over five turns (three forward, two back),
each given 800 ms to land; then the same with CDP
`Emulation.setCPUThrottlingRate` 4. Lookup: from the `pointermove` that
reaches "woods" to the card in the DOM, timed inside the page; the answer
comes from the mock, so this is the client's own time (the 350 ms hover
intent included), not the network's. Two runs:

| Measure | Run 1 | Run 2 |
|---|---|---|
| Page turns, frames per second | 75.0 (306 frames in 4.07 s) | 75.0 |
| Worst frame gap | 13.7 ms | 14.0 ms |
| Frames over 33 ms | 0 | 0 |
| Page turns at 4x CPU, frames per second | 74.3 | 74.3 |
| Worst frame gap at 4x CPU | 26.7 ms | 26.8 ms |
| Hover to card, first (not cached) | 372 ms | 368 ms |
| Hover to card, cached, 5 tries | 356–363 ms | 357–366 ms |

Headless Edge paces frames at about 75 a second here, so 75 fps is the
ceiling, not a measured limit. Real answers from the backend add the
network: see C12.6 (cached in the table 96 ms p50, first lookups 0.4–1 s).
Results also land in `frontend/test-results/reader-benchmarks.json`
(ignored). Not measured: a real phone, Firefox, Safari.

### C12.8: @floating-ui/react for the word card (2026-11-11)

`npm --prefix frontend run build` (Vite) before and after adding
`@floating-ui/react@0.27.20` (MIT; its dependencies `@floating-ui/react-dom`,
`@floating-ui/dom`, `@floating-ui/core`, `@floating-ui/utils` and `tabbable`
are MIT too; 934 KB unpacked on npm). Only `useFloating`, `inline`, `offset`,
`flip`, `shift`, `autoUpdate` and `FloatingPortal` are imported.

| Asset | Before | After | Delta (raw / gzip) |
|---|---|---|---|
| `vendor-*.js` | 781.91 kB / 227.13 kB gzip | 813.56 kB / 238.65 kB gzip | +31.65 kB / +11.52 kB |
| `index-*.js` (app code: card, client, hooks) | 114.40 kB / 37.86 kB gzip | 123.07 kB / 40.65 kB gzip | +8.67 kB / +2.79 kB |
| `index-*.css` | 59.12 kB / 11.95 kB gzip | 63.68 kB / 12.69 kB gzip | +4.56 kB / +0.74 kB |

About 15 kB gzip in all. `@floating-ui/react-dom` alone (with React's own
`createPortal`) would have been lighter; the C12.8 prompt named
`@floating-ui/react`. Not measured: time to first page.

### C11.5: image budgets and Lighthouse (2026-11-11)

Budgets, enforced by `npm --prefix frontend run check:images` (a standard
check since C11.5): each raster at most 150 KB; all rasters under
`frontend/src` and `frontend/public` together at most 400 KB (everything
an initial route could load); illustration SVGs at most 8 KB; every
`<img>` has width, height, decoding and loading, lazy unless it is the LCP
image (then eager with `fetchpriority="high"`); covers stored by the
backend are capped at the same 150 KB (`covers.MAX_IMAGE_BYTES`).

| Check | Result |
|---|---|
| Rasters in the frontend | 1 (`src/assets/hero.png`, 13.1 KB, unused Vite template) |
| Illustration SVGs | 7, 0.33 to 0.50 KB each |
| `<img>` tags | 1 (`BookCover`): lazy, or eager with high priority when `priority` |
| Stored covers on dev | 1 file, `covers/ol/10140705-M.jpg`, 12.4 KB |
| Deliberately bad scratch tree | 10 failures: oversize raster, 620 KB total, 9 KB SVG, `<img>` without attributes, eager without high priority, high priority on a lazy image, cover cap 500 KB; a correct eager LCP `<img>` passes |

Lighthouse 12.8.2, performance category only, its mobile defaults
(simulated slow 4G, 4x CPU slowdown, 412 x 823 screen), Microsoft Edge
157.0.4341.42 headless on the machine above. Production build served by
`vite preview` (port 4173), backend on port 8000 against the dev
database. `/login` signed out (Lighthouse launches Edge). `/` (Library)
signed in as dev test user A through the app's own form in an Edge
started with a debugging port, HTTP cache cleared and the session kept,
then `lighthouse --port --disable-storage-reset`. Three separate runs per
route; runner: scratchpad `lh_run.mjs`.

| Route | Run | Score | FCP | LCP | TBT | CLS | Speed index | Transferred | Images | LCP element |
|---|---|---|---|---|---|---|---|---|---|---|
| `/login` | 1 | 88 | 2.63 s | 3.31 s | 0 ms | 0.0002 | 2.63 s | 402 KB | 0 | `div.rf-auth-wordmark` |
| `/login` | 2 | 88 | 2.63 s | 3.31 s | 0 ms | 0.0002 | 2.63 s | 402 KB | 0 | `div.rf-auth-wordmark` |
| `/login` | 3 | 88 | 2.63 s | 3.31 s | 0 ms | 0.0002 | 2.63 s | 402 KB | 0 | `div.rf-auth-wordmark` |
| `/` | 1 | 85 | 2.93 s | 3.61 s | 0 ms | 0.0002 | 2.93 s | 441 KB | 0 | `h1.rf-library-title` |
| `/` | 2 | 87 | 2.78 s | 3.46 s | 0 ms | 0.0002 | 2.78 s | 403 KB | 0 | `h1.rf-library-title` |
| `/` | 3 | 87 | 2.78 s | 3.46 s | 0 ms | 0.0002 | 2.78 s | 403 KB | 0 | `h1.rf-library-title` |

Medians: `/login` 88, CLS 0.0002; `/` 87, CLS 0.0002. Targets: score at
least 85, CLS under 0.1: both met. Neither route loads an image yet (the
LCP element is text on both), so the initial-route image total is 0 KB
of 400.

Before the C11.5 fix (`fix(ui): let pages report their first contentful
paint`) Lighthouse stopped on every run with `NO_FCP`: the pre-2.0 `.page`
fade hid each page's first contentful paint (docs/DEBUG_LOG.md).

Not measured: the Library with covers (no page renders `BookCover` yet,
and `GET /books` does not return `cover_url`); desktop presets; Render
and Vercel. Initial JS is most of the transfer (vendor chunk 227 KB gzip,
C10 close review); images are not.

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
