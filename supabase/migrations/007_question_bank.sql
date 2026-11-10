-- 007: question_bank, the precomputed questions for each chunk of a book.
-- Rows are written at ingestion by the question generation agent and read
-- when a test is assembled, so no model runs when a test loads.
-- Additive: one new table, its indexes and its policy. No existing table,
-- column, index or function is changed.

CREATE TABLE IF NOT EXISTS public.question_bank (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    chunk_id uuid NOT NULL REFERENCES public.chunks(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    type text NOT NULL,
    prompt text NOT NULL,
    answer text,
    evidence text,
    key_terms jsonb,
    distractors jsonb,
    difficulty real,
    strategy text NOT NULL,
    quality real,
    prompt_hash text NOT NULL,
    times_used integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- type        what the reader sees on the badge: factual, inference, summary
-- prompt      the question text
-- answer      the reference answer
-- evidence    the sentence(s) of the chunk the question was built from
-- key_terms   array of terms a good answer contains
-- distractors array of wrong options, when the strategy produces them
-- strategy    which generator made the row
-- prompt_hash hash of the normalised prompt, for the uniqueness rule below

-- Test assembly reads one reader's questions for a run of chunks of a book.
CREATE INDEX IF NOT EXISTS idx_question_bank_user_book_chunk
    ON public.question_bank (user_id, book_id, chunk_index);

-- Generating a chunk's questions twice must not store a question twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_question_bank_chunk_strategy_prompt
    ON public.question_bank (chunk_id, strategy, prompt_hash);

-- A signed-in user reads and writes only their own rows; the backend's
-- service role bypasses RLS, as for every other table.
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own question bank" ON public.question_bank
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
