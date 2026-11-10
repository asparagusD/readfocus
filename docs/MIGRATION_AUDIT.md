# ReadFocus migration audit

Written in C2.5 from the full read of the repository (C2.1), the generated
graph (`docs/repo-graph/`) and a few read-only probes. Nothing here is taken
from `README.md`, which describes an orchestrator node and a provider setup
that the code no longer has.

How each claim was checked:

- **read**: seen in the file at the line given.
- **graph**: from `python tools/repo_graph/query.py <target>` or
  `docs/repo-graph/REPO_MAP.md`.
- **ran**: a command was run in this subchunk; the result is quoted.
- **dev DB**: a read-only count against the development Supabase project in
  `.env` (`ENV=development`), run on 2026-11-10. No rows were changed.

Nothing was run against Groq or Google AI Studio (hard constraint 1), and
the production deployment was not inspected.

## 1. Verdict on the suspected issues

| # | Suspected issue | Verdict | Evidence |
|---|---|---|---|
| 1 | `backend/dependencies.py` accepts any raw UUID as a valid user | **Confirmed, and worse than a dev bypass** | read: `backend/dependencies.py:16-17` returns the token as the user id if it is 36 characters with four hyphens. No check of `ENV`. Every router depends on it (graph: imported by `auth.py`, `books.py`, `dashboard.py`, `sessions.py`). The backend then queries with the service-role key (`backend/services/supabase_client.py:14`), which bypasses RLS, so a caller who knows a user id can read, upload and delete as that user. `test_sessions_api.py:8-11` uses exactly this. |
| 2 | `langchain_google_genai` and `tenacity` are imported but missing from `requirements.txt` | **Half refuted, half confirmed** | read: `langchain-google-genai` is at `requirements.txt:7`; it is missing only from `backend/requirements.txt`, which the Dockerfile and CI do not use. `tenacity` (`backend/services/embeddings.py:20`) is in neither file. ran: `pip show tenacity` gives `Required-by: google-genai, langchain-community, langchain-core`, so it is installed only as a transitive dependency. |
| 3 | `chunks.embedding` is `vector(1536)`; what does the model return? | **Consistent today: 1536** | read: `supabase/migrations/001_initial.sql:52` and `:141` declare `vector(1536)`; `backend/services/embeddings.py:16-17` asks `models/gemini-embedding-2` for `output_dimensionality=1536`. ran: the installed `langchain-google-genai` 4.4.3 has `output_dimensionality` as a real model field and passes it on every embed call, so it is not silently ignored. dev DB: three stored embeddings each have 1536 values. The model was not called. |
| 4 | `backend/main.py` spawns `backend/mcp_server.py` on every boot | **Confirmed; and nothing uses it** | read: `backend/main.py:18-23` starts it in the FastAPI lifespan with a relative path and three pipes; `:26` terminates it. graph: no file imports `mcp_server.py`, and no agent imports `mcp` or `langchain_mcp_adapters`. Nothing reads the pipes. ran: the subprocess holds about 73 MB RSS after 8 s (Windows, Python 3.11). |
| 5 | Background work uses FastAPI `BackgroundTasks` | **Confirmed** | read: `backend/routers/books.py:59` (ingestion), `backend/routers/sessions.py:118` (test generation) and `:175` (single-answer grading). All run in the web process with no queue and no resume. See section 6 for what each loses on restart. dev DB: 1 of 8 books is still `processing`. |
| 6 | `backend/routers/agent.py` is effectively empty; root `test_*.py` are ad-hoc scripts | **Confirmed** | read: `backend/routers/agent.py` is three lines, an `APIRouter()` with no routes, mounted at `backend/main.py:56`. graph: `/agent` has no endpoints. The eight root `test_*.py` files have no assertions; see section 7. |
| 7 | Dockerfile hard-codes port 8000 | **Confirmed as written; effect on Render not verified** | read: `Dockerfile:13` `EXPOSE 8000`, `:15` `--port 8000`. `render.yaml` sets no `PORT`. Whether Render routes to 8000 anyway depends on its port detection, which cannot be seen from the repo. |
| 8 | `frontend/vercel.json` exists | **Confirmed** | read: `frontend/vercel.json` sets `npm run build`, `dist`, and rewrites every path to `/index.html`. The repo holds no other frontend host config. That Vercel is the live host is stated in `CLAUDE.md`, not provable from the repo. |

