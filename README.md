# ReadFocus

**ReadFocus** is a book comprehension app. Upload a PDF, EPUB, Markdown
file or Jupyter notebook, read it as published, take a short test after
each session, and the next session adapts to how you did. Highlights, a
notepad beside the book, a focus mode with server-scored points, and XP,
streaks, badges and weekly leagues come with it.

**What is under the hood, plainly:** ReadFocus's quizzes, grading,
planning and scoring are algorithmic and run on our servers:
LangGraph-orchestrated, policy-driven agents, a small local embedding model
and rule-based knowledge tracing, with every constant in a policy file.
Steve, the optional study assistant, uses Google's Gemini; when you ask
Steve something, the relevant passages and your question are sent to Google
and, on the free tier, may be used to improve Google's products. You can
turn Steve off. Steve never writes a question, grades an answer or scores
a session. $0 API cost: Gemini's free tier, or a reader's own key.
What is stored and sent is on the app's Privacy page (`/privacy`).

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

1. **Upload.** A PDF or EPUB goes to private Supabase Storage (or, if you
   tick "keep on this device", stays in your browser while its text is
   processed on the server). Markdown (alone or zipped with its images)
   and Jupyter notebooks are converted to EPUB on the server, images kept.
   The backend cuts the text into sections of about 600 words, embeds each
   with a local model (all-MiniLM-L6-v2, 384 dimensions, on the CPU),
   extracts its key concepts (YAKE) and pre-builds a bank of questions
   from the section's own sentences: cloze, multiple choice, definition,
   why/how and main idea, each keeping the sentence it came from as
   evidence. The book is readable after the first batch; the rest
   follows. Then a region map splits every page into prose, math, code,
   figure and table regions, so questions and Steve read prose only. A
   cover comes from Open Library. A scanned PDF's pages are read with
   text recognition (tesseract.js) in your browser.
2. **Plan.** When you start, the planner picks today's sections: anything on
   your re-read list first, otherwise sections scored on weak concepts,
   what is unread, difficulty and reviews due, sized to your reading speed
   and recent results. It writes one plain sentence saying why, shown on
   the first page.
3. **Read.** The book opens as published (PDF.js for PDFs, foliate-js for
   EPUBs: images, figures, math and code as printed), two pages on a wide
   screen, one on a phone, with today's suggested pages marked and the
   freedom to read on. Your place is saved as you go. Hover or select a
   word for a card with its definition (Free Dictionary API) or a
   Wikipedia summary. Highlight or underline a passage, and keep notes,
   equations, code and drawings in the notepad beside the book, each tied
   to its place.
4. **Focus (optional).** From chapter 1 on, focus mode runs a stopwatch
   timed by the server. Place a bookmark to end the session; a short quiz
   on the pages read decides whether the points count (10 a focused
   minute, 20 a right answer, nothing below 40%). Final points become XP:
   a daily goal, a streak with earned freezes, badges, and a weekly league
   you can leave.
5. **Ask Steve (optional).** After a consent notice, Steve explains a
   passage, an equation, code or a figure, citing the page or section. He
   is off during a test or quiz, rests when his daily limit or Google's
   free tier runs out, and can be switched off.
6. **Test.** About five questions from the bank for the sections you read,
   in the mix the optimizer last chose; one at a time, timed.
7. **Grade.** Closed questions are string matches. Written answers are
   scored from meaning (cosine to the evidence sentences), key-term
   coverage and relevance, with a confidence that is never above "medium"
   for free text. Feedback comes from templates and quotes the passage; it
   never invents a fact.
8. **Adapt.** Each concept's mastery moves up or down with your answers and
   gets a review date. The optimizer sets the next session's size, time and
   question mix and puts low-scoring sections on a re-read list. Results
   shows the next session's plan and why, for example "Re-reading section 1
   before moving on — your last test on it was low."
9. **Progress.** The dashboard shows your score trend, focus this week,
   your badges, each book's progress and its concepts, weakest first; the
   header carries your level, today's goal and your streak.

