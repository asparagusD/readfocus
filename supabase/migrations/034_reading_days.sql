-- 034: words read per reader, book and day (C32.2, GitHub issue 4).
-- Additive: one new table, an index and row-level security; no existing table changes.
--
-- reading_days  one row per reader, book and calendar day (in the reader's time zone, as
--               user_progress.timezone, GAMIFICATION G6): the words of the chunks the reader
--               first reached that day, added as their saved place moves forward
--               (PUT /books/{id}/position). The Dashboard's "words read this week" is the
--               sum since Monday. A jump of more than a few chunks (the contents, a link)
--               moves the place but counts no words.
--
-- Readers read their own rows; only the backend (service role) writes. Rows go with their
-- reader or their book (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS public.reading_days (
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    day date NOT NULL,
    words integer NOT NULL DEFAULT 0 CHECK (words >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, book_id, day)
);

CREATE INDEX IF NOT EXISTS idx_reading_days_user_day ON public.reading_days (user_id, day);

ALTER TABLE public.reading_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Readers read their own reading days" ON public.reading_days
    FOR SELECT USING (auth.uid() = user_id);