## 2. Current architecture

Read from the code and `docs/repo-graph/REPO_MAP.md` (layer diagram and
LangGraph diagram are there).

- **Frontend**: React 19 with Vite and React Router, plain CSS with custom
  properties in `frontend/src/index.css`. Six pages, one shared layout, five
  small UI components. All server calls go through
  `frontend/src/lib/api.js`, which adds the Supabase access token. Auth is
  Supabase Auth in the browser (`frontend/src/hooks/useAuth.jsx`).
- **Backend**: FastAPI, one process. Five routers mounted in
  `backend/main.py:53-57`; 15 endpoints (graph). Every data access uses one
  service-role Supabase client created at import
  (`backend/services/supabase_client.py`).
- **Agents**: one LangGraph `StateGraph` (`backend/agents/graph.py`) with
  four nodes: planner, test_generator, evaluator, optimizer. There is no
  orchestrator. The graph is a switch: `route_event` reads `state["status"]`
  and runs exactly one node, then ends. Each router call invokes the graph
  once per node it wants. Nodes do their own database I/O and call the LLM
  directly; none is a pure function.
- **Data**: Supabase Postgres with pgvector, six tables, one Storage bucket,
  two database functions. Schema in section 4.
- **Hosting config in the repo**: `Dockerfile` and `render.yaml` for the
  backend, `frontend/vercel.json` for the frontend, CI in
  `.github/workflows/ci.yml` which calls a Render deploy hook on `main`.

Memory at boot (ran, Windows, Python 3.11, not Render): importing
`backend.main` takes the process from 18 MB to 141 MB RSS in 2.7 s, before
any request. With the MCP subprocess that is about 215 MB. Compare this with
Render's current free-tier limit before adding a local model (constraint 5).

## 3. Feature to file map

| Feature | Frontend | Endpoint | Backend |
|---|---|---|---|
| Sign in, sign up, sign out | `pages/Login.jsx`, `hooks/useAuth.jsx`, `lib/supabase.js` | none (Supabase Auth direct) | `backend/dependencies.py` verifies the token on every call |
| Upload a book | `pages/Library.jsx` | `POST /books/upload` | `routers/books.py`, `services/book_ingestor.py`, `services/embeddings.py` |
| Library list, status, delete | `pages/Library.jsx` | `GET /books`, `DELETE /books/{book_id}` | `routers/books.py` |
| Reading speed calibration | `components/CalibrationFlow.jsx`, `pages/ReadingSession.jsx` | `GET /auth/profile`, `POST /auth/profile/calibrate` | `routers/auth.py` |
| Plan and start a session | `pages/ReadingSession.jsx` | `POST /sessions/start` | `routers/sessions.py`, `agents/planner_agent.py` |
| Read with timer and pacing bar | `pages/ReadingSession.jsx` | none | none (client-side) |
| Generate the test | `pages/ReadingSession.jsx` | `POST /sessions/{id}/finish-reading` | `routers/sessions.py`, `agents/test_generator_agent.py`, `services/retriever.py` |
| Take the test | `pages/ComprehensionTest.jsx` | `GET /sessions/{id}`, `POST .../evaluate-single`, `POST .../submit-answers` | `routers/sessions.py`, `agents/evaluator_agent.py`, `agents/optimizer_agent.py` |
| Results | `pages/Results.jsx` | `GET /sessions/{id}`, `GET /books/{book_id}` | `routers/sessions.py`, `routers/books.py` |
| Dashboard | `pages/Dashboard.jsx` | `GET /dashboard` | `routers/dashboard.py` |

Run `python tools/repo_graph/query.py <file>` for the tables and env vars
behind any row.

## 4. LLM and embedding calls

Every call to a banned provider. All of them have to go (constraint 1).

