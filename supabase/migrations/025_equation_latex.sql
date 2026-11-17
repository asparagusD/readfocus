-- 025: PDF equations already turned into LaTeX by Steve (C20.8, docs/STEVE.md S14).
-- Additive: one new table with row-level security and no policy. No table,
-- column or row is dropped or changed.
--
-- A drawn PDF equation has no source, so "Copy as LaTeX" asks Gemini once with
-- a crop of the page. The answer is kept by the file (its sha256, as
-- books.file_sha256), the 1-based page and a hash of the equation's box, so
-- every reader who owns a book with that same file gets it again without a
-- call: each PDF equation costs at most one Gemini call, ever. The backend
-- returns a row only to a reader who owns a book with that file_sha256.
--
-- bbox_hash  the first 32 hex characters of sha256 of the box rounded to one
--            decimal place, "[x0,top,x1,bottom]" (backend/routers/steve_ask.py)
-- model      the Gemini model that answered

CREATE TABLE IF NOT EXISTS public.equation_latex (
    file_sha256 text NOT NULL,
    page integer NOT NULL CHECK (page >= 1),
    bbox_hash text NOT NULL,
    latex text NOT NULL,
    model text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (file_sha256, page, bbox_hash)
);

-- No policy: a reader's own database role can neither read nor write this
-- table; only the backend's service role, which bypasses RLS, does.
ALTER TABLE public.equation_latex ENABLE ROW LEVEL SECURITY;
