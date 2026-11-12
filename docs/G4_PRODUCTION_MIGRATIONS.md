# Gate G4: production migrations 005-015

**Outcome (2026-11-12): G4 PASS, nothing applied, nothing written.**
Production is the dev project `lvfhuszvuiowyeizstru` (the user's answer,
2026-11-12), kept as one shared project by the user's decision. It already
had 001-015, applied during C4-C12 with `supabase db push --linked`.
Read-only checks:

- `npx supabase migration list --linked` (CLI 2.98.2): 001 to 015 on both
  sides.
- `npx supabase db push --linked --dry-run`: "Remote database is up to
  date."
- Service-role selects of every table and column 005-015 add, and calls of
  `match_chunks_local` and `search_chunks_text`: all answered. Buckets
  `books` and `covers` exist. 9 books (8 ready, 1 processing), 645 chunks.
- Backfill dry runs: `backfill_local_embeddings.py` 0 chunks to embed (645
  have one); `backfill_structure.py` 0 books without a toc;
  `backfill_covers.py` 0 books to look up. The only 2 chunks with no
  blocks belong to the book stuck in `processing` since 2026-05-10
  (issue 20). No backfill was run for real: there was nothing to do.
- No backup was taken: no schema change and no data write was needed.
  Supabase Free has no automatic backup, so one is still needed before
  any future write to this project that is not done by the app itself.

The plan below was written before the project was known and is kept as
written; sections 3 to 7 were not needed.

**Status before the outcome: waiting for approval. Nothing had been run against production.**

Written in C14.4 at `ae5e4d0` on `chunk/C14-deploy`, 2026-11-12. The SQL
below is a verbatim copy of `supabase/migrations/005` to `015`; the sha256
prefix of each file is listed so that the approval covers exactly these
bytes. If a file changes before it is applied, this document is out of date.

## What has to be true before anything runs

| # | Condition | Who | State |
|---|---|---|---|
| 1 | The production Supabase project is named by its project ref, and it is **not** the dev project in `.env` | you | open |
| 2 | Read-only pre-checks (section 3) run in the production SQL editor, results pasted back | you | open |
| 3 | A backup of production exists outside the repo, file names and sizes confirmed (section 4) | you | open |
| 4 | You approve, in chat, applying 005-015 as listed here | you | open |
| 5 | You approve, separately, the data backfills (section 7), which write production rows | you | open |

Supabase Free has no automatic backups and no point-in-time recovery
(supabase.com/pricing and /docs/guides/platform/backups, read 2026-11-12),
so the backup in section 4 is the only way back.

## 1. The migrations at a glance

All eleven are additive: no `DROP`, no `ALTER ... DROP`, no `UPDATE` or
`DELETE` of existing rows, no change to an existing column's type.

| File | Lines | sha256 (16) | Adds | Risk on production |
|---|---|---|---|---|
| 005_local_embeddings | 46 | `475f186e21f0a15b` | `chunks.embedding_local vector(384)`, HNSW index, `match_chunks_local()` | Needs pgvector 0.5.0 or later for HNSW (pre-check 3). The index build locks `chunks` against writes while it runs (empty column, so short) |
| 006_chunk_text_search | 42 | `204f02ead73fb73b` | GIN full-text index on `chunks.content`, `search_chunks_text()` | Index build reads every chunk; locks `chunks` against writes for its duration (pre-check 6 gives the row count) |
| 007_question_bank | 51 | `b15611abf0942b18` | `question_bank` table, 2 indexes, RLS policy | `CREATE POLICY` is not idempotent: re-running after a partial run fails (wrapped in a transaction below, so a failure leaves nothing) |
| 008_concept_mastery | 70 | `c69f017853cc7d40` | `concepts`, `user_concept_mastery`, 3 indexes, 2 policies | Same as 007 |
| 009_agent_decisions | 47 | `60b81a651c8e0247` | `agent_decisions`, 2 indexes, read policy | Same as 007 |
| 010_processing_jobs | 49 | `e25a18ad154795ae` | `processing_jobs`, index, read policy; **unique index on `chunks (book_id, chunk_index)`** | **Fails if production has duplicate chunks** (pre-check 5). Same policy note as 007 |
| 011_query_indexes | 25 | `18645ed1fdfed932` | 5 indexes on `sessions`, `test_results`, `books` | Short write locks while each builds |
| 012_book_covers | 20 | `6d771d420e75b695` | `books.cover_url`, `books.cover_source`; public Storage bucket `covers` | `ON CONFLICT DO NOTHING`: a bucket of that name already there is kept as it is (pre-check 8) |
| 013_structured_content | 17 | `aed9176d2316b01d` | `chunks.blocks jsonb`, `books.toc jsonb` | None (nullable columns, no rewrite) |
| 014_reading_position | 13 | `a5f704182a7f8c45` | `reading_progress.position jsonb` | None |
| 015_term_lookups | 40 | `96d08278537d3bbd` | `term_lookups` table, read policy (guarded, idempotent) | None |