| Where | What | Provider | On failure |
|---|---|---|---|
| `backend/services/llm.py:20` | Creates `ChatGroq(model="llama-3.3-70b-versatile")`, exported under five names (`:25-37`). Raises at import if `GROQ_API_KEY` is unset (`:16-17`). | Groq | backend does not start |
| `backend/agents/planner_agent.py:122-124` | `prompt | planner_llm | parser`, `chain.ainvoke`: how many of the next three chunks, and for how long | Groq | `plan_session` catches it and assigns one chunk for 20 minutes (`:165-189`) |
| `backend/agents/test_generator_agent.py:82-85` | `chain.ainvoke`: five questions | Groq | five generic questions about "the passage" (`:96-104`) |
| `backend/agents/evaluator_agent.py:47-49` | `chain.ainvoke`: grade one answer 0-10. Called once per answer, concurrently (`:118`) | Groq | **scores the answer 10/10** (`:59`) |
| `backend/agents/evaluator_agent.py:67-69` | `chain.ainvoke`: grade all answers in one call. Not called by anything | Groq | 10/10 for every answer (`:77`) |
| `backend/agents/optimizer_agent.py:64-67` | `chain.ainvoke`: next focus duration and an encouraging reason | Groq | 20 minutes, "Fallback duration." |
| `backend/services/embeddings.py:14-17` | Creates `GoogleGenerativeAIEmbeddings`. Raises at import if `GOOGLE_AI_STUDIO_KEY` is unset (`:11-12`) | Google AI Studio | backend does not start |
| `backend/services/embeddings.py:37` | `aembed_query`, wrapped in up to 10 retries with backoff to 60 s | Google AI Studio | raises after the retries |
| `backend/services/book_ingestor.py:143` | `generate_embedding(chunk)`: one call per chunk, sequential | Google AI Studio | ingestion stops, book marked `error` |
| `backend/services/retriever.py:22` | `generate_embedding(query_text)`: embeds the whole passage to find three similar chunks | Google AI Studio | test generator continues without context (`test_generator_agent.py:58-60`) |
| `backend/services/retriever.py:10-15` | `SupabaseVectorStore` retriever. Not called by anything | Google AI Studio | n/a |

One session, start to results, makes at least 8 Groq calls (1 plan, 1 test,
5 grades, 1 pace; more if an answer is edited after it was graded) and 1
embedding call. A book of N chunks makes N embedding calls.

Import order matters for removal: `backend/main.py` imports `routers/books.py`,
which imports `book_ingestor.py`, which imports `embeddings.py`; and
`routers/sessions.py` imports all four agents, which import `llm.py`. Both
modules raise at import without their key, so the keys cannot be removed from
the environment before the imports are.

LangChain itself (`langchain_core`, `langchain_community`) is imported by the
four agents and `retriever.py` only to build prompts, parse output and wrap
the vector store. None of it is needed once the LLM calls go.

## 5. Database schema and RLS

From `supabase/migrations/001_initial.sql` to `004_add_is_calibrated.sql`.
All four are additive.

| Table | Columns that matter | Read by | Written by |
|---|---|---|---|
| `profiles` | `user_id` (PK, FK `auth.users`), `display_name`, `reading_goal_wpm` default 200, `is_calibrated` (004) | planner, `routers/auth.py` | `routers/auth.py` (update); rows created by the `handle_new_user` trigger |
| `books` | `user_id`, `title`, `author`, `file_type` in (pdf, epub), `storage_path`, `total_chunks`, `total_words`, `status` in (processing, ready, error) | `routers/books.py`, `routers/dashboard.py` | `routers/books.py`, `services/book_ingestor.py` |
| `chunks` | `book_id`, `user_id`, `chunk_index`, `word_count`, `content`, `embedding vector(1536)`; ivfflat cosine index, lists = 100 | planner, test generator, evaluator, `routers/sessions.py`, `retriever.py`, `mcp_server.py` | `services/book_ingestor.py` |
| `sessions` | `chunk_start_index`, `chunk_end_index`, `assigned_words`, `focus_duration_minutes`, `actual_duration_minutes`, `status` in (reading, testing, completed, abandoned), `test_questions` jsonb (003) | planner, `routers/sessions.py`, `routers/dashboard.py` | `routers/sessions.py` |
| `test_results` | `session_id`, `chunk_index`, `questions`, `answers` jsonb, `total_score`, `max_score` default 50, `time_taken_seconds` | planner, test generator, evaluator, optimizer, `routers/sessions.py`, `routers/dashboard.py`, `mcp_server.py` | evaluator (insert) |
| `reading_progress` | `last_chunk_index` default 0, `chunks_completed`, `average_score`, `re_read_queue int[]`, `pace_recommendation` jsonb (002); unique (`user_id`, `book_id`) | planner, evaluator, optimizer, `routers/books.py`, `routers/dashboard.py` | planner, evaluator, optimizer: **updates only** |

