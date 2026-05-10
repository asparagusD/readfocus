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
- [ ] Implement backend PDF/EPUB parsing and chunking logic
- [ ] Build agentic comprehension test generator
- [ ] Implement adaptive difficulty adjustment logic based on session scores
- [ ] Create UI for file upload and reading session display
- [ ] Integrate authentication using Supabase

## Recent Updates
- Written initial Supabase migration `001_initial.sql` defining `profiles`, `books`, `chunks`, `sessions`, `test_results`, and `reading_progress` tables.
- Configured RLS to restrict users to their own data, and set up a private `books` storage bucket.
- Created `match_chunks` function for pgvector similarity search over chunk embeddings.
- Added `.gitignore` to prevent committing sensitive files like `.env` and dependencies.
- Added root `requirements.txt` for easier tracking of backend Python dependencies.
- Created `frontend/` directory and scaffolded Vite React app with necessary dependencies.
- Created `backend/requirements.txt` with required Python packages.
- Added `.env.example` with Supabase and OpenRouter keys.
- Authored `README.md` with project description and user flow.
