# ReadFocus - Progress Tracker

## Current State
- Repository initialized.
- Scaffolding complete for both frontend and backend.
- Frontend: Vite (React) app created with TailwindCSS, Supabase JS client, and React Router DOM.
- Backend: `requirements.txt` added with necessary Python packages (FastAPI, Langchain, etc.).
- Project infrastructure setup: `.env.example` and `README.md` created.

## Tasks
- [x] Setup initial project structure (Frontend/Backend/etc.)
- [x] Define core features for the book reading comprehension app in README
- [x] Add `.gitignore` and root `requirements.txt`
- [x] Database Schema: Write initial Supabase migrations with pgvector
- [x] Create FastAPI backend entry point and initialize LLM models
- [x] Implement backend PDF/EPUB parsing and chunking logic
- [x] Create API endpoints for book upload, polling, and reading progress
- [x] Build LangGraph state graph skeleton and define agent nodes
- [x] Implement Agentic Planner Logic (assigning chunks based on history)
- [ ] Implement agentic comprehension test generator logic
- [ ] Implement adaptive difficulty adjustment logic based on session scores
- [ ] Create UI for file upload and reading session display
- [ ] Integrate authentication using Supabase

## Recent Updates
- Implemented `backend/agents/planner_agent.py` which dynamically assigns reading chunks based on a user's previous comprehension history.
- Extracted `AgentState` into `state.py` to prevent circular dependencies across agent node modules.
- Replaced the planner stub in `graph.py` with the fully-functioning LangChain logic that utilizes `PydanticOutputParser` and standardizes outputs as JSON.
- Handled re-read logic specifically; the planner prioritizes reading queue chunks if comprehension was poor previously.
- Scaffolded the multi-agent system in `backend/agents/graph.py` using LangGraph.
- Defined `AgentState` schema to carry conversation state across the workflow.
- Created async stub functions for the `orchestrator`, `planner`, `test_generator`, `evaluator`, and `optimizer` agents.
- Configured conditional edge routing based on `event_type` and exported the compiled graph as `workflow`.
- Implemented `backend/routers/books.py` with endpoints for uploading books (`/books/upload`), listing books (`/books`), getting details (`/books/{book_id}`), and polling status (`/books/{book_id}/status`).
- Added a FastAPI `BackgroundTask` in the upload route so users receive an immediate response while their book processes in the background.
- Included an HTTPBearer `get_current_user` dependency to protect the routes, including a local dev-bypass to make testing easy via Swagger UI.
- Created `backend/services/book_ingestor.py` with pure Python functions to extract text from PDF and EPUB files.
- Implemented `chunk_text` to smartly group paragraphs into chunks of 400-900 words, maintaining paragraph and sentence boundaries.
- Built `ingest_book` to orchestrate file extraction, chunking, embedding generation, and saving all data sequentially to Supabase.
- Created FastAPI entry point `backend/main.py` with placeholder routers (`/auth`, `/books`, `/sessions`, `/agent`).
- Initialized specialized OpenRouter LangChain LLMs in `services/llm.py` (Orchestrator, Planner, Test, Evaluator, Optimizer, Owl).
- Created backend services for Supabase Python client and OpenRouter Embeddings.
- Written initial Supabase migration `001_initial.sql` defining `profiles`, `books`, `chunks`, `sessions`, `test_results`, and `reading_progress` tables.
- Configured RLS to restrict users to their own data, and set up a private `books` storage bucket.
- Created `match_chunks` function for pgvector similarity search over chunk embeddings.
- Added `.gitignore` to prevent committing sensitive files like `.env` and dependencies.
- Added root `requirements.txt` for easier tracking of backend Python dependencies.
- Created `frontend/` directory and scaffolded Vite React app with necessary dependencies.
- Created `backend/requirements.txt` with required Python packages.
- Added `.env.example` with Supabase and OpenRouter keys.
- Authored `README.md` with project description and user flow.