Functions: `handle_new_user()` (trigger on `auth.users`, `SECURITY DEFINER`,
no `search_path` set) and `match_chunks(query_embedding vector(1536),
match_book_id, match_count)`, called only by `backend/services/retriever.py`.

Storage: private bucket `books`; object path is `<user_id>/<book_id>.<ext>`.

**RLS**: enabled on all six tables (`001_initial.sql:106-111`), one policy
each, `FOR ALL USING (auth.uid() = user_id)` (`:114-119`), plus a Storage
policy on the first path segment (`:130-133`). This protects direct access
with the anon key from the browser. **It does not protect the API**: the
backend uses the service-role key for everything, so access control there is
whatever each query filters on. Section 8 lists where that filter is missing.

Schema findings:

- **`reading_progress` is never populated.** read: no code inserts or
  upserts into it; the only inserts in `backend/` are `test_results`,
  `books`, `sessions` and `chunks`. The three writers update a row only if
  one exists (`evaluator_agent.py:173-181`, `optimizer_agent.py:88-96`,
  `planner_agent.py:57-59`). No migration creates one. dev DB: 0 rows, with
  21 completed sessions and 22 test results. Consequences: the planner
  always sees `last_chunk_index = -1` and plans from chunk 0
  (`planner_agent.py:44-50`, `:83-85`); the re-read queue, rolling average
  and pace recommendation are computed and thrown away; the dashboard shows
  0 chunks completed and no average score.
- If a row did exist with the column default, `last_chunk_index` would be 0
  and the planner would start at chunk 1, skipping chunk 0. The code's own
  default is -1.
- `pace_recommendation.next_chunk_multiplier` is saved by the optimizer but
  no code reads it. Only the Results page reads `pace_recommendation`, for
  `focus_duration_minutes` and `re_read_mode`.
- The evaluator's rolling average and the planner's and optimizer's score
  history filter on `user_id` only, not on the book
  (`evaluator_agent.py:162`, `planner_agent.py:110-118`,
  `optimizer_agent.py:32`), so one book's scores steer another's pacing.
- `vector(1536)` and the ivfflat index are sized for the Google model. A
  local fastembed model has a different dimension, so 2.0 needs a new
  column, index and `match_chunks` variant (additive, constraint 2) and a
  re-embed of the 642 existing chunks.

## 6. Background tasks and restarts

Render's free web services spin down when idle and start again on the next
request, so "lost on restart" is the normal case, not the rare one.

| Task | Started at | If the process dies mid-task | Recovers? |
|---|---|---|---|
| Book ingestion | `routers/books.py:59` | The upload bytes live only in memory (`:28`). Chunks already inserted stay. If it died before chunk 5 the book stays `processing` forever: nothing re-queues it and `status = error` is set only by the exception handler (`book_ingestor.py:176-181`). If it died after chunk 5 the book is `ready` with `total_chunks` set to the full count (`:156-161`) but only some chunks stored, and the planner later reports "Book finished!" early. | **No** |
| Test generation | `routers/sessions.py:118` | `sessions.test_questions` stays null. | **Yes**: `finish-reading` generates them synchronously if missing (`:149-155`) |
| Single-answer grading | `routers/sessions.py:175` | The cached grade is not written. | **Yes**: `submit-answers` grades anything not cached (`evaluator_agent.py:108-120`) |
| MCP subprocess | `backend/main.py:18` | Restarted on the next boot. Nothing depends on it. | n/a |

