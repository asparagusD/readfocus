-- Enable the pgvector extension to work with embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- TABLE CREATION
-- ============================================================================

-- 1. profiles
CREATE TABLE public.profiles (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name text,
    reading_goal_wpm integer DEFAULT 200,
    created_at timestamptz DEFAULT now()
);

-- Trigger to automatically create a profile when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 2. books
CREATE TABLE public.books (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    title text,
    author text,
    file_type text CHECK (file_type IN ('pdf', 'epub')),
    storage_path text,
    total_chunks integer,
    total_words integer,
    status text CHECK (status IN ('processing', 'ready', 'error')),
    created_at timestamptz DEFAULT now()
);

-- 3. chunks
CREATE TABLE public.chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    chunk_index integer,
    word_count integer,
    content text,
    embedding vector(1536),
    created_at timestamptz DEFAULT now()
);

-- Indexes for chunks
CREATE INDEX idx_chunks_book_index ON public.chunks (book_id, chunk_index);
CREATE INDEX idx_chunks_embedding ON public.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 4. sessions
CREATE TABLE public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
    chunk_start_index integer,
    chunk_end_index integer,
    assigned_words integer,
    focus_duration_minutes integer,
    actual_duration_minutes integer,
    status text CHECK (status IN ('reading', 'testing', 'completed', 'abandoned')),
    started_at timestamptz,
    completed_at timestamptz
);

-- 5. test_results
CREATE TABLE public.test_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    chunk_index integer,
    questions jsonb,
    answers jsonb,
    total_score integer,
    max_score integer DEFAULT 50,
    time_taken_seconds integer,
    created_at timestamptz DEFAULT now()
);

-- 6. reading_progress
CREATE TABLE public.reading_progress (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
    last_chunk_index integer DEFAULT 0,
    chunks_completed integer DEFAULT 0,
    average_score numeric(5,2) DEFAULT 0,
    re_read_queue integer[] DEFAULT '{}',
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, book_id)
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own rows based on user_id
CREATE POLICY "Users can CRUD own profile" ON public.profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can CRUD own books" ON public.books FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can CRUD own chunks" ON public.chunks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can CRUD own sessions" ON public.sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can CRUD own test results" ON public.test_results FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can CRUD own reading progress" ON public.reading_progress FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- STORAGE BUCKET & RLS
-- ============================================================================

INSERT INTO storage.buckets (id, name, public) 
VALUES ('books', 'books', false) 
ON CONFLICT DO NOTHING;

-- RLS for storage (assuming storage_path looks like "user_id/filename.pdf")
CREATE POLICY "Users can access their own book files" ON storage.objects
  FOR ALL USING (
    bucket_id = 'books' AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

-- ============================================================================
-- PGVECTOR FUNCTIONS
-- ============================================================================

-- Function to match chunks using pgvector
CREATE OR REPLACE FUNCTION match_chunks(
    query_embedding vector(1536),
    match_book_id uuid,
    match_count integer
)
RETURNS TABLE (
    id uuid,
    chunk_index integer,
    content text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.chunk_index,
        c.content,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM public.chunks c
    WHERE c.book_id = match_book_id
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
