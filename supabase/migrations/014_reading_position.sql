-- 014: the reader's precise place in a book (C12.2).
-- Additive: one nullable jsonb column on reading_progress. The table's
-- row-level security is unchanged (a reader owns their own rows).
--
-- position  {chunk_index, block_id, char_offset}: the chunk, the reader
--           block within it (chunks.blocks[].id, "<chunk>.<n>", 013) and
--           the character offset in that block's text. Null until the
--           reader first turns a page. Page numbers are never stored: they
--           depend on screen and text size.
--
-- last_chunk_index stays the planner's cursor; position does not move it.

ALTER TABLE public.reading_progress ADD COLUMN IF NOT EXISTS position jsonb;