Also not restart-safe: a session has no expiry. dev DB: of 72 sessions, 39
are still `reading` and 12 `testing`; none is `abandoned`, because nothing
calls the abandon endpoint (section 7).

The ingestion design also works against a fast start: each chunk makes one
remote embedding call in sequence, and `books.status` flips to `ready` after
five.

## 7. Dead and unused code

| What | Evidence |
|---|---|
| `backend/mcp_server.py` and its subprocess | graph: no importer; nothing writes to its stdin. Its `get_reading_history` and `get_comprehension_trend` take a `book_id` and ignore it (`:23`, `:32`) |
| `backend/routers/agent.py` | read: no routes |
| `POST /sessions/{id}/abandon` | graph: no frontend caller. `ReadingSession.jsx:133-135` only navigates away |
| `GET /books/{book_id}/status` | graph: no caller. The Library polls `GET /books` every 3 s instead |
| `evaluate_all_answers` | `evaluator_agent.py:61`; its own comment says the node no longer uses it |
| `get_user_retriever` | `services/retriever.py:5`; no caller |
| `orchestrator_llm`, `AgentState.enriched_context` | `llm.py:25`, `state.py:16`; no reader |
| Eight root `test_*.py` | read: no assertions. They print, call the live LLM, and use hard-coded ids. `test_ingest.py` runs at import, creates a user with the password `password123` (`:17`) and calls the async `ingest_book` without awaiting it. `test_orchestrator.py:3` imports `orchestrator_node`, which does not exist. `test_graph.py` sets `event_type`, which the graph does not read. `pytest` from the repo root would collect them |
| `frontend/src/App.css`, `components/ui/Card.jsx` | graph: nothing imports them |
| `ScoreBadge` | imported by `Library.jsx` but never rendered |
| `frontend/src/assets/hero.png`, `react.svg`, `vite.svg`, `frontend/public/icons.svg` | no reference in `frontend/src` or `index.html` |
| `tailwindcss`, `@tailwindcss/vite` | `frontend/package.json:14,20`; not in `vite.config.js`, no `@import` in any stylesheet |
| `/api` dev proxy | `frontend/vite.config.js:8-9`; `lib/api.js` calls `VITE_API_URL` directly |
| `backend/requirements.txt` | not used by `Dockerfile` or CI; differs from the root file and lists `langchain-mcp-adapters` twice |
| `groq`, `langchain`, `langchain-mcp-adapters`, `lxml` in `requirements.txt` | no file imports them by name (graph: externals). `lxml` may still be needed by `ebooklib` at run time; check before removing |
| `CEREBRAS_API_KEY`, `SAMBANOVA_API_KEY` (`render.yaml`), `FASTEMBED_CACHE` (`.env.example`) | graph: declared, read by no code |
| `frontend/README.md`, `progress.md` | Vite template text; pre-2.0 tracker |

## 8. Security issues

Ordered by severity.

1. **Authentication bypass** (suspected issue 1). Any 36-character string
   with four hyphens is accepted as a user id, in every environment.
   Combined with the service-role client, knowing or guessing a user id is
   full access to that account. The hard-coded id in the root scripts
   (`test_sessions_api.py:8`) is such a credential if that user exists in
   production.
2. **Reading another user's book through `/sessions/start`.** read:
   `routers/sessions.py:97` and the planner's chunk queries
   (`planner_agent.py:62`, `:85`, `:175`) filter on `book_id` only. An
   authenticated user who supplies someone else's `book_id` gets that book's
   chunk text back and a session row under their own id. The other book
   endpoints do filter on `user_id`. Not exercised against a running server;
   this is from the code.
3. **Service-role key for all requests.** RLS never applies to API traffic,
   so every new query has to remember its own `user_id` filter. Issue 2 is
   what forgetting looks like.
4. **Hard-coded Supabase project in the frontend bundle.**
   `frontend/src/lib/supabase.js:3-4` falls back to a fixed project URL and
   publishable key. ran: that project is the same one `.env` points at with
   `ENV=development`. A build with the env vars unset silently talks to it.
   The key is a publishable one, so this is a misconfiguration risk, not a
   leaked secret.