Every agent decision is stored with its inputs and reason
(`agent_decisions`), so the app can explain itself.

## Architecture

```
React + Vite (Vercel) ──JWT──► FastAPI (Render, Docker) ──service role──► Supabase
  Library, original view          /books /sessions /dashboard                Postgres + pgvector
  (PDF.js, foliate-js),           /mastery /lookup /auth /focus              Storage, Auth, RLS
  notepad, Test, Results,         /steve /me /badges /leagues
  Dashboard, League               LangGraph: planner · test generator ·
                                  evaluator · knowledge state · optimizer
                                  fastembed all-MiniLM-L6-v2 (local)
                                  region map, EPUB converters
                                  backend/steve/provider.py ──consent──► Google Gemini (Steve only)
```

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite, plain JavaScript, React Router, Recharts, motion (`frontend/`) |
| Backend | Python 3.11, FastAPI, Uvicorn, in Docker (`backend/`, `Dockerfile`) |
| Agents | LangGraph `StateGraph` of five pure `decide()` agents (`backend/agents/`), every constant in `backend/agents/policy.py` |
| Local NLP | fastembed all-MiniLM-L6-v2 (ONNX), YAKE, rapidfuzz (`backend/nlp/`) |
| Data | Supabase Postgres, pgvector, Storage, Auth, row-level security (`supabase/migrations/`, additive only) |
| Reader | PDF.js and foliate-js (vendored), KaTeX, TipTap and Excalidraw for notes, tesseract.js for scanned pages (all in the browser) |
| Free APIs | Free Dictionary API and Wikipedia (word lookup), Open Library (covers) |
| Generative AI | Google Gemini, for Steve only, through `backend/steve/provider.py`, after consent; free tier or the reader's own key (`docs/STEVE.md`) |

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
npm --prefix frontend run check:bundle
npm --prefix frontend run test:unit
npm --prefix frontend run test:e2e
```

At the end of phase 2 (C24): 2006 backend tests, 64 graph tests, 260
frontend unit tests and 313 Playwright tests (on the installed Microsoft
Edge, every API call mocked; Steve's provider is faked, so nothing reaches
Google). ruff and ESLint still report 27 and 3 errors in older code; CI
fails a push that raises either count. The current numbers are in
[CLAUDE.md](CLAUDE.md).

Three live checks use real test users against a real backend and write to
the Supabase project, so they are run by hand, never in CI:

```bash
npm --prefix frontend run test:live
```

```bash
npm --prefix frontend run test:isolation
```

```bash
npm --prefix frontend run test:xp-isolation
```

`test:live` is the full reading journey in a browser (sign in, upload,
read, look up a word, test, results, dashboard, next plan); `test:isolation`
checks with two users that neither can read or change the other's data
through the API or Supabase; `test:xp-isolation` does the same for XP,
badges, progress and leagues (rows seeded for user A with the service key).
Each deletes what it creates. Grader agreement
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
- **English only.** Word lookup, text recognition for scanned pages and
  the question bank are English; Bengali/Bangla books are out of scope.
  Text recognition skips math, code, tables and figures.
- **Steve depends on Google's free tier.** Each reader gets a daily number
  of questions on our key, and Google's own limit is shared by everyone on
  it; when either runs out Steve rests until it resets. A reader's own key
  has its own limits. Free-tier prompts and answers may be used by Google
  to improve its products.
- **No self-service account deletion.** Deleting a book removes its file,
  text, highlights, notes, Steve conversations and focus sessions; removing
  the whole account is done by hand on request (see the Privacy page).
- **Free hosting.** The Render API sleeps after 15 idle minutes and takes
  about a minute to wake (the app shows a warm-up screen); the container has
  0.1 CPU and 512 MB. A whole novel takes minutes to finish ingesting
  (Pride and Prejudice: about 134 s on a desktop; not measured on Render),
  though reading can start after the first batch.
  Supabase Free pauses after a week without activity and has no automatic
  backups; development and production share one project.
- **Not yet deployed:** production still runs the C15 release; phase 2
  (C16-C24) reaches it with the C25 release.
