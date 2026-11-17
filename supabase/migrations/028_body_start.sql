-- 028: where a book's body (chapter 1) begins, for focus mode (C23.1,
-- docs/FOCUS_RULES.md F2). Additive: two nullable columns on books; nothing
-- else changes, and row-level security is as before (owners already have
-- their own books rows).
--
-- body_start         {kind, page | spine_index, title, anchor}: the first
--                    PDF page (1-based) or EPUB spine index of the body, the
--                    outline entry or heading it was found from (or null),
--                    and an A3 point anchor (docs/ANCHORS.md) at its top.
--                    Null until detected (on first request, or by
--                    scripts/backfill_body_start.py).
-- body_start_source  outline, heading, prose (the first page after the
--                    contents with enough prose) or user (the reader chose
--                    "The book starts here"; detection never overwrites it).

ALTER TABLE public.books ADD COLUMN IF NOT EXISTS body_start jsonb
    CHECK (body_start IS NULL OR jsonb_typeof(body_start) = 'object');
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS body_start_source text
    CHECK (body_start_source IN ('outline', 'heading', 'prose', 'user'));
