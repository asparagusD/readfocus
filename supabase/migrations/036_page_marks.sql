-- 036 (C39.1, GitHub issue 23): Edge's markup tools on the page (docs/ANCHORS.md A12).
--
-- 1. page_marks: ink strokes and text boxes drawn on a PDF page (your decision D2: PDFs only; the
--    backend refuses an EPUB). `data` holds a stroke's points ([x, y, pressure], PDF points from
--    the page's top-left, A1) and its width, or a text box's place, width, text and font size; the
--    backend checks its shape and bounds. `position` is A4's sortable position of the mark's top
--    (page * 1e6 + floor(top) * 1e2), so a page range is one index scan. Colours are names, never
--    hex (A8). Same ownership and RLS as 026: readers read their own rows, only the backend writes.
-- 2. annotations.comment: Edge's "Add comment" on a highlight (your decision D1), plain text.
-- 3. annotations' CHECK on color is replaced by Edge's set (your decision D3): the five names
--    migration 026 allowed come first and stay valid, so every existing row keeps its colour. The
--    same swap 018 made for processing_jobs.kind.
--
-- Additive: one new table, one new nullable column, a wider CHECK. No table, column or row is
-- dropped or changed.

CREATE TABLE IF NOT EXISTS public.page_marks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('ink', 'text')),
    page integer NOT NULL CHECK (page >= 1),
    position float8 NOT NULL CHECK (position >= 0),
    color text NOT NULL CHECK (color IN ('ink', 'poppy', 'amber', 'fern', 'ocean', 'berry', 'plum')),
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 65536),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- A book's marks in reading order, and the pages a view loads.
CREATE INDEX IF NOT EXISTS idx_page_marks_user_book_position
    ON public.page_marks (user_id, book_id, position);

ALTER TABLE public.page_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readers read their own page marks" ON public.page_marks
    FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.annotations
    ADD COLUMN IF NOT EXISTS comment text CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 1000);

-- Migration 026 declared the colour check inline, so its name is Postgres' choice; every CHECK on
-- annotations that reads color is replaced, whatever it is called (as 018 did for processing_jobs).
DO $$
DECLARE
    name text;
BEGIN
    FOR name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.annotations'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%color%'
    LOOP
        EXECUTE format('ALTER TABLE public.annotations DROP CONSTRAINT %I', name);
    END LOOP;
END $$;

ALTER TABLE public.annotations
    ADD CONSTRAINT annotations_color_check CHECK (color IN ('honey', 'sage', 'sky', 'rose', 'lilac', 'poppy',
        'amber', 'fern', 'ocean', 'berry'));
