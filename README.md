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
  - [Multi-Provider LLM Strategy](#multi-provider-llm-strategy)
  - [Database](#database)
- [Project Structure](#project-structure)

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
│  Uvicorn · LangGraph · LangChain                │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │              Agent Graph (LangGraph)       │ │
│  │  Orchestrator → Planner → TestGenerator   │ │
│  │              → Evaluator → Optimizer       │ │
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

Book ingestion runs as a **FastAPI BackgroundTask**: it parses the PDF/EPUB, splits content into ~600-word chunks, generates vector embeddings via Google AI Studio, and stores everything in Supabase.

### Agent Graph

The agent pipeline is built with **LangGraph** and runs as an async state machine:

```
orchestrator_node
    │
    ├── planner_node       (decide chunk assignment and session duration)
    │
    ├── test_generator_node (generate 5 questions + RAG context injection)
    │
    ├── evaluator_node     (grade written answers, produce feedback)
    │
    └── optimizer_node     (tune next session's focus duration)
```

**RAG in the test generator**: before calling the LLM, `get_similar_chunks()` uses pgvector cosine similarity to retrieve the 3 most semantically related chunks from the user's reading history. These are injected into the system prompt, so inference and summary questions explicitly bridge earlier and current content.

**Planner context**: the planner fetches the last 5 completed sessions and their scores via direct SQL queries (not a vector search) to assess whether comprehension is improving, stable, or declining.

### LLM Strategy

To simplify setup and reduce SDK dependencies, all agents have been consolidated to use **Groq** as the sole provider:

| Agent | Provider | Model |
|---|---|---|
| Orchestrator | **Groq** | `llama-3.3-70b-versatile` |
| Planner | **Groq** | `llama-3.3-70b-versatile` |
| Optimizer | **Groq** | `llama-3.3-70b-versatile` |
| Test Generator | **Groq** | `llama-3.3-70b-versatile` |
| Evaluator | **Groq** | `llama-3.3-70b-versatile` |

*Note: Google AI Studio is still used exclusively for generating high-quality text embeddings in `embeddings.py`.*


### Database

Supabase PostgreSQL with **pgvector** for embedding storage and similarity search.

| Table | Purpose |
|---|---|
| `profiles` | User display name, `reading_goal_wpm`, `is_calibrated` |
| `books` | Book metadata, ingestion status |
| `chunks` | 600-word text segments + `vector(1536)` embeddings |
| `sessions` | Reading session records, duration, status |
| `test_results` | Question/answer/score JSON per session |
| `reading_progress` | Per-book progress, average score, re-read queue |

Row Level Security (RLS) is enabled on all tables — users can only access their own data.

---

## Project Structure

```
readfocus/
├── backend/
│   ├── agents/
│   │   ├── graph.py              # LangGraph state machine
│   │   ├── orchestrator_agent.py
│   │   ├── planner_agent.py
│   │   ├── test_generator_agent.py
│   │   ├── evaluator_agent.py
│   │   └── optimizer_agent.py
│   ├── routers/
│   │   ├── auth.py               # Profile + calibration
│   │   ├── books.py              # Upload + ingest
│   │   ├── sessions.py           # Session lifecycle
│   │   └── dashboard.py          # Aggregated stats
│   ├── services/
│   │   ├── llm.py                # Multi-provider LLM instances
│   │   ├── embeddings.py         # Google AI Studio embeddings
│   │   ├── retriever.py          # pgvector RAG retriever
│   │   ├── book_ingestor.py      # PDF/EPUB parsing + chunking
│   │   └── supabase_client.py
│   ├── Dockerfile
│   ├── render.yaml
│   └── main.py
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Library.jsx
│   │   │   ├── ReadingSession.jsx
│   │   │   ├── ComprehensionTest.jsx
│   │   │   ├── Results.jsx
│   │   │   └── Dashboard.jsx
│   │   ├── components/
│   │   │   ├── CalibrationFlow.jsx
│   │   │   ├── Layout.jsx
│   │   │   └── ui/
│   │   └── lib/
│   │       ├── api.js
│   │       └── supabase.js
│   ├── vercel.json
│   └── vite.config.js
├── supabase/
│   └── migrations/
├── Makefile
└── requirements.txt
```
