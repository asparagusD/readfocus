-- 011: indexes for the per-user reads of the API and the agents.
-- Until now sessions, test_results and books had only their primary keys
-- (Postgres does not index foreign keys), so every per-user read scanned
-- the whole table. Each index below serves reads that exist in the code.
-- Additive: indexes only. No table, column, constraint or function changes.

-- GET /dashboard: a user's completed sessions in completion order.
CREATE INDEX IF NOT EXISTS idx_sessions_user_status_completed
    ON public.sessions (user_id, status, completed_at);

-- The optimizer agent: a user's sessions of one book.
CREATE INDEX IF NOT EXISTS idx_sessions_user_book
    ON public.sessions (user_id, book_id);

-- GET /sessions/{id} and a resubmitted test: the result of one session.
CREATE INDEX IF NOT EXISTS idx_test_results_session
    ON public.test_results (session_id);

-- GET /dashboard and the evaluator's rolling average: a user's results by date.
CREATE INDEX IF NOT EXISTS idx_test_results_user_created
    ON public.test_results (user_id, created_at);

-- GET /books and GET /dashboard: a user's books, the dashboard only the ready ones.
CREATE INDEX IF NOT EXISTS idx_books_user_status
    ON public.books (user_id, status);
