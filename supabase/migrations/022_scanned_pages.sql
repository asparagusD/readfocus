-- 022: scanned PDF pages and their OCR text (C19.4). Additive: one nullable
-- column on books and one new table; nothing else changes.
--
-- books.scanned_pages  1-based numbers of the PDF pages whose text layer has
--                      fewer than OCR_MIN_PAGE_CHARS visible characters (an
--                      image of a page). Written by ingestion; null until then
--                      and for EPUBs.
-- page_ocr             one row per scanned page the reader's browser has read
--                      with tesseract.js (English): the cleaned page text (the
--                      garble detector's lines dropped), its words with boxes in
--                      PDF points from the page's top-left (ANCHORS A1) and
--                      confidences, for the reader's text layer. Only the
--                      service role writes (POST /books/{id}/ocr checks the
--                      owner); a reader may select their own rows.

ALTER TABLE public.books ADD COLUMN IF NOT EXISTS scanned_pages integer[];

CREATE TABLE IF NOT EXISTS public.page_ocr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  page integer NOT NULL CHECK (page >= 1),
  text text NOT NULL DEFAULT '',
  words jsonb NOT NULL DEFAULT '[]'::jsonb,
  mean_confidence real,
  engine text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, page)
);

ALTER TABLE public.page_ocr ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'page_ocr'
                 AND policyname = 'page_ocr_select_own') THEN
    CREATE POLICY page_ocr_select_own ON public.page_ocr FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
