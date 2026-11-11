-- 012: book covers from Open Library (C11.2, design decision D5).
-- The C11.2 prompt named this file 010_book_covers.sql; 010 and 011 are
-- taken, so it is 012.
-- Additive: two nullable columns on books and one new Storage bucket.
--
-- cover_url    public URL of the cover in the `covers` bucket, or null
-- cover_source 'openlibrary' (found and stored), 'none' (Open Library has
--              no cover), 'error' (the lookup failed; the backfill may try
--              again), or null (not looked up yet)

ALTER TABLE public.books ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS cover_source text;

-- Covers are public book art, copied once per Open Library cover ID
-- (ol/<cover_id>-M.jpg) and shared by every book with that cover. A public
-- bucket serves them by URL with no read policy; only the service role
-- (the backend) writes, which bypasses RLS, so no write policy either.
INSERT INTO storage.buckets (id, name, public)
VALUES ('covers', 'covers', true)
ON CONFLICT DO NOTHING;
