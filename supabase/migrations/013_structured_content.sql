-- 013: structured blocks and a table of contents for the book reader (C12.1).
-- The C12.1 prompt named this file 011_structured_content.sql; 011 and 012
-- are taken, so it is 013.
-- Additive: two nullable jsonb columns. chunks.content is unchanged and is
-- still what the agents read.
--
-- chunks.blocks  ordered list of {id, type, text, marks[, continued]}:
--                type is chapter, heading, paragraph, quote or list_item;
--                marks are [{start, end, kind}] with kind em or strong,
--                offsets into text; continued is true when the block goes
--                on from the previous chunk. Null until built.
-- books.toc      [{title, chunk_index, block_id}] in reading order; [] when
--                the book has no chapters found, null until built.
-- Both inherit the existing row-level security of their tables.

ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS blocks jsonb;
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS toc jsonb;
