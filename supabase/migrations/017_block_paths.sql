-- 017: where each reader block sits in an EPUB (C17.6, docs/ANCHORS.md A6).
-- Additive: one nullable jsonb column on chunks; chunks.content and
-- chunks.blocks are unchanged, and row-level security is as before.
--
-- block_paths  [{block_id, spine_index, path}], one per chunks.blocks entry,
--              in the same order: the spine item the block came from and
--              the CFI steps from the document's root to its element
--              ("/4/2"). A CFI maps to a block through it, so agents, Steve
--              and focus ranges can use EPUB anchors. Null for PDFs (their
--              places are pages and quads) and for books ingested before.

ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS block_paths jsonb;
