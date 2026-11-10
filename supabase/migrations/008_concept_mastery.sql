-- 008: concepts and user_concept_mastery, the knowledge state of a reader.
-- concepts holds the concepts of each book, written at ingestion.
-- user_concept_mastery holds how well a reader knows each concept, updated
-- after every graded test.
-- Additive: two new tables, their indexes and their policies. No existing
-- table, column, index or function is changed.

CREATE TABLE IF NOT EXISTS public.concepts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    concept_key text NOT NULL,
    label text NOT NULL,
    chunk_indices integer[] NOT NULL DEFAULT '{}',
    weight real,
    UNIQUE (user_id, book_id, concept_key)
);

-- concept_key   the slug from backend/nlp/concepts.py, the same wherever
--               the same normalised phrase appears in the book
-- label         the phrase as shown to the reader
-- chunk_indices the chunks of the book that mention the concept
-- weight        0..1, how strongly the concept stands out in the book

CREATE TABLE IF NOT EXISTS public.user_concept_mastery (
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    concept_key text NOT NULL,
    mastery real NOT NULL DEFAULT 0.3 CHECK (mastery >= 0 AND mastery <= 1),
    attempts integer NOT NULL DEFAULT 0,
    correct integer NOT NULL DEFAULT 0,
    last_seen timestamptz,
    next_review timestamptz,
    last_event_id text,
    PRIMARY KEY (user_id, book_id, concept_key)
);

-- mastery       0..1; 0.3 is the prior for a concept not yet tested
-- attempts      graded questions on the concept so far
-- correct       how many of them counted as right
-- last_seen     when the concept was last tested
-- next_review   when it is due again; null until it has been tested
-- last_event_id the grading event applied last, so one test counts once

-- A book's concepts, and a reader's mastery within a book.
CREATE INDEX IF NOT EXISTS idx_concepts_user_book
    ON public.concepts (user_id, book_id);

CREATE INDEX IF NOT EXISTS idx_user_concept_mastery_user_book
    ON public.user_concept_mastery (user_id, book_id);

-- What a reader is due to review, soonest first.
CREATE INDEX IF NOT EXISTS idx_user_concept_mastery_user_next_review
    ON public.user_concept_mastery (user_id, next_review);

-- A signed-in user reads and writes only their own rows; the backend's
-- service role bypasses RLS, as for every other table.
ALTER TABLE public.concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own concepts" ON public.concepts
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.user_concept_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own concept mastery" ON public.user_concept_mastery
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
