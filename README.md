# ReadFocus

**ReadFocus** is an agentic book comprehension app. You upload a PDF or EPUB, and the system does the rest — chunking the book, scheduling personalised reading sessions, administering timed comprehension tests, evaluating your answers with AI, and adapting the next session's pace based on your performance.

It is a quiet, serious tool for serious readers.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
  - [Frontend](#frontend)
  - [Backend](#backend)
  - [Agent Graph](#agent-graph)
  - [No Paid AI](#no-paid-ai)
  - [Database](#database)

---

## How It Works

1. **Upload** a PDF or EPUB book. The backend chunks it into ~600-word segments and generates vector embeddings. To ensure a zero-wait experience, the first 5 chunks are processed immediately to mark the book as `ready`, while the remaining chunks continue processing in the background.
2. **Start a session**. An AI planner agent reads your reading history and comprehension scores to decide how many chunks to assign and how long the session should be.
3. **Read** in a distraction-free environment. A pacing bar shows your estimated position in the text. As soon as you click "Start Reading", a background task begins generating the 5 comprehension questions concurrently.
4. **Take the test**. Since questions are pre-generated in the background, the test loads instantly. You are given 5 timed questions — 3 factual recall, 1 inference, 1 summary.
5. **Get evaluated**. To eliminate the final submission delay, your written answers are evaluated in the background as you navigate between questions. When you hit submit, any remaining ungraded answers are evaluated concurrently.
6. **Review your progress**. The Dashboard shows your comprehension score trend over time, reading streak, words read this week, book-by-book progress, and recent evaluator feedback quotes.


---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  React Frontend                  │
│  Library · ReadingSession · ComprehensionTest   │
│  Results · Dashboard                            │
│  Vite · React Router · Recharts                 │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS / REST
┌──────────────────▼──────────────────────────────┐
│              FastAPI Backend                     │
│  /books  /sessions  /auth  /dashboard           │
│  Uvicorn · LangGraph (no LLM)                   │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │              Agent Graph (LangGraph)       │ │
│  │  Planner · TestGenerator · Evaluator       │ │
│  │      → KnowledgeState → Optimizer          │ │
│  └────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│                 Supabase                         │
│  PostgreSQL · pgvector · Storage · Auth · RLS   │
└─────────────────────────────────────────────────┘
```

### Frontend

Built with **React + Vite**. All pages follow a strict editorial minimalist design system — warm ink tones, Playfair Display headings, Lora body text, and DM Sans UI elements. Animations are capped at 200ms ease-out.

| Page | Route | Purpose |
|---|---|---|
| Library | `/` | Upload books, see ingestion status, start sessions |
| ReadingSession | `/read/:bookId` | Timed reading with progress bar and distraction-free mode |
| ComprehensionTest | `/test/:sessionId` | 5-question timed test (5-minute countdown) |
| Results | `/results/:sessionId` | Animated score reveal and per-question feedback |
| Dashboard | `/dashboard` | Progress charts, streak, words read, feedback quotes |

### Backend

Built with **FastAPI** and **Uvicorn**. All routes require a Supabase JWT token (verified via `get_current_user` dependency).

| Router | Prefix | Responsibilities |
|---|---|---|
| `books.py` | `/books` | Upload, ingest, chunk, embed |
| `sessions.py` | `/sessions` | Start session, finish reading, submit answers |
| `auth.py` | `/auth` | Profile fetch, reading speed calibration |
| `dashboard.py` | `/dashboard` | Aggregated stats for the Dashboard page |

Book ingestion runs as a **FastAPI BackgroundTask**: it parses the PDF/EPUB, splits content into ~600-word chunks, embeds them with a local model (fastembed, all-MiniLM-L6-v2, 384 dimensions), extracts their concepts and fills the question bank, and stores everything in Supabase.

### Agent Graph

Five algorithmic agents run as **LangGraph** nodes, chained by event from
`__start__` (`backend/agents/graph.py`; diagram in
[`docs/repo-graph/AGENT_GRAPH.md`](docs/repo-graph/AGENT_GRAPH.md)):

| Event | Flow |
|---|---|
| `start_session` | planner |
| `finish_reading` | test_generator |
| `submit_answers` | evaluator → knowledge_state → optimizer → planner (the optimizer is skipped when every grade is low-confidence) |
| `abandon` | optimizer |

Each agent is a pure `decide()` with its constants in `backend/agents/policy.py`;
the node around it reads state, persists, and appends one entry to the run's
decisions, which are stored in `agent_decisions` so the app can explain its
choices.

| Agent | Decides |
|---|---|
| Planner | Which sections next: the re-read queue first, otherwise sections scored on weak concepts, unread, difficulty fit and due reviews; minutes, question mix and a one-line reason |
| Test generator | The session's test from the precomputed question bank |
| Evaluator | Grades answers locally (exact and fuzzy matching, embedding similarity, key terms) with a confidence |
| Knowledge state | Per-concept mastery and review dates |
| Optimizer | The next pace and re-read queue from rolling scores, abandonment and per-question-type failure, within fixed bounds |

### No Paid AI

ReadFocus calls no LLM or embedding API and needs no AI provider key: every
decision above is an algorithm or runs on the local embedding model. The
only external services are Supabase and, for word lookup, the free
Dictionary API and Wikipedia.


### Database

Supabase PostgreSQL with **pgvector** for embedding storage and similarity search.

| Table | Purpose |
|---|---|
| `profiles` | User display name, `reading_goal_wpm`, `is_calibrated` |
| `books` | Book metadata, ingestion status |
| `chunks` | 600-word text segments + local `vector(384)` embeddings (the old `vector(1536)` column is unused) |
| `sessions` | Reading session records, duration, status |
| `test_results` | Question/answer/score JSON per session |
| `reading_progress` | Per-book progress, average score, re-read queue, pace recommendation |
| `question_bank` | Precomputed questions per chunk |
| `concepts`, `user_concept_mastery` | A book's concepts and the reader's mastery of each |
| `agent_decisions` | What each agent decided, per workflow run |

Row Level Security (RLS) is enabled on all tables — users can only access their own data.

