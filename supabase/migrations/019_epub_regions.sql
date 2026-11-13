-- 019: EPUB regions in page_regions, anchored by CFI instead of page and box (C18.5b).
-- An EPUB has no pages: its regions come from each spine document's
-- structure (backend/regions/epub.py) and point at their element with an
-- EPUB anchor (docs/ANCHORS.md A1): {kind: "epub", spine_index, path, cfi}.
-- Additive, with one exception the user approved at C18.5b: page and bbox
-- may now be null (an EPUB row has neither). No column is dropped and no
-- existing row changes; every PDF row keeps its page and box, which the new
-- place check requires.

ALTER TABLE public.page_regions ADD COLUMN IF NOT EXISTS anchor jsonb;
ALTER TABLE public.page_regions ADD COLUMN IF NOT EXISTS spine_index integer CHECK (spine_index >= 0);

ALTER TABLE public.page_regions ALTER COLUMN page DROP NOT NULL;
ALTER TABLE public.page_regions ALTER COLUMN bbox DROP NOT NULL;

-- anchor       an EPUB region's place: {kind, spine_index, path, cfi}
-- spine_index  the spine document it is in, from 0; order_in_page counts
--              within that document for EPUB rows

-- A PDF row has a page and a box; an EPUB row has an anchor and a spine item.
ALTER TABLE public.page_regions
    ADD CONSTRAINT page_regions_place_check
    CHECK ((page IS NOT NULL AND bbox IS NOT NULL) OR (anchor IS NOT NULL AND spine_index IS NOT NULL));

-- An EPUB batch run again rewrites its rows, never duplicates them; the reader
-- reads a book's regions spine document by spine document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_page_regions_book_spine_order
    ON public.page_regions (book_id, spine_index, order_in_page) WHERE spine_index IS NOT NULL;
