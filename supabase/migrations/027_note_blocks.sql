-- 027 (C22.1): the notepad's blocks, each anchored to the passage it was written about
-- (docs/ANCHORS.md). One row per block. `anchors` is a list of ANCHORS A1 anchors in reading
-- order, one per PDF page or EPUB spine item (A2): the selection's, or with `scope` 'view'
-- the pages shown (whole-page quads or the page's range CFI, no text). position_start and
-- position_end are A4 sortable positions, checked by the backend against the anchors.
-- `content` is per kind (TipTap JSON, an Excalidraw scene, {latex, image_path},
-- {code, language}, {image_path, caption, source_anchor}), allow-listed by the backend.
-- `version` counts saves for optimistic concurrency (If-Match); deleting sets deleted_at.
-- Images and thumbnails live in the private "notes" bucket under <user_id>/<book_id>/.
-- Additive only: one new table, one new bucket and two policies; nothing existing changes.

CREATE TABLE IF NOT EXISTS public.note_blocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    anchors jsonb NOT NULL CHECK (jsonb_typeof(anchors) = 'array' AND jsonb_array_length(anchors) >= 1),
    scope text NOT NULL DEFAULT 'selection' CHECK (scope IN ('selection', 'view')),
    position_start float8 NOT NULL CHECK (position_start >= 0),
    position_end float8 NOT NULL,
    kind text NOT NULL CHECK (kind IN ('text', 'drawing', 'equation', 'code', 'figure')),
    content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 262144),
    thumbnail_path text,
    annotation_id uuid REFERENCES public.annotations(id) ON DELETE SET NULL,
    region_id uuid REFERENCES public.page_regions(id) ON DELETE SET NULL,
    orphaned boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT note_blocks_positions_ordered CHECK (position_end >= position_start)
);

-- A book's notes in reading order, and the range a page or spread shows.
CREATE INDEX IF NOT EXISTS idx_note_blocks_user_book_position
    ON public.note_blocks (user_id, book_id, position_start);

-- Readers read their own rows; only the backend (service role) writes, after checking the
-- anchors, the content and the version.
ALTER TABLE public.note_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readers read their own note blocks" ON public.note_blocks
    FOR SELECT USING (auth.uid() = user_id);

-- Note images and drawing thumbnails: private, 256 KB, WebP or PNG; each reader's own folder,
-- as the "books" bucket (001). The backend uploads and signs them.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('notes', 'notes', false, 262144, ARRAY['image/webp', 'image/png'])
ON CONFLICT DO NOTHING;

CREATE POLICY "Readers access their own note files" ON storage.objects
    FOR ALL USING (
        bucket_id = 'notes' AND auth.uid()::text = (string_to_array(name, '/'))[1]
    );