What the migrations depend on from 001-004 (pre-check 2 confirms it):
`public.profiles(user_id)`, `public.books(id)`, `public.chunks(id, book_id,
chunk_index, content, user_id)`, `public.sessions(id, user_id, book_id,
status, completed_at)`, `public.test_results(session_id, user_id,
created_at)`, `public.reading_progress`, the `vector` extension, and the
`storage.buckets` table.

## 2. How to apply: SQL editor, not `db push`

Recommended: the Supabase dashboard SQL editor, one migration at a time, in
order, each inside `BEGIN; ... COMMIT;`. A statement that fails rolls the
whole migration back, so a migration is either fully applied or not at all.

`npx supabase db push` is **not** recommended here. It applies every local
migration missing from `supabase_migrations.schema_migrations` on the
remote, expects `<timestamp>_<name>.sql` file names, and production most
likely has no history of 001-004 (they were applied by hand). It would try
to run `001_initial.sql` again, whose `CREATE TABLE` statements have no
`IF NOT EXISTS`. Making it safe needs `supabase migration repair --status
applied` for 001-004 first, which writes to production too. If you still
prefer it, say so and I will write those steps with `--dry-run` first.

## 3. Read-only pre-checks (production SQL editor)

Nothing here writes. Paste the output of each back into the chat.

```sql
-- 1. Which database this is (compare the host in the dashboard URL with .env's dev ref)
select current_database(), current_user, version();

-- 2. Tables and columns 005-015 depend on or add
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles','books','chunks','sessions','test_results','reading_progress',
                     'question_bank','concepts','user_concept_mastery','agent_decisions',
                     'processing_jobs','term_lookups')
order by table_name, ordinal_position;

-- 3. pgvector version (HNSW needs 0.5.0 or later)
select extname, extversion from pg_extension where extname = 'vector';

-- 4. Migration history, if the CLI was ever used (an error here just means there is none)
select version, name from supabase_migrations.schema_migrations order by version;

-- 5. Duplicate chunks that would make 010's unique index fail (expect no rows)
select book_id, chunk_index, count(*) as copies
from public.chunks
group by book_id, chunk_index
having count(*) > 1
order by copies desc
limit 20;

-- 6. Size and row counts (Free plan limit: 500 MB database)
select pg_size_pretty(pg_database_size(current_database())) as database_size,
       (select count(*) from public.profiles)      as profiles,
       (select count(*) from public.books)         as books,
       (select count(*) from public.chunks)        as chunks,
       (select count(*) from public.sessions)      as sessions,
       (select count(*) from public.test_results)  as test_results;

-- 7. Existing policies and indexes on public tables
select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2;
select tablename, indexname from pg_indexes where schemaname = 'public' order by 1, 2;

-- 8. Storage buckets (012 adds 'covers')
select id, public from storage.buckets order by id;

-- 9. Functions 005 and 006 add (expect none yet)
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('match_chunks_local','search_chunks_text');
```

Stop conditions: pre-check 1 shows the dev project; 3 shows pgvector older
than 0.5.0 or missing; 5 returns any row; 6 is above about 400 MB; 2 is
missing a column listed in section 1. Any of these: I stop and propose a
fix before anything else.

## 4. Backup (you run it; I never handle the password)

Needs Docker running (the CLI runs `pg_dump` in a container) and the
production database password (Dashboard > Project Settings > Database).
Use a folder **outside the repo**.