5. **Unbounded upload held in memory.** `routers/books.py:28` reads the
   whole file with no size limit, then keeps the bytes for the background
   task.
6. **Errors returned to the client verbatim.** `dependencies.py:27`,
   `routers/books.py:42,56,123` put exception text in the response.
7. **`handle_new_user` is `SECURITY DEFINER` without a fixed
   `search_path`** (`001_initial.sql:17-24`).
8. **CI cannot import the app.** ran: with `SUPABASE_URL` empty,
   `python -c "import backend.main"` fails with "Supabase URL or Service Key
   not found". `.github/workflows/ci.yml:40` runs `pytest backend/tests/`
   with no secrets, and `test_health.py` imports `backend.main`, so the test
   job presumably fails on every push, alongside the lint job (84 ruff
   errors). `deploy-render` needs both, so pushes to `main` presumably do not
   deploy through CI. Not confirmed on GitHub.

No secrets were found in tracked files.

## 9. Features that must not regress

What a reader can do today, from the code:

1. Sign up, sign in and sign out with email and password; unauthenticated
   visits go to `/login`; a 401 signs the user out.
2. Upload a PDF or EPUB by drag-and-drop or file picker, with title and
   author; see it as processing, then ready, without reloading; delete it.
3. Start reading before the whole book is processed (ready after five
   chunks).
4. One-time reading speed calibration before the first session, stored as
   words per minute.
5. A planned session: chunks chosen for the reader, a focus duration, and a
   one-line reason shown before the timer starts.
6. The reading page: serif reading column with drop cap, start, pause and
   resume timer, pacing bar driven by the reader's speed, distraction-free
   mode with a floating timer, abandon with confirmation.
7. A five-question test: three factual, one inference, one summary; a
   five-minute countdown with a warning in the last minute; move between
   questions; the test opens without a wait because questions were prepared
   during reading.
8. Grading hints (`guidance`) never reach the browser from `finish-reading`
   (`routers/sessions.py:166`). `GET /sessions/{id}` does return the whole
   `test_questions` column, including `guidance` and cached grades
   (`routers/sessions.py:243`), and the test page loads its questions from
   there (`ComprehensionTest.jsx:31-34`), so
   this protection is already broken; 2.0 should keep the intent, not the
   leak.
9. Results: animated score, verdict, the reader's answer and one line of
   feedback per question, then either "next session" or a re-read notice;
   survives a page refresh.
10. Dashboard: day streak, words this week, comprehension over time per
    book, per-book progress, recent feedback.
11. The look: paper and ink palette, Playfair Display, Lora, DM Sans and DM
    Mono, 150 ms fades between pages.

Behaviours that exist in the code but do not work today, so 2.0 must fix
them and not preserve them:

- **Progress never advances** (section 5): every session starts at chunk 0,
  and re-read, averages and pacing are never stored.
- **A failed grade is a perfect grade** (`evaluator_agent.py:59`).
- **Auto-submit at zero sends blank answers.** read:
  `ComprehensionTest.jsx:62-77` creates the timer in an effect that depends
  on `[loading, isSubmitting]` only, so the `handleSubmitAnswers` it calls
  closed over the initial empty `answers`. Not reproduced in a browser.
- **Recorded test time is always 180 s** (`evaluator_agent.py:206`); the
  value the browser sends is dropped.
- **The Library shows "Ch. 1 of N"** for every book
  (`Library.jsx:220`), a placeholder.
- **Display name is collected and discarded** (`Login.jsx:13,24`).
- **Optimizer thresholds are raw points** (`optimizer_agent.py:45-55`),
  correct only when the maximum is 50.

## 10. Risks for the migration

