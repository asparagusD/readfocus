-- 018: page_regions, the region map of each PDF page, and the "regions" job kind (C18.2b).
-- The regions job reads a book's pages in batches after ingestion (backend/
-- services/region_job.py) and stores each page's blocks here; C18.3 to C18.5
-- classify them as prose, math, code, figure or table.
-- Additive: one new table with its index and policy. The one exception,
-- approved at C18.2b: processing_jobs' CHECK on kind (migration 010 allowed
-- only 'ingest') is replaced by a wider one. No table, column or row is
-- dropped or changed, and every existing row ('ingest') satisfies the new check.

CREATE TABLE IF NOT EXISTS public.page_regions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    page integer NOT NULL CHECK (page >= 1),
    kind text NOT NULL CHECK (kind IN ('block', 'prose', 'math', 'code', 'figure', 'table', 'unreadable')),
    bbox float8[4] NOT NULL CHECK (array_length(bbox, 1) = 4),
    text text NOT NULL DEFAULT '',
    meta jsonb NOT NULL DEFAULT '{}',
    order_in_page integer NOT NULL CHECK (order_in_page >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (book_id, page, order_in_page)
);

-- page           1-based page in the file (docs/ANCHORS.md A1)
-- kind           'block' until classified; then prose, math, code, figure,
--                table, or unreadable (garbled text, never fed to agents)
-- bbox           [x0, top, x1, bottom] in PDF points from the top-left of
--                the page's crop box (A1)
-- text           the region's text, lines joined by newlines
-- meta           what classification and the tools need: line count, fonts,
--                median size, garble score; later math and code details
-- order_in_page  reading order within the page, from 0

-- The reader and the agents read a book's regions page by page.
CREATE INDEX IF NOT EXISTS idx_page_regions_book_page
    ON public.page_regions (book_id, page);

-- A signed-in reader can read their own regions; only the backend's service
-- role, which bypasses RLS, writes them.
ALTER TABLE public.page_regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own page regions" ON public.page_regions
    FOR SELECT
    USING (auth.uid() = user_id);

-- processing_jobs.kind: 'ingest' and now 'regions'. Migration 010 declared
-- the check inline, so its name is Postgres' choice; every CHECK on
-- processing_jobs that reads kind is replaced, whatever it is called.
DO $$
DECLARE
    name text;
BEGIN
    FOR name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.processing_jobs'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%kind%'
    LOOP
        EXECUTE format('ALTER TABLE public.processing_jobs DROP CONSTRAINT %I', name);
    END LOOP;
END $$;

ALTER TABLE public.processing_jobs
    ADD CONSTRAINT processing_jobs_kind_check CHECK (kind IN ('ingest', 'regions'));
