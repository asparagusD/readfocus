-- 026 (C21.1): highlights and underlines in the original view (docs/ANCHORS.md).
-- One row per annotation. `anchors` is a list of ANCHORS A1 anchors in reading order:
-- one per PDF page or EPUB spine item the selection crosses (A2). position_start and
-- position_end are A4 sortable positions of its first character and last; the backend
-- checks them against the anchors. Colours are the handoff's palette names, never hex
-- (A8). Additive only: one new table, nothing existing changes.

CREATE TABLE IF NOT EXISTS public.annotations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    anchors jsonb NOT NULL CHECK (jsonb_typeof(anchors) = 'array' AND jsonb_array_length(anchors) >= 1),
    position_start float8 NOT NULL CHECK (position_start >= 0),
    position_end float8 NOT NULL,
    style text NOT NULL CHECK (style IN ('highlight', 'underline')),
    color text NOT NULL CHECK (color IN ('honey', 'sage', 'sky', 'rose', 'lilac')),
    text_snapshot text NOT NULL DEFAULT '',
    orphaned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT annotations_positions_ordered CHECK (position_end >= position_start)
);

-- A book's annotations in reading order, and the range a page or section shows.
CREATE INDEX IF NOT EXISTS idx_annotations_user_book_position
    ON public.annotations (user_id, book_id, position_start);

-- Readers read their own rows; only the backend (service role) writes, after checking
-- the anchors and positions.
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readers read their own annotations" ON public.annotations
    FOR SELECT USING (auth.uid() = user_id);