| Risk | Why | What reduces it |
|---|---|---|
| Embedding dimension change | Section 5: column, index and function are fixed at 1536; 642 chunks stored | Additive column and function; re-embed in the background; keep the old column until the new one is verified |
| Memory on Render Free | 141 MB at import plus 73 MB for the unused subprocess, before any model | Remove the subprocess and the LangChain and provider imports first; measure RSS before and after each addition |
| Question and grading quality without an LLM | Today's questions and feedback are free text from a 70B model | Decide the question types an algorithm can generate and grade well before building; keep `guidance`-style hidden answer keys |
| Removing keys before imports | Section 4: both provider modules raise at import | Remove the imports and the modules in the same change as the keys |
| Fixing auth breaks the scripts and any client relying on the bypass | The root scripts authenticate with a raw UUID | Replace them with pytest tests that use the two dev test users from `scripts/dev/create_test_users.py` |
| `reading_progress` fix changes behaviour for existing users | Sessions will start advancing; old sessions all cover chunk 0 | Decide whether to backfill from `sessions` and `test_results` or start fresh |
| No test coverage of the flow | 8 backend tests cover `/health` and `chunk_text` only; no frontend tests; CI presumably red | Pure `decide()` functions with unit tests (the `free-intelligence` skill), then one end-to-end test per endpoint |
| Ingestion dies on spin-down | Section 6 | Local embedding removes the slow remote call; make ingestion resumable from the stored file and the last stored `chunk_index` |
| Port | Suspected issue 7 | Read `$PORT` with a default of 8000 in the container command |

## 11. Files likely to change

| File | Why |
|---|---|
| `backend/services/llm.py` | Delete (constraint 1) |
| `backend/services/embeddings.py` | Replace with a local fastembed model |
| `backend/services/retriever.py` | Drop LangChain; new dimension and function |
| `backend/services/book_ingestor.py` | Local embedding, batching, resumable ingestion, upload limit |
| `backend/agents/planner_agent.py`, `test_generator_agent.py`, `evaluator_agent.py`, `optimizer_agent.py` | Rewrite as pure `decide()` plus thin node; no LLM; create and maintain `reading_progress` |
| `backend/agents/graph.py`, `state.py` | Rewire; add the orchestrator the stack names; add `decisions` |
| `backend/agents/policy.py` (new) | Thresholds in one place |
| `backend/dependencies.py` | Remove the UUID bypass |
| `backend/routers/sessions.py` | Ownership check on `book_id`; stop returning `guidance`; pass `time_taken_seconds`; wire abandon |
| `backend/routers/auth.py` | Stop swallowing errors |
| `backend/routers/agent.py`, `backend/mcp_server.py` | Delete, with the lifespan hook |
| `backend/main.py` | Remove the subprocess; `datetime.utcnow` |
| `supabase/migrations/005_*.sql` onward (new) | New embedding column, index and function; anything `reading_progress` needs |
| `requirements.txt`, `backend/requirements.txt` | Remove banned and unused packages; keep one file; pin versions |
| `.env.example`, `render.yaml` | Remove provider keys; add what 2.0 reads |
| `Dockerfile` | `$PORT`; model cache |
| `.github/workflows/ci.yml` | Make the test job able to import the app; Python version |
| `backend/tests/` and the root `test_*.py` | Real tests in; scripts out |
| `frontend/src/pages/ComprehensionTest.jsx` | Auto-submit bug; question source |
| `frontend/src/pages/ReadingSession.jsx` | Call abandon |
| `frontend/src/pages/Library.jsx` | Real progress in place of the placeholder |
| `frontend/src/pages/Login.jsx`, `hooks/useAuth.jsx` | Send the display name or drop the field |
| `frontend/src/lib/supabase.js` | Remove the hard-coded fallback |
| `frontend/package.json`, `vite.config.js`, `src/App.css`, unused assets | Remove what is not used |
| `README.md`, `frontend/README.md` | Describe 2.0 |

Not expected to change: migrations 001 to 004 (constraint 2), the design
tokens in `frontend/src/index.css` beyond additions, and `tools/repo_graph/`.

## 12. What this audit did not do

- It did not call any endpoint of a running server; the two access-control
  findings and the auto-submit bug are from reading the code.
- It did not look at the production database, the Render service or the
  Vercel project.
- It did not check GitHub for CI results.
- It compared migrations with code, not with the live schema of the dev
  database; the probes were row counts and the length of three embeddings.
- Column-level usage is not in the graph; the column notes in section 5 are
  from reading.
