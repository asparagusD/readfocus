-- 005: column, index and match function for local 384-dimension embeddings
-- (backend/nlp/embedder.py, all-MiniLM-L6-v2). Additive: the 1536-dimension
-- column, its ivfflat index and the 1536-dimension match function from 001
-- are left as they are.

ALTER TABLE public.chunks
    ADD COLUMN IF NOT EXISTS embedding_local vector(384);

-- HNSW needs no row count to tune and can be built on an empty column.
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_local
    ON public.chunks USING hnsw (embedding_local vector_cosine_ops);

-- The chunks of one book nearest to the query vector, by cosine similarity.
-- SECURITY INVOKER: the row-level-security policy on chunks applies to the
-- caller, so a signed-in user only ever gets their own rows. The explicit
-- auth.uid() test says the same thing in the query itself; a caller with no
-- user (the backend's service role, which bypasses RLS) is not narrowed.
-- Rows that have no local embedding yet are skipped.
CREATE OR REPLACE FUNCTION public.match_chunks_local(
    query_embedding vector(384),
    match_count integer,
    p_book_id uuid
)
RETURNS TABLE (
    id uuid,
    chunk_index integer,
    content text,
    similarity float
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
        1 - (c.embedding_local <=> query_embedding) AS similarity
    FROM public.chunks c
    WHERE c.book_id = p_book_id
      AND c.embedding_local IS NOT NULL
      AND (auth.uid() IS NULL OR c.user_id = auth.uid())
    ORDER BY c.embedding_local <=> query_embedding
    LIMIT match_count;
$$;
