-- 006: full-text search over chunks, the text half of the hybrid retriever
-- (backend/services/retriever.py). Additive: one index and one function.

-- No stored column: the index is on the expression the function uses.
CREATE INDEX IF NOT EXISTS idx_chunks_content_fts
    ON public.chunks USING gin (to_tsvector('english', coalesce(content, '')));

-- The chunks of one book that match a web-style query ("light or energy",
-- "\"exact phrase\"", "-excluded"), best rank first. SECURITY INVOKER and the
-- auth.uid() test work as in 005: a signed-in user only gets their own rows;
-- the backend's service role is narrowed by p_book_id alone.
CREATE OR REPLACE FUNCTION public.search_chunks_text(
    query_text text,
    match_count integer,
    p_book_id uuid
)
RETURNS TABLE (
    id uuid,
    chunk_index integer,
    content text,
    rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    SELECT
        c.id,
        c.chunk_index,
        c.content,
        ts_rank(
            to_tsvector('english', coalesce(c.content, '')),
            websearch_to_tsquery('english', query_text)
        ) AS rank
    FROM public.chunks c
    WHERE c.book_id = p_book_id
      AND (auth.uid() IS NULL OR c.user_id = auth.uid())
      AND to_tsvector('english', coalesce(c.content, '')) @@ websearch_to_tsquery('english', query_text)
    ORDER BY rank DESC, c.chunk_index
    LIMIT match_count;
$$;