1. `npx supabase --version` and `npx supabase db dump --help`. The CLI's
   flags differ between versions: v3 takes `--db-url`, which its docs call
   deprecated in favour of `--remote`. Use whichever `--help` lists.
2. Take the connection string from Dashboard > Connect (Session pooler,
   port 5432), with your password filled in, as `<PROD_DB_URL>`.
3. Run, from the backup folder:

   ```bash
   npx supabase db dump --db-url "<PROD_DB_URL>" -f readfocus_prod_roles.sql --role-only
   npx supabase db dump --db-url "<PROD_DB_URL>" -f readfocus_prod_schema.sql
   npx supabase db dump --db-url "<PROD_DB_URL>" -f readfocus_prod_data.sql --use-copy --data-only
   ```

4. Tell me the three file names and sizes, and that the schema file
   contains `CREATE TABLE public.chunks` (for example
   `findstr /c:"CREATE TABLE" readfocus_prod_schema.sql`).

The dump holds the database, not Storage files (book PDFs and EPUBs). The
migrations do not touch Storage objects; 012 only inserts a bucket row.

## 5. Apply (after your approval)

For each file, in order 005 to 015: open a new SQL editor tab, paste
`BEGIN;`, the file's SQL from section 8, `COMMIT;`, run it, and paste the
result. After each one I give you its read-only post-check. If one fails,
stop: nothing of that migration is applied, and the ones before it stay.

## 6. Post-checks (read-only, after 015)

```sql
select to_regclass('public.question_bank'), to_regclass('public.concepts'),
       to_regclass('public.user_concept_mastery'), to_regclass('public.agent_decisions'),
       to_regclass('public.processing_jobs'), to_regclass('public.term_lookups');
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and (table_name, column_name) in (('chunks','embedding_local'),('chunks','blocks'),('books','toc'),
       ('books','cover_url'),('books','cover_source'),('reading_progress','position'));
select indexname from pg_indexes where schemaname = 'public' and indexname in (
  'idx_chunks_embedding_local','idx_chunks_content_fts','uq_chunks_book_chunk_index',
  'idx_sessions_user_status_completed','idx_books_user_status');
select count(*) as policies from pg_policies where schemaname = 'public'
  and tablename in ('question_bank','concepts','user_concept_mastery','agent_decisions',
                    'processing_jobs','term_lookups');  -- expect 6
select id, public from storage.buckets where id = 'covers';
-- row counts must equal pre-check 6
select (select count(*) from public.books) as books, (select count(*) from public.chunks) as chunks,
       (select count(*) from public.sessions) as sessions;
```

## 7. Backfills (a separate approval; these write production rows)

Order matters: embeddings first, since question generation and the
retriever read `chunks.embedding_local`.

| # | Script | Writes | Dry run |
|---|---|---|---|
| 1 | `scripts/backfill_local_embeddings.py` | `chunks.embedding_local` where null | `--dry-run` counts |
| 2 | `scripts/backfill_structure.py` | `chunks.blocks`, then `books.toc` (ready books with no toc) | `--dry-run` builds, writes nothing |
| 3 | `scripts/backfill_covers.py` | Storage `covers/ol/*.jpg`, `books.cover_url`, `cover_source`; one Open Library request per book, 1.5 s apart | `--dry-run` lists |
| 4 | Questions and concepts | **No script exists.** Old books get questions on demand: `question_bank._generate_missing` fills the bank for a session's chunks when it starts. A backfill script would be new code (its own subchunk) | n/a |

All three scripts refuse to run unless `ENV=development`; against
production they need `--allow-non-dev`. They read `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` from the environment. To run them you create an
ignored file `.env.prod-backfill` at the repo root (already covered by the
`.env.*` rule in `.gitignore`) with:

```
SUPABASE_URL=https://<prod-ref>.supabase.co
SUPABASE_SERVICE_KEY=<production service-role key>
ENV=production
FASTEMBED_CACHE=.cache/fastembed
```

I load it into the shell for each command, print only the URL's host
before running, and never print the key. Every script runs with
`--dry-run` first; you see its count before the real run.

## 8. The SQL, verbatim

### 005_local_embeddings.sql (sha256 `475f186e21f0a15bffc8e4699ccb1b6a77e8be7bddd7e0865cc85338b49a9e56`)

