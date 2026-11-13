-- 021: where a converted book came from (C19.2c). Additive: one nullable
-- column on books; no row changes and row-level security is as before.
--
-- source_format  'md' (a Markdown file or a .zip of Markdown and images) or
--                'ipynb' (a Jupyter notebook). The server converted it to an
--                EPUB 3, which is the book's stored file (file_type and
--                file_format 'epub'). Null for a PDF or EPUB uploaded as is.
--                Written by POST /books/upload after the insert; until this
--                migration is applied that write fails, is logged, and the
--                book is kept without the label.

ALTER TABLE public.books ADD COLUMN IF NOT EXISTS source_format text;
