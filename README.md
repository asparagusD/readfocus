# ReadFocus

**ReadFocus** is a book comprehension app. Upload a PDF or EPUB, read it in
paced sessions in a reader that turns like a book, take a short test after
each session, and the next session adapts to how you did.

**What is under the hood, plainly:** LangGraph-orchestrated, policy-driven
agents + on-device transformer embeddings + knowledge tracing; no
generative AI, $0 API cost. Every decision (what to read next, which
questions to ask, how to grade, how fast to go) is an algorithm with its
constants in one file, or a cosine from a small local embedding model. No
LLM writes, grades or explains anything.

- Live: [readfocus-lake.vercel.app](https://readfocus-lake.vercel.app)
  (frontend on Vercel Hobby, API on Render Free; the first request after
  15 idle minutes waits for the API to wake)
- Architecture in depth: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Measured numbers: [docs/BENCHMARKS.md](docs/BENCHMARKS.md)
- Deployment and free-tier limits: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Tests and checks](#tests-and-checks)
- [Limitations](#limitations)

## How it works

1. **Upload.** The file goes to private Supabase Storage. The backend cuts
   the text into sections of about 600 words, embeds each with a local
   model (all-MiniLM-L6-v2, 384 dimensions, on the CPU), extracts its key
   concepts (YAKE) and pre-builds a bank of questions from the section's
   own sentences: cloze, multiple choice, definition, why/how and main
   idea, each keeping the sentence it came from as evidence. The book is
   readable after the first batch, in seconds; the rest follows. A cover
   comes from Open Library.
2. **Plan.** When you start, the planner picks today's sections: anything on
   your re-read list first, otherwise sections scored on weak concepts,
   what is unread, difficulty and reviews due, sized to your reading speed
   and recent results. It writes one plain sentence saying why, shown on
   the first page.
3. **Read.** Today's sections open as a paginated book (two pages on a wide
   screen, one on a phone) with page turns, a ribbon bookmark, a contents
   drawer, text size, light and dark paper, and a session timer. Your
   place is saved as you go. Hover or select a word for a card with its
   definition (Free Dictionary API) or a Wikipedia summary.
4. **Test.** About five questions from the bank for the sections you read,
   in the mix the optimizer last chose; one at a time, timed.
5. **Grade.** Closed questions are string matches. Written answers are
   scored from meaning (cosine to the evidence sentences), key-term
   coverage and relevance, with a confidence that is never above "medium"
   for free text. Feedback comes from templates and quotes the passage; it
   never invents a fact.
6. **Adapt.** Each concept's mastery moves up or down with your answers and
   gets a review date. The optimizer sets the next session's size, time and
   question mix and puts low-scoring sections on a re-read list. Results
   shows the next session's plan and why, for example "Re-reading section 1
   before moving on — your last test on it was low."
7. **Progress.** The dashboard shows your score trend, streak, words this
   week, each book's progress and its concepts, weakest first.

Every agent decision is stored with its inputs and reason
(`agent_decisions`), so the app can explain itself.

## Architecture

```
React + Vite (Vercel) ──JWT──► FastAPI (Render, Docker) ──service role──► Supabase
  Library, Reader, Test,         /books /sessions /dashboard                Postgres + pgvector
  Results, Dashboard             /mastery /lookup /auth                      Storage, Auth, RLS
                                 LangGraph: planner · test generator ·
                                 evaluator · knowledge state · optimizer
                                 fastembed all-MiniLM-L6-v2 (local)
```

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite, plain JavaScript, React Router, Recharts, motion (`frontend/`) |
| Backend | Python 3.11, FastAPI, Uvicorn, in Docker (`backend/`, `Dockerfile`) |
| Agents | LangGraph `StateGraph` of five pure `decide()` agents (`backend/agents/`), every constant in `backend/agents/policy.py` |
| Local NLP | fastembed all-MiniLM-L6-v2 (ONNX), YAKE, rapidfuzz (`backend/nlp/`) |
| Data | Supabase Postgres, pgvector, Storage, Auth, row-level security (`supabase/migrations/`, additive only) |
| Free APIs | Free Dictionary API and Wikipedia (word lookup), Open Library (covers) |

The agent graph, each agent's input and output, the event flows, the data
model, the reader and the lookup path are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The generated diagram is
[docs/repo-graph/AGENT_GRAPH.md](docs/repo-graph/AGENT_GRAPH.md), and a map
of every file is [docs/repo-graph/REPO_MAP.md](docs/repo-graph/REPO_MAP.md).

## Local setup

Needs Python 3.11, Node 22 or later, and a Supabase project with the
migrations in `supabase/migrations/` applied.

```bash
python -m venv .venv
```

```powershell
.\.venv\Scripts\Activate.ps1
```

```bash
pip install -r requirements-dev.txt
```

```bash
npm --prefix frontend ci
```

Copy `.env.example` to `.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_KEY`, `ENV=development`, optional `FRONTEND_URL` and
`FASTEMBED_CACHE`) and `frontend/.env.example` to `frontend/.env`
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_API_URL=http://localhost:8000`). The service-role key stays in the
backend's `.env`; never put it in a `VITE_` variable.