```sql
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
```

### 006_chunk_text_search.sql (sha256 `204f02ead73fb73b41ced4c11857da94716396c662fad5b1f54889a519e9c23f`)

```sql
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
```

### 007_question_bank.sql (sha256 `b15611abf0942b181a70aadf03d0ee489eac155a782aa3632264f41b1965b4b5`)

```sql
-- 007: question_bank, the precomputed questions for each chunk of a book.
-- Rows are written at ingestion by the question generation agent and read
-- when a test is assembled, so no model runs when a test loads.
-- Additive: one new table, its indexes and its policy. No existing table,
-- column, index or function is changed.

CREATE TABLE IF NOT EXISTS public.question_bank (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    chunk_id uuid NOT NULL REFERENCES public.chunks(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    type text NOT NULL,
    prompt text NOT NULL,
    answer text,
    evidence text,
    key_terms jsonb,
    distractors jsonb,
    difficulty real,
    strategy text NOT NULL,
    quality real,
    prompt_hash text NOT NULL,
    times_used integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- type        what the reader sees on the badge: factual, inference, summary
-- prompt      the question text
-- answer      the reference answer
-- evidence    the sentence(s) of the chunk the question was built from
-- key_terms   array of terms a good answer contains
-- distractors array of wrong options, when the strategy produces them
-- strategy    which generator made the row
-- prompt_hash hash of the normalised prompt, for the uniqueness rule below

-- Test assembly reads one reader's questions for a run of chunks of a book.
CREATE INDEX IF NOT EXISTS idx_question_bank_user_book_chunk
    ON public.question_bank (user_id, book_id, chunk_index);

-- Generating a chunk's questions twice must not store a question twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_question_bank_chunk_strategy_prompt
    ON public.question_bank (chunk_id, strategy, prompt_hash);

-- A signed-in user reads and writes only their own rows; the backend's
-- service role bypasses RLS, as for every other table.
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own question bank" ON public.question_bank
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

### 008_concept_mastery.sql (sha256 `c69f017853cc7d40f44f6a661305520b88072a891a48ee455db9e0554e26954a`)

```sql
-- 008: concepts and user_concept_mastery, the knowledge state of a reader.
-- concepts holds the concepts of each book, written at ingestion.
-- user_concept_mastery holds how well a reader knows each concept, updated
-- after every graded test.
-- Additive: two new tables, their indexes and their policies. No existing
-- table, column, index or function is changed.

CREATE TABLE IF NOT EXISTS public.concepts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    concept_key text NOT NULL,
    label text NOT NULL,
    chunk_indices integer[] NOT NULL DEFAULT '{}',
    weight real,
    UNIQUE (user_id, book_id, concept_key)
);

-- concept_key   the slug from backend/nlp/concepts.py, the same wherever
--               the same normalised phrase appears in the book
-- label         the phrase as shown to the reader
-- chunk_indices the chunks of the book that mention the concept
-- weight        0..1, how strongly the concept stands out in the book

CREATE TABLE IF NOT EXISTS public.user_concept_mastery (
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    concept_key text NOT NULL,
    mastery real NOT NULL DEFAULT 0.3 CHECK (mastery >= 0 AND mastery <= 1),
    attempts integer NOT NULL DEFAULT 0,
    correct integer NOT NULL DEFAULT 0,
    last_seen timestamptz,
    next_review timestamptz,
    last_event_id text,
    PRIMARY KEY (user_id, book_id, concept_key)
);

-- mastery       0..1; 0.3 is the prior for a concept not yet tested
-- attempts      graded questions on the concept so far
-- correct       how many of them counted as right
-- last_seen     when the concept was last tested
-- next_review   when it is due again; null until it has been tested
-- last_event_id the grading event applied last, so one test counts once

-- A book's concepts, and a reader's mastery within a book.
CREATE INDEX IF NOT EXISTS idx_concepts_user_book
    ON public.concepts (user_id, book_id);

CREATE INDEX IF NOT EXISTS idx_user_concept_mastery_user_book
    ON public.user_concept_mastery (user_id, book_id);

-- What a reader is due to review, soonest first.
CREATE INDEX IF NOT EXISTS idx_user_concept_mastery_user_next_review
    ON public.user_concept_mastery (user_id, next_review);

