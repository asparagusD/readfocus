-- 016: the original book file's identity and where it is kept (C17.1).
-- Additive: nullable columns on books, none dropped or changed. Row-level
-- security on books and the private "books" bucket (001) are unchanged: a
-- reader owns their own rows and objects under "<user_id>/".
--
-- file_sha256   hex SHA-256 of the uploaded bytes; anchors (docs/ANCHORS.md
--               A5) use it to tell a re-uploaded or different file.
-- file_bytes    size of the upload; the per-reader cap sums 'cloud' rows.
-- file_format   'pdf' | 'epub' (the same value as file_type, named for the
--               original file; file_type stays for the agents).
-- storage_mode  'cloud': the original is in the bucket at storage_path.
--               'device': the original stays in the reader's browser;
--               storage_path is null and the server kept no copy.
-- page_count    pages of a PDF; null for EPUB until the renderer reports it.

ALTER TABLE public.books ADD COLUMN IF NOT EXISTS file_sha256 text;
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS file_bytes bigint;
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS file_format text
    CHECK (file_format IN ('pdf', 'epub'));
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS storage_mode text NOT NULL DEFAULT 'cloud'
    CHECK (storage_mode IN ('cloud', 'device'));
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS page_count integer;

CREATE INDEX IF NOT EXISTS books_user_storage_mode_idx ON public.books (user_id, storage_mode);