```bash
make dev-backend
```

```bash
make dev-frontend
```

The API is on http://127.0.0.1:8000 (`/health` says `model_ready` once the
embedding model is loaded; the first start downloads it, about 90 MB, into
`.cache/fastembed`), the app on http://localhost:5173.

## Tests and checks

The standard checks run offline and never touch Supabase:

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
npm --prefix frontend run test:e2e
```

At the end of the sprint: 811 backend tests, 62 graph tests, 70 frontend
unit tests and 103 Playwright tests (on the installed Microsoft Edge, every
API call mocked). ruff and ESLint still report 27 and 4 errors in older
code; CI fails a push that raises either count. The current numbers are in
[CLAUDE.md](CLAUDE.md).

Two live checks use real test users against a real backend and write to
the Supabase project, so they are run by hand, never in CI:

```bash
npm --prefix frontend run test:live
```

```bash
npm --prefix frontend run test:isolation
```

`test:live` is the full reading journey in a browser (sign in, upload,
read, look up a word, test, results, dashboard, next plan); `test:isolation`
checks with two users that neither can read or change the other's data
through the API or Supabase. Both delete what they create. Grader agreement
with the labelled answers: `python scripts/eval_grader.py`.

## Limitations

- **The grader cannot tell a reversal from a right answer.** A written
  answer that says the opposite of the passage in its own words is close
  in meaning and scores high (cosine 0.78–1.0 in the fixtures). Free-text
  grades are therefore capped at medium confidence and the feedback never
  says "correct". Paraphrases that use few of the passage's key terms
  score too low. On 34 hand-labelled answers the grader agrees with the
  label (within 0.25) 26 times (76.5%): every correct, partial, empty,
  off-topic and copied answer, but 1 of 5 paraphrases and 1 of 5 wrong
  answers. The labels are one person's and the constants were tuned on
  them; a search over 3,060 settings found nothing that generalises
  better (C15.3).
- **Questions are extractive.** They are built from the book's own
  sentences, so they test recall and close reading, not synthesis across
  chapters. A section with few informative sentences gets fewer good
  questions.
- **Embeddings see the start of a section.** all-MiniLM-L6-v2 reads 256
  tokens (about 190 words), so a 600-word section is represented by its
  opening.
- **Knowledge tracing is a rule, not a fitted model.** Mastery moves by fixed
  steps (`MASTERY_GAIN`, `MASTERY_LOSS`) with spaced reviews; there is no
  Bayesian Knowledge Tracing and nothing is learned from other readers.
- **Text only, English only.** No OCR: a scanned PDF has no text to
  read. Word lookup is English.
- **Free hosting.** The Render API sleeps after 15 idle minutes and takes
  about a minute to wake (the app shows a warm-up screen); the container has
  0.1 CPU and 512 MB. A whole novel takes minutes to finish ingesting
  (Pride and Prejudice: about 134 s on a desktop; not measured on Render),
  though reading can start after the first batch.
  Supabase Free pauses after a week without activity and has no automatic
  backups; development and production share one project.
- **Not yet deployed at the end of the sprint:** the closing-page fix and
  the session ownership check (C15.1, C15.2) reach production with the C15
  release.