-- A signed-in user reads and writes only their own rows; the backend's
-- service role bypasses RLS, as for every other table.
ALTER TABLE public.concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own concepts" ON public.concepts
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.user_concept_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own concept mastery" ON public.user_concept_mastery
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

### 009_agent_decisions.sql (sha256 `60b81a651c8e024727240d21e0d19b8cc0376825931d87548c048a6ff2a553bd`)

```sql
-- 009: agent_decisions, the audit trail of every agent workflow run.
-- One row per node a run visited, in order: which agent, a summary of what
-- it was given and what it decided, its one-line reason and how long it
-- took. The backend writes them after each run so the app can explain its
-- choices ("Revisiting opportunity cost: you missed it twice").
-- Additive: one new table, its indexes and its policy. No existing table,
-- column, index or function is changed.

CREATE TABLE IF NOT EXISTS public.agent_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE,
    run_id uuid NOT NULL,
    event text NOT NULL CHECK (event IN ('start_session', 'finish_reading', 'submit_answers', 'abandon')),
    step integer NOT NULL CHECK (step >= 1),
    agent text NOT NULL,
    inputs_summary jsonb NOT NULL DEFAULT '{}',
    output_summary jsonb NOT NULL DEFAULT '{}',
    reason text NOT NULL DEFAULT '',
    duration_ms real,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, step)
);

-- session_id     the session the run belongs to; null only if none was made
-- run_id         one workflow run (one event); its rows share it
-- event          which flow ran, as routed in backend/agents/graph.py
-- step           the node's place in the run, from 1
-- agent          planner, test_generator, evaluator, knowledge_state, optimizer
-- inputs_summary, output_summary, reason, duration_ms
--                the node's decisions entry (backend/agents/state.py)

-- What the agents decided for one session, and for one reader and book.
CREATE INDEX IF NOT EXISTS idx_agent_decisions_session
    ON public.agent_decisions (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_user_book
    ON public.agent_decisions (user_id, book_id, created_at);

-- A signed-in reader can read their own rows and nothing else; only the
-- backend's service role, which bypasses RLS, writes them.
ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own agent decisions" ON public.agent_decisions
    FOR SELECT
    USING (auth.uid() = user_id);
```

### 010_processing_jobs.sql (sha256 `e25a18ad154795ae79a10704cc73be23e51a16c86c7fb257151d534d689bc7ae`)

```sql
-- 010: processing_jobs, durable and resumable book ingestion.
-- One row per book and kind of work. The backend stores the job's cursor
-- (the next chunk index to process) after every batch, so a server that
-- restarts or spins down mid-ingestion resumes where it stopped instead of
-- leaving the book in 'processing' forever. A startup sweep resumes jobs
-- whose updated_at is older than a few minutes, up to a capped number of
-- attempts. No queue service: Postgres holds the state.
-- Additive: one new table with its index and policy, and a unique index on
-- chunks so that re-running a batch upserts instead of duplicating rows
-- (dev had no duplicate (book_id, chunk_index) pairs when this was written).

CREATE TABLE IF NOT EXISTS public.processing_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    kind text NOT NULL DEFAULT 'ingest' CHECK (kind IN ('ingest')),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    progress real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    cursor integer NOT NULL DEFAULT 0 CHECK (cursor >= 0),
    error text,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (book_id, kind)
);

-- kind        what the job does; only ingestion so far
-- status      queued -> running -> done, or failed (resumable by the reader)
-- progress    cursor / total chunks, 0 to 1
-- cursor      the next chunk index to process; every chunk before it is
--             stored, embedded and has had its questions generated
-- attempts    how many times a worker has claimed the job
-- updated_at  written by the backend on every change; the sweep treats a
--             running job with an old updated_at as abandoned

-- The startup sweep: queued or running jobs not updated for a while.
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_updated
    ON public.processing_jobs (status, updated_at);

-- A batch that is run again writes the same chunk rows, not new ones.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chunks_book_chunk_index
    ON public.chunks (book_id, chunk_index);

-- A signed-in reader can read their own jobs and nothing else; only the
-- backend's service role, which bypasses RLS, writes them.
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own processing jobs" ON public.processing_jobs
    FOR SELECT
    USING (auth.uid() = user_id);
```

