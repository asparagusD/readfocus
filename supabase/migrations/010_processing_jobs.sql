-- 010: processing_jobs, durable and resumable book ingestion.
-- One row per book and kind of work. The backend stores the job's cursor
-- (the next chunk index to process) after every batch, so a server that
-- restarts or spins down mid-ingestion resumes where it stopped instead of
-- leaving the book in 'processing' forever. A startup sweep resumes jobs
-- whose updated_at is older than a few minutes, up to a capped number of
-- attempts. No queue service: Postgres holds the state.
-- Additive: one new table with its index and policy, and a unique index on
-- chunks so that re-running a batch upserts instead of duplicating rows
-- (dev had no duplicate (book_id, chunk_index) pairs when this was written).

CREATE TABLE IF NOT EXISTS public.processing_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    kind text NOT NULL DEFAULT 'ingest' CHECK (kind IN ('ingest')),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    progress real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    cursor integer NOT NULL DEFAULT 0 CHECK (cursor >= 0),
    error text,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (book_id, kind)
);

-- kind        what the job does; only ingestion so far
-- status      queued -> running -> done, or failed (resumable by the reader)
-- progress    cursor / total chunks, 0 to 1
-- cursor      the next chunk index to process; every chunk before it is
--             stored, embedded and has had its questions generated
-- attempts    how many times a worker has claimed the job
-- updated_at  written by the backend on every change; the sweep treats a
--             running job with an old updated_at as abandoned

-- The startup sweep: queued or running jobs not updated for a while.
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_updated
    ON public.processing_jobs (status, updated_at);

-- A batch that is run again writes the same chunk rows, not new ones.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chunks_book_chunk_index
    ON public.chunks (book_id, chunk_index);

-- A signed-in reader can read their own jobs and nothing else; only the
-- backend's service role, which bypasses RLS, writes them.
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own processing jobs" ON public.processing_jobs
    FOR SELECT
    USING (auth.uid() = user_id);