### 011_query_indexes.sql (sha256 `18645ed1fdfed932f4291b598ce19a842432646095ca26ade1bdf3370d9c32b4`)

```sql
-- 011: indexes for the per-user reads of the API and the agents.
-- Until now sessions, test_results and books had only their primary keys
-- (Postgres does not index foreign keys), so every per-user read scanned
-- the whole table. Each index below serves reads that exist in the code.
-- Additive: indexes only. No table, column, constraint or function changes.

-- GET /dashboard: a user's completed sessions in completion order.
CREATE INDEX IF NOT EXISTS idx_sessions_user_status_completed
    ON public.sessions (user_id, status, completed_at);

-- The optimizer agent: a user's sessions of one book.
CREATE INDEX IF NOT EXISTS idx_sessions_user_book
    ON public.sessions (user_id, book_id);

-- GET /sessions/{id} and a resubmitted test: the result of one session.
CREATE INDEX IF NOT EXISTS idx_test_results_session
    ON public.test_results (session_id);

-- GET /dashboard and the evaluator's rolling average: a user's results by date.
CREATE INDEX IF NOT EXISTS idx_test_results_user_created
    ON public.test_results (user_id, created_at);

-- GET /books and GET /dashboard: a user's books, the dashboard only the ready ones.
CREATE INDEX IF NOT EXISTS idx_books_user_status
    ON public.books (user_id, status);
```

### 012_book_covers.sql (sha256 `6d771d420e75b6959fb208a7610578bac4368871fc541f7befa01a4c3f04ba9c`)

```sql
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
```

### 013_structured_content.sql (sha256 `aed9176d2316b01d8f9c69c14d59230f090c8b0a4d4d057f7bd43c67026ec4b5`)

```sql
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
```

### 014_reading_position.sql (sha256 `a5f704182a7f8c453ce9ed513e596e8b95925fc49148223bd937e3d3822c5d6b`)

```sql
-- 014: the reader's precise place in a book (C12.2).
-- Additive: one nullable jsonb column on reading_progress. The table's
-- row-level security is unchanged (a reader owns their own rows).
--
-- position  {chunk_index, block_id, char_offset}: the chunk, the reader
--           block within it (chunks.blocks[].id, "<chunk>.<n>", 013) and
--           the character offset in that block's text. Null until the
--           reader first turns a page. Page numbers are never stored: they
--           depend on screen and text size.
--
-- last_chunk_index stays the planner's cursor; position does not move it.

ALTER TABLE public.reading_progress ADD COLUMN IF NOT EXISTS position jsonb;
```

### 015_term_lookups.sql (sha256 `96d08278537d3bbdb16cb88235a7f12516466769249f27e8629e024cfe0ff6c6`)

```sql
-- 015: shared cache of word and phrase lookups (C12.6).
-- Additive: one new table. It holds no personal data: a row is what the
-- Free Dictionary API or Wikipedia said about a term, shared by all readers.
--
-- term        the normalised term: lower case, or the original casing for a
--             proper noun or name looked up on Wikipedia first
-- lang        language code; only 'en' for now
-- kind        'definition', 'summary', 'ambiguous' or 'none'
-- payload     the compact answer the API returns (backend/services/lookup.py)
-- source      'dictionary', 'wikipedia' or null when nothing was found
-- found       false for a "not found" answer, kept 7 days instead of 90
-- fetched_at  when the answer was fetched; the backend checks its age
--
-- Signed-in users may read; there is no write policy, so only the backend's
-- service role (which bypasses RLS) writes. Failed lookups are never stored.

CREATE TABLE IF NOT EXISTS public.term_lookups (
    term text NOT NULL,
    lang text NOT NULL DEFAULT 'en',
    kind text NOT NULL,
    payload jsonb NOT NULL,
    source text,
    found boolean NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (term, lang)
);

ALTER TABLE public.term_lookups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'term_lookups' AND policyname = 'term_lookups_read_signed_in'
    ) THEN
        CREATE POLICY term_lookups_read_signed_in ON public.term_lookups
            FOR SELECT TO authenticated USING (true);
    END IF;
END
$$;
```
