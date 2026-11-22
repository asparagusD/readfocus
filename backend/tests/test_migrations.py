"""Static checks on supabase/migrations: additive only, and 005's contract.

These read the SQL files; they do not connect to a database. Applying 005
to the dev project and the row-level-security check are run by hand and
recorded in docs/PROGRESS.md.
"""

import re
from pathlib import Path

import pytest

from backend.nlp import embedder

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
DESTRUCTIVE = re.compile(
    r"\b(DROP|TRUNCATE|DELETE\s+FROM|RENAME|ALTER\s+COLUMN|SET\s+DATA\s+TYPE)\b", re.IGNORECASE
)


def sql_without_comments(path: Path) -> str:
    return re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))


def migration_005() -> str:
    return sql_without_comments(MIGRATIONS / "005_local_embeddings.sql")


# The one DROP allowed: 018 replaces processing_jobs' CHECK on kind with a wider one
# (your decision at C18.2b). No table, column or row is dropped or changed.
KIND_CHECK_SWAP = "EXECUTE format('ALTER TABLE public.processing_jobs DROP CONSTRAINT %I', name);"


# 019 lets an EPUB region have no page and no box (it has an anchor instead): the user's decision at
# C18.5b. No column is dropped and no row changes.
PLACE_NULLABLE = ("ALTER TABLE public.page_regions ALTER COLUMN page DROP NOT NULL;",
                  "ALTER TABLE public.page_regions ALTER COLUMN bbox DROP NOT NULL;")


# 035 widens books' CHECK on status with 'deleting' (your decision at C35.2b): the same swap as 018.
STATUS_CHECK_SWAP = "DROP CONSTRAINT IF EXISTS books_status_check,"


# 036 widens annotations' CHECK on color with Edge's set (your decision D3 at C39, 2026-11-21): 018's swap.
COLOR_CHECK_SWAP = "EXECUTE format('ALTER TABLE public.annotations DROP CONSTRAINT %I', name);"


@pytest.mark.parametrize("path", sorted(MIGRATIONS.glob("*.sql")), ids=lambda p: p.name)
def test_migrations_are_additive(path):
    sql = sql_without_comments(path)
    if path.name == "018_page_regions.sql":
        sql = re.sub(r"\s+", " ", sql).replace(KIND_CHECK_SWAP, "")
    if path.name == "019_epub_regions.sql":
        sql = re.sub(r"\s+", " ", sql)
        for statement in PLACE_NULLABLE:
            sql = sql.replace(statement, "")
    if path.name == "035_book_deleting.sql":
        sql = re.sub(r"\s+", " ", sql).replace(STATUS_CHECK_SWAP, "")
    if path.name == "036_page_marks.sql":
        sql = re.sub(r"\s+", " ", sql).replace(COLOR_CHECK_SWAP, "")
    found = DESTRUCTIVE.findall(sql)
    assert not found, f"{path.name} has destructive statements: {found}"


def test_005_adds_a_column_of_the_embedder_dimension():
    sql = migration_005()
    assert re.search(
        rf"ALTER TABLE public\.chunks\s+ADD COLUMN IF NOT EXISTS embedding_local vector\({embedder.EMBEDDING_DIM}\)",
        sql,
    )


def test_005_indexes_the_column_with_hnsw_cosine():
    assert re.search(
        r"CREATE INDEX IF NOT EXISTS \w+\s+ON public\.chunks USING hnsw \(embedding_local vector_cosine_ops\)",
        migration_005(),
    )


def test_005_match_function_has_the_agreed_signature():
    sql = re.sub(r"\s+", " ", migration_005())
    assert (
        "FUNCTION public.match_chunks_local( query_embedding vector(384), "
        "match_count integer, p_book_id uuid )" in sql
    )


def test_005_match_function_respects_row_level_security():
    sql = migration_005()
    assert "SECURITY INVOKER" in sql
    assert "SECURITY DEFINER" not in sql
    assert "auth.uid()" in sql
    assert re.search(r"SET search_path\s*=", sql)


def test_006_adds_full_text_search_that_respects_row_level_security():
    sql = re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "006_chunk_text_search.sql"))
    assert "CREATE INDEX IF NOT EXISTS idx_chunks_content_fts ON public.chunks USING gin (to_tsvector(" in sql
    assert "FUNCTION public.search_chunks_text( query_text text, match_count integer, p_book_id uuid )" in sql
    assert "websearch_to_tsquery('english', query_text)" in sql
    assert "SECURITY INVOKER" in sql and "SECURITY DEFINER" not in sql
    assert "auth.uid()" in sql and "c.book_id = p_book_id" in sql


def migration_007() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "007_question_bank.sql"))


QUESTION_BANK_COLUMNS = {
    "id": "uuid PRIMARY KEY",
    "user_id": "uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE",
    "book_id": "uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE",
    "chunk_id": "uuid NOT NULL REFERENCES public.chunks(id) ON DELETE CASCADE",
    "chunk_index": "integer NOT NULL",
    "type": "text NOT NULL",
    "prompt": "text NOT NULL",
    "answer": "text",
    "evidence": "text",
    "key_terms": "jsonb",
    "distractors": "jsonb",
    "difficulty": "real",
    "strategy": "text NOT NULL",
    "quality": "real",
    "prompt_hash": "text NOT NULL",
    "times_used": "integer NOT NULL DEFAULT 0",
    "created_at": "timestamptz NOT NULL DEFAULT now()",
}


def test_007_creates_question_bank_with_the_agreed_columns():
    sql = migration_007()
    body = re.search(r"CREATE TABLE IF NOT EXISTS public\.question_bank \((.*?)\);", sql)
    assert body, "question_bank is not created with IF NOT EXISTS"
    columns = {}
    for line in re.split(r",(?![^(]*\))", body.group(1)):
        name, _, definition = line.strip().partition(" ")
        columns[name] = definition
    assert list(columns) == list(QUESTION_BANK_COLUMNS)
    for name, start in QUESTION_BANK_COLUMNS.items():
        assert columns[name].startswith(start), f"{name}: {columns[name]}"


def test_007_rows_belong_to_their_user_under_row_level_security():
    sql = migration_007()
    assert "ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY" in sql
    assert re.search(
        r"CREATE POLICY \"[^\"]+\" ON public\.question_bank FOR ALL "
        r"USING \(auth\.uid\(\) = user_id\) WITH CHECK \(auth\.uid\(\) = user_id\)",
        sql,
    )
    assert "SECURITY DEFINER" not in sql


def test_007_has_the_lookup_index_and_the_uniqueness_rule():
    sql = migration_007()
    assert re.search(
        r"CREATE INDEX IF NOT EXISTS \w+ ON public\.question_bank \(user_id, book_id, chunk_index\)", sql
    )
    assert re.search(
        r"CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON public\.question_bank \(chunk_id, strategy, prompt_hash\)",
        sql,
    )


def test_007_touches_no_existing_table():
    sql = migration_007()
    assert "ALTER TABLE public.question_bank" in sql
    assert re.findall(r"ALTER TABLE public\.(\w+)", sql) == ["question_bank"]
    assert not re.search(r"\b(INSERT|UPDATE)\b", sql)


def migration_008() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "008_concept_mastery.sql"))


def table_definition(sql: str, table: str) -> dict[str, str]:
    """The lines of a CREATE TABLE body, keyed by their first word (a column name, or UNIQUE / PRIMARY)."""
    body = re.search(rf"CREATE TABLE IF NOT EXISTS public\.{table} \((.*?)\);", sql)
    assert body, f"{table} is not created with IF NOT EXISTS"
    lines = (line.strip().partition(" ") for line in re.split(r",(?![^(]*\))", body.group(1)))
    return {name: definition for name, _, definition in lines}


OWNER = "uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE"
BOOK = "uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE"
CONCEPT_TABLES = {
    "concepts": {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "user_id": OWNER,
        "book_id": BOOK,
        "concept_key": "text NOT NULL",
        "label": "text NOT NULL",
        "chunk_indices": "integer[] NOT NULL DEFAULT '{}'",
        "weight": "real",
        "UNIQUE": "(user_id, book_id, concept_key)",
    },
    "user_concept_mastery": {
        "user_id": OWNER,
        "book_id": BOOK,
        "concept_key": "text NOT NULL",
        "mastery": "real NOT NULL DEFAULT 0.3 CHECK (mastery >= 0 AND mastery <= 1)",
        "attempts": "integer NOT NULL DEFAULT 0",
        "correct": "integer NOT NULL DEFAULT 0",
        "last_seen": "timestamptz",
        "next_review": "timestamptz",
        "last_event_id": "text",
        "PRIMARY": "KEY (user_id, book_id, concept_key)",
    },
}


@pytest.mark.parametrize("table", sorted(CONCEPT_TABLES))
def test_008_creates_the_table_with_the_agreed_columns_and_key(table):
    definition = table_definition(migration_008(), table)
    assert list(definition) == list(CONCEPT_TABLES[table])
    for name, expected in CONCEPT_TABLES[table].items():
        assert definition[name] == expected, f"{table}.{name}: {definition[name]}"


@pytest.mark.parametrize("table", sorted(CONCEPT_TABLES))
def test_008_rows_belong_to_their_user_under_row_level_security(table):
    sql = migration_008()
    assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in sql
    assert re.search(
        rf"CREATE POLICY \"[^\"]+\" ON public\.{table} FOR ALL "
        r"USING \(auth\.uid\(\) = user_id\) WITH CHECK \(auth\.uid\(\) = user_id\)",
        sql,
    )
    assert "SECURITY DEFINER" not in sql


def test_008_has_the_lookup_indexes():
    sql = migration_008()
    for table, columns in (
        ("concepts", "user_id, book_id"),
        ("user_concept_mastery", "user_id, book_id"),
        ("user_concept_mastery", "user_id, next_review"),
    ):
        assert re.search(rf"CREATE INDEX IF NOT EXISTS \w+ ON public\.{table} \({columns}\)", sql), (table, columns)


def test_008_touches_no_existing_table():
    sql = migration_008()
    assert sorted(set(re.findall(r"ALTER TABLE public\.(\w+)", sql))) == sorted(CONCEPT_TABLES)
    assert sorted(re.findall(r"CREATE TABLE IF NOT EXISTS public\.(\w+)", sql)) == sorted(CONCEPT_TABLES)
    assert not re.search(r"\b(INSERT|UPDATE)\b", sql)


def test_005_leaves_the_old_column_and_function_alone():
    sql = migration_005()
    assert not re.search(r"\bmatch_chunks\s*\(", sql)
    assert not re.search(r"\bembedding\b(?!_local)", sql.replace("query_embedding", ""))


# --- 009: agent_decisions, the audit trail of each workflow run (C8.6) ----------------------

def migration_009() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "009_agent_decisions.sql"))


AGENT_DECISIONS = {
    "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    "user_id": OWNER,
    "book_id": BOOK,
    "session_id": "uuid REFERENCES public.sessions(id) ON DELETE CASCADE",
    "run_id": "uuid NOT NULL",
    "event": "text NOT NULL CHECK (event IN ('start_session', 'finish_reading', 'submit_answers', 'abandon'))",
    "step": "integer NOT NULL CHECK (step >= 1)",
    "agent": "text NOT NULL",
    "inputs_summary": "jsonb NOT NULL DEFAULT '{}'",
    "output_summary": "jsonb NOT NULL DEFAULT '{}'",
    "reason": "text NOT NULL DEFAULT ''",
    "duration_ms": "real",
    "created_at": "timestamptz NOT NULL DEFAULT now()",
    "UNIQUE": "(run_id, step)",
}


def test_009_creates_agent_decisions_with_the_agreed_columns():
    definition = table_definition(migration_009(), "agent_decisions")
    assert list(definition) == list(AGENT_DECISIONS)
    for name, expected in AGENT_DECISIONS.items():
        assert definition[name] == expected, f"agent_decisions.{name}: {definition[name]}"


def test_009_readers_see_only_their_own_decisions_and_cannot_write():
    sql = migration_009()
    assert "ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(r"CREATE POLICY \"[^\"]+\" ON public\.agent_decisions FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert policies == ["SELECT"]  # only the backend's service role writes
    assert "SECURITY DEFINER" not in sql


def test_009_has_the_lookup_indexes_and_touches_no_existing_table():
    sql = migration_009()
    for columns in ("session_id, created_at", "user_id, book_id, created_at"):
        assert re.search(rf"CREATE INDEX IF NOT EXISTS \w+ ON public\.agent_decisions \({columns}\)", sql), columns
    assert set(re.findall(r"ALTER TABLE public\.(\w+)", sql)) == {"agent_decisions"}
    assert re.findall(r"CREATE TABLE IF NOT EXISTS public\.(\w+)", sql) == ["agent_decisions"]
    assert not re.search(r"\b(INSERT|UPDATE)\b", sql)


# --- 010: processing_jobs, durable ingestion jobs (C9.1) -------------------------------------

def migration_010() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "010_processing_jobs.sql"))


PROCESSING_JOBS = {
    "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    "user_id": OWNER,
    "book_id": BOOK,
    "kind": "text NOT NULL DEFAULT 'ingest' CHECK (kind IN ('ingest'))",
    "status": "text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed'))",
    "progress": "real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1)",
    "cursor": "integer NOT NULL DEFAULT 0 CHECK (cursor >= 0)",
    "error": "text",
    "attempts": "integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)",
    "updated_at": "timestamptz NOT NULL DEFAULT now()",
    "UNIQUE": "(book_id, kind)",
}


def test_010_creates_processing_jobs_with_the_agreed_columns():
    definition = table_definition(migration_010(), "processing_jobs")
    assert list(definition) == list(PROCESSING_JOBS)
    for name, expected in PROCESSING_JOBS.items():
        assert definition[name] == expected, f"processing_jobs.{name}: {definition[name]}"


def test_010_readers_see_only_their_own_jobs_and_cannot_write():
    sql = migration_010()
    assert "ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(r"CREATE POLICY \"[^\"]+\" ON public\.processing_jobs FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert policies == ["SELECT"]  # only the backend's service role writes
    assert "SECURITY DEFINER" not in sql


def test_010_indexes_the_sweep_and_makes_chunk_upserts_idempotent():
    sql = migration_010()
    assert re.search(r"CREATE INDEX IF NOT EXISTS \w+ ON public\.processing_jobs \(status, updated_at\)", sql)
    assert re.search(r"CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON public\.chunks \(book_id, chunk_index\)", sql)
    assert re.findall(r"CREATE TABLE IF NOT EXISTS public\.(\w+)", sql) == ["processing_jobs"]
    assert set(re.findall(r"ALTER TABLE public\.(\w+)", sql)) == {"processing_jobs"}
    assert not re.search(r"\b(INSERT|UPDATE)\b", sql)


# --- 011: indexes for the per-user reads (C9.4) ------------------------------------------------

def migration_011() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "011_query_indexes.sql"))


@pytest.mark.parametrize("table, columns", [
    ("sessions", "user_id, status, completed_at"),
    ("sessions", "user_id, book_id"),
    ("test_results", "session_id"),
    ("test_results", "user_id, created_at"),
    ("books", "user_id, status"),
])
def test_011_indexes_the_filters_the_api_uses(table, columns):
    assert re.search(rf"CREATE INDEX IF NOT EXISTS \w+ ON public\.{table} \({columns}\)", migration_011())


def test_011_only_adds_indexes():
    sql = migration_011()
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    assert len(statements) == 5
    assert all(s.startswith("CREATE INDEX IF NOT EXISTS") for s in statements)


def test_012_adds_cover_columns_and_a_public_covers_bucket():
    sql = sql_without_comments(MIGRATIONS / "012_book_covers.sql")
    for column in ("cover_url", "cover_source"):
        assert re.search(rf"ALTER\s+TABLE\s+public\.books\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+{column}\s+text;", sql)
    assert re.search(r"INSERT\s+INTO\s+storage\.buckets.*'covers',\s*'covers',\s*true", sql, re.DOTALL)
    assert "ON CONFLICT DO NOTHING" in sql
    assert "CREATE TABLE" not in sql.upper()


def test_013_adds_blocks_and_toc_as_nullable_jsonb():
    sql = sql_without_comments(MIGRATIONS / "013_structured_content.sql")
    assert re.search(r"ALTER\s+TABLE\s+public\.chunks\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+blocks\s+jsonb;", sql)
    assert re.search(r"ALTER\s+TABLE\s+public\.books\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+toc\s+jsonb;", sql)
    assert "NOT NULL" not in sql.upper() and "CREATE TABLE" not in sql.upper()


def test_014_adds_reading_progress_position_as_nullable_jsonb():
    sql = sql_without_comments(MIGRATIONS / "014_reading_position.sql")
    assert re.search(r"ALTER\s+TABLE\s+public\.reading_progress\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+position\s+jsonb;", sql)
    assert "NOT NULL" not in sql.upper() and "POLICY" not in sql.upper() and "CREATE TABLE" not in sql.upper()


def test_015_creates_a_shared_term_cache_readable_by_signed_in_users_only():
    sql = sql_without_comments(MIGRATIONS / "015_term_lookups.sql")
    assert re.search(r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.term_lookups", sql)
    assert re.search(r"PRIMARY\s+KEY\s*\(term,\s*lang\)", sql)
    assert "ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(r"CREATE\s+POLICY\s+\w+\s+ON\s+public\.term_lookups\s+FOR\s+(\w+)\s+TO\s+(\w+)", sql)
    assert policies == [("SELECT", "authenticated")]  # no write policy: only the service role writes


# --- 018: page_regions and the "regions" job kind (C18.2b) -----------------------------------

def migration_018() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "018_page_regions.sql"))


PAGE_REGIONS = {
    "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    "user_id": OWNER,
    "book_id": BOOK,
    "page": "integer NOT NULL CHECK (page >= 1)",
    "kind": "text NOT NULL CHECK (kind IN ('block', 'prose', 'math', 'code', 'figure', 'table', 'unreadable'))",
    "bbox": "float8[4] NOT NULL CHECK (array_length(bbox, 1) = 4)",
    "text": "text NOT NULL DEFAULT ''",
    "meta": "jsonb NOT NULL DEFAULT '{}'",
    "order_in_page": "integer NOT NULL CHECK (order_in_page >= 0)",
    "created_at": "timestamptz NOT NULL DEFAULT now()",
    "UNIQUE": "(book_id, page, order_in_page)",
}


def test_018_creates_page_regions_with_the_agreed_columns():
    definition = table_definition(migration_018(), "page_regions")
    assert list(definition) == list(PAGE_REGIONS)
    for name, expected in PAGE_REGIONS.items():
        assert definition[name] == expected, f"page_regions.{name}: {definition[name]}"


def test_018_readers_see_only_their_own_regions_and_cannot_write():
    sql = migration_018()
    assert "ALTER TABLE public.page_regions ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(r"CREATE POLICY \"[^\"]+\" ON public\.page_regions FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert policies == ["SELECT"]
    assert re.search(r"CREATE INDEX IF NOT EXISTS \w+ ON public\.page_regions \(book_id, page\)", sql)


def test_018_widens_the_job_kind_check_and_drops_nothing_else():
    sql = migration_018()
    assert KIND_CHECK_SWAP in sql
    assert re.search(r"ADD CONSTRAINT processing_jobs_kind_check CHECK \(kind IN \('ingest', 'regions'\)\)", sql)
    assert sql.count("DROP") == 1


# --- 019: EPUB regions anchored by CFI (C18.5b) -------------------------------------------------

def migration_019() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "019_epub_regions.sql"))


def test_019_adds_anchor_and_spine_index_and_relaxes_only_page_and_bbox():
    sql = migration_019()
    assert "ALTER TABLE public.page_regions ADD COLUMN IF NOT EXISTS anchor jsonb;" in sql
    assert "ALTER TABLE public.page_regions ADD COLUMN IF NOT EXISTS spine_index integer CHECK (spine_index >= 0);" in sql
    for statement in PLACE_NULLABLE:
        assert statement in sql
    assert sql.count("DROP") == 2 and "DROP COLUMN" not in sql and "DROP TABLE" not in sql


def test_019_every_row_has_a_page_and_box_or_an_anchor_and_spine_item():
    sql = migration_019()
    assert re.search(r"ADD CONSTRAINT page_regions_place_check CHECK \(\(page IS NOT NULL AND bbox IS NOT NULL\) "
                     r"OR \(anchor IS NOT NULL AND spine_index IS NOT NULL\)\)", sql)
    assert re.search(r"CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON public\.page_regions \(book_id, spine_index, "
                     r"order_in_page\) WHERE spine_index IS NOT NULL", sql)


# --- 020: prose-only text per chunk (C18.6b) ------------------------------------------------------

def test_020_adds_prose_anchors_and_garbled_count_to_chunks_only():
    sql = re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "020_chunk_prose.sql"))
    assert "ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS prose text;" in sql
    assert "ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS anchors jsonb;" in sql
    assert ("ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS garbled_sentences integer "
            "CHECK (garbled_sentences >= 0);") in sql
    assert sql.count(";") == 3


# --- 023: Steve's consent, settings, key, usage and threads (C20.1) -------------------------------

def migration_023() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "023_steve.sql"))


STEVE_PROFILE_COLUMNS = (
    "steve_enabled boolean NOT NULL DEFAULT true",
    "steve_consent_at timestamptz",
    "steve_consent_version text",
    "steve_key_cipher text",
    "steve_key_last4 text CHECK (steve_key_last4 IS NULL OR char_length(steve_key_last4) = 4)",
)
STEVE_TABLES = {
    "steve_usage": {
        "user_id": OWNER,
        "day": "date NOT NULL",
        "requests": "integer NOT NULL DEFAULT 0 CHECK (requests >= 0)",
        "PRIMARY": "KEY (user_id, day)",
    },
    "steve_threads": {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "user_id": OWNER,
        "book_id": BOOK,
        "created_at": "timestamptz NOT NULL DEFAULT now()",
    },
    "steve_messages": {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "thread_id": "uuid NOT NULL REFERENCES public.steve_threads(id) ON DELETE CASCADE",
        "user_id": OWNER,
        "role": "text NOT NULL CHECK (role IN ('reader', 'steve'))",
        "content": "text NOT NULL",
        "anchor": "jsonb",
        "citations": "jsonb NOT NULL DEFAULT '[]'",
        "model": "text",
        "tokens_in": "integer CHECK (tokens_in >= 0)",
        "tokens_out": "integer CHECK (tokens_out >= 0)",
        "created_at": "timestamptz NOT NULL DEFAULT now()",
    },
}


def test_023_adds_the_steve_columns_to_profiles():
    sql = migration_023()
    for column in STEVE_PROFILE_COLUMNS:
        assert f"ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS {column};" in sql, column


@pytest.mark.parametrize("table", sorted(STEVE_TABLES))
def test_023_creates_the_table_with_the_agreed_columns_and_key(table):
    definition = table_definition(migration_023(), table)
    assert list(definition) == list(STEVE_TABLES[table])
    for name, expected in STEVE_TABLES[table].items():
        assert definition[name] == expected, f"{table}.{name}: {definition[name]}"


@pytest.mark.parametrize("table", sorted(STEVE_TABLES))
def test_023_readers_only_read_their_own_rows_and_never_write_them(table):
    sql = migration_023()
    assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(rf"CREATE POLICY \"[^\"]+\" ON public\.{table} FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert "SELECT" in policies
    assert not {"ALL", "INSERT", "UPDATE"} & set(policies)  # only the backend's service role writes
    assert "SECURITY DEFINER" not in sql


def test_023_only_the_backend_changes_a_readers_steve_columns():
    sql = migration_023()
    assert re.search(r"CREATE OR REPLACE TRIGGER \w+ BEFORE INSERT OR UPDATE ON public\.profiles "
                     r"FOR EACH ROW EXECUTE FUNCTION public\.steve_profile_guard\(\)", sql)
    guard = re.search(r"CREATE OR REPLACE FUNCTION public\.steve_profile_guard\(\).*?\$\$;", sql).group(0)
    assert "current_user IN ('anon', 'authenticated')" in guard
    for column in ("steve_enabled", "steve_consent_at", "steve_consent_version", "steve_key_cipher",
                   "steve_key_last4"):
        assert f"NEW.{column} IS DISTINCT FROM OLD.{column}" in guard, column
    assert "RAISE EXCEPTION" in guard and "SET search_path = ''" in guard


def test_023_has_the_lookup_indexes_and_touches_only_its_tables():
    sql = migration_023()
    assert re.search(r"CREATE INDEX IF NOT EXISTS \w+ ON public\.steve_threads \(user_id, book_id\)", sql)
    assert re.search(r"CREATE INDEX IF NOT EXISTS \w+ ON public\.steve_messages \(thread_id, created_at\)", sql)
    assert sorted(set(re.findall(r"ALTER TABLE public\.(\w+)", sql))) == sorted({"profiles", *STEVE_TABLES})
    assert not re.search(r"\bINSERT INTO\b|\bUPDATE public\.", sql)


# --- 024: Steve's atomic daily quota (C20.2) -------------------------------------------------------

def migration_024() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "024_steve_quota.sql"))


def test_024_takes_a_question_atomically_and_never_past_the_limit():
    sql = migration_024()
    take = re.search(r"CREATE OR REPLACE FUNCTION public\.steve_take_quota\(.*?\$\$;", sql).group(0)
    assert "(p_user uuid, p_day date, p_limit integer) RETURNS integer" in take
    assert ("INSERT INTO public.steve_usage (user_id, day, requests) VALUES (p_user, p_day, 1) "
            "ON CONFLICT (user_id, day) DO UPDATE SET requests = public.steve_usage.requests + 1 "
            "WHERE public.steve_usage.requests < p_limit RETURNING requests") in take
    assert "IF p_limit <= 0 THEN RETURN -1;" in take and "SET search_path = ''" in take


def test_024_refunds_without_going_below_zero():
    sql = migration_024()
    refund = re.search(r"CREATE OR REPLACE FUNCTION public\.steve_refund_quota\(.*?\$\$;", sql).group(0)
    assert ("UPDATE public.steve_usage SET requests = requests - 1 "
            "WHERE user_id = p_user AND day = p_day AND requests > 0") in refund


def test_024_only_the_backend_may_call_the_functions():
    sql = migration_024()
    for name, args in (("steve_take_quota", "uuid, date, integer"), ("steve_refund_quota", "uuid, date")):
        assert f"REVOKE ALL ON FUNCTION public.{name}({args}) FROM PUBLIC, anon, authenticated;" in sql
        assert f"GRANT EXECUTE ON FUNCTION public.{name}({args}) TO service_role;" in sql
    assert "SECURITY DEFINER" not in sql
    assert not re.search(r"\b(CREATE TABLE|ALTER TABLE)\b", sql)


# --- 025: one Gemini call per PDF equation, ever (C20.8) ---------------------------------------------------

def migration_025() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "025_equation_latex.sql"))


def test_025_creates_equation_latex_keyed_by_file_page_and_box():
    definition = table_definition(migration_025(), "equation_latex")
    assert definition == {
        "file_sha256": "text NOT NULL",
        "page": "integer NOT NULL CHECK (page >= 1)",
        "bbox_hash": "text NOT NULL",
        "latex": "text NOT NULL",
        "model": "text",
        "created_at": "timestamptz NOT NULL DEFAULT now()",
        "PRIMARY": "KEY (file_sha256, page, bbox_hash)",
    }


def test_025_only_the_backend_reads_or_writes_it():
    sql = migration_025()
    assert "ALTER TABLE public.equation_latex ENABLE ROW LEVEL SECURITY" in sql
    assert "CREATE POLICY" not in sql  # no policy: readers' roles see nothing; the service role bypasses RLS
    assert sorted(set(re.findall(r"(?:ALTER|CREATE) TABLE (?:IF NOT EXISTS )?public\.(\w+)", sql))) == ["equation_latex"]


# --- 026: highlights and underlines (C21.1) ---------------------------------------------------------

def migration_026() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "026_annotations.sql"))


def test_026_creates_annotations_with_the_agreed_columns():
    assert table_definition(migration_026(), "annotations") == {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "user_id": OWNER,
        "book_id": BOOK,
        "anchors": "jsonb NOT NULL CHECK (jsonb_typeof(anchors) = 'array' AND jsonb_array_length(anchors) >= 1)",
        "position_start": "float8 NOT NULL CHECK (position_start >= 0)",
        "position_end": "float8 NOT NULL",
        "style": "text NOT NULL CHECK (style IN ('highlight', 'underline'))",
        "color": "text NOT NULL CHECK (color IN ('honey', 'sage', 'sky', 'rose', 'lilac'))",
        "text_snapshot": "text NOT NULL DEFAULT ''",
        "orphaned": "boolean NOT NULL DEFAULT false",
        "created_at": "timestamptz NOT NULL DEFAULT now()",
        "updated_at": "timestamptz NOT NULL DEFAULT now()",
        "CONSTRAINT": "annotations_positions_ordered CHECK (position_end >= position_start)",
    }


def test_026_the_palette_and_styles_match_policy():
    from backend.agents import policy
    sql = migration_026()
    # 026's five lead the palette; 036 widened it with Edge's set (C39.1).
    assert "color IN ({})".format(", ".join(f"'{c}'" for c in policy.ANNOTATION_COLORS[:5])) in sql
    assert "style IN ({})".format(", ".join(f"'{s}'" for s in policy.ANNOTATION_STYLES)) in sql


def test_026_readers_only_read_their_own_rows_and_never_write_them():
    sql = migration_026()
    assert "ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(r"CREATE POLICY \"[^\"]+\" ON public\.annotations FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert policies == ["SELECT"]  # writes go through the backend, which checks anchors and positions
    assert sql.count("CREATE POLICY") == 1 and "SECURITY DEFINER" not in sql


def test_026_has_the_range_index_and_touches_only_its_table():
    sql = migration_026()
    assert re.search(r"CREATE INDEX IF NOT EXISTS \w+ ON public\.annotations \(user_id, book_id, position_start\)", sql)
    assert sorted(set(re.findall(r"(?:ALTER|CREATE) TABLE (?:IF NOT EXISTS )?public\.(\w+)", sql))) == ["annotations"]
    assert not re.search(r"\bINSERT INTO\b|\bUPDATE public\.", sql)


# --- 027: note blocks (C22.1) -----------------------------------------------------------------------

def migration_027() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "027_note_blocks.sql"))


def test_027_creates_note_blocks_with_the_agreed_columns():
    assert table_definition(migration_027(), "note_blocks") == {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "user_id": OWNER,
        "book_id": BOOK,
        "anchors": "jsonb NOT NULL CHECK (jsonb_typeof(anchors) = 'array' AND jsonb_array_length(anchors) >= 1)",
        "scope": "text NOT NULL DEFAULT 'selection' CHECK (scope IN ('selection', 'view'))",
        "position_start": "float8 NOT NULL CHECK (position_start >= 0)",
        "position_end": "float8 NOT NULL",
        "kind": "text NOT NULL CHECK (kind IN ('text', 'drawing', 'equation', 'code', 'figure'))",
        "content": "jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 262144)",
        "thumbnail_path": "text",
        "annotation_id": "uuid REFERENCES public.annotations(id) ON DELETE SET NULL",
        "region_id": "uuid REFERENCES public.page_regions(id) ON DELETE SET NULL",
        "orphaned": "boolean NOT NULL DEFAULT false",
        "version": "integer NOT NULL DEFAULT 1 CHECK (version >= 1)",
        "created_at": "timestamptz NOT NULL DEFAULT now()",
        "updated_at": "timestamptz NOT NULL DEFAULT now()",
        "deleted_at": "timestamptz",
        "CONSTRAINT": "note_blocks_positions_ordered CHECK (position_end >= position_start)",
    }


def test_027_kinds_scopes_and_size_match_policy():
    from backend.agents import policy
    sql = migration_027()
    assert "kind IN ({})".format(", ".join(f"'{k}'" for k in policy.NOTE_KINDS)) in sql
    assert "scope IN ({})".format(", ".join(f"'{s}'" for s in policy.NOTE_SCOPES)) in sql
    assert f"octet_length(content::text) <= {policy.NOTE_CONTENT_MAX_BYTES}" in sql


def test_027_readers_only_read_their_own_rows_and_never_write_them():
    sql = migration_027()
    assert "ALTER TABLE public.note_blocks ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(r"CREATE POLICY \"[^\"]+\" ON public\.note_blocks FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert policies == ["SELECT"]  # writes go through the backend, which checks anchors, content and versions
    assert "SECURITY DEFINER" not in sql


def test_027_has_the_range_index_and_touches_only_its_table():
    sql = migration_027()
    assert re.search(r"CREATE INDEX IF NOT EXISTS \w+ ON public\.note_blocks \(user_id, book_id, position_start\)", sql)
    assert sorted(set(re.findall(r"(?:ALTER|CREATE) TABLE (?:IF NOT EXISTS )?public\.(\w+)", sql))) == ["note_blocks"]
    assert not re.search(r"\bUPDATE public\.", sql)


def test_027_adds_a_private_notes_bucket_with_owner_folders_like_books():
    from backend.agents import policy
    sql = migration_027()
    bucket = re.search(r"INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\) "
                       r"VALUES \('notes', 'notes', false, (\d+), ARRAY\[([^\]]+)\]\) ON CONFLICT DO NOTHING", sql)
    assert bucket and int(bucket.group(1)) == policy.NOTE_FILE_BYTES_MAX
    assert re.findall(r"'([^']+)'", bucket.group(2)) == list(policy.NOTE_FILE_TYPES)
    assert ('CREATE POLICY "Readers access their own note files" ON storage.objects FOR ALL USING '
            "( bucket_id = 'notes' AND auth.uid()::text = (string_to_array(name, '/'))[1] )") in sql
    assert sql.count("CREATE POLICY") == 2


# --- 028: body start (C23.1) ------------------------------------------------------------------------------

def migration_028() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "028_body_start.sql"))


def test_028_adds_two_nullable_columns_to_books_and_nothing_else():
    from backend.agents import policy
    sql = migration_028()
    assert re.findall(r"ALTER TABLE public\.(\w+) ADD COLUMN IF NOT EXISTS (\w+)", sql) == [
        ("books", "body_start"), ("books", "body_start_source")]
    assert ("ADD COLUMN IF NOT EXISTS body_start jsonb CHECK (body_start IS NULL OR jsonb_typeof(body_start) = 'object')"
            in sql)
    sources = ", ".join(f"'{s}'" for s in policy.BODY_START_SOURCES)
    assert f"ADD COLUMN IF NOT EXISTS body_start_source text CHECK (body_start_source IN ({sources}))" in sql
    assert "NOT NULL" not in sql and "DEFAULT" not in sql  # existing rows keep null until detected or backfilled
    assert not re.search(r"\bUPDATE\b|\bINSERT\b|\bPOLICY\b", sql)


# --- 029: focus sessions and events (C23.2) ----------------------------------------------------------------

def migration_029() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "029_focus.sql"))


def _in_list(values) -> str:
    return ", ".join(f"'{v}'" for v in values)


def test_029_creates_focus_sessions_with_the_agreed_columns():
    from backend.agents import policy
    count = "integer NOT NULL DEFAULT 0 CHECK ({} >= 0)"
    assert table_definition(migration_029(), "focus_sessions") == {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "user_id": OWNER,
        "book_id": BOOK,
        "status": f"text NOT NULL DEFAULT 'active' CHECK (status IN ({_in_list(policy.FOCUS_STATUSES)}))",
        "start_anchor": "jsonb NOT NULL CHECK (jsonb_typeof(start_anchor) = 'object')",
        "start_position": "float8 NOT NULL CHECK (start_position >= 0)",
        "end_anchor": "jsonb CHECK (end_anchor IS NULL OR jsonb_typeof(end_anchor) = 'object')",
        "end_position": "float8 CHECK (end_position >= 0)",
        "started_at": "timestamptz NOT NULL DEFAULT now()",
        "ended_at": "timestamptz",
        "active_seconds": count.format("active_seconds"),
        "voided_seconds": count.format("voided_seconds"),
        "words_in_range": "integer CHECK (words_in_range >= 0)",
        "quiz_question_ids": "uuid[]",
        "quiz_correct": "integer CHECK (quiz_correct >= 0)",
        "quiz_total": "integer CHECK (quiz_total >= 0)",
        "points_time": count.format("points_time"),
        "points_bonus": count.format("points_bonus"),
        "points_total": count.format("points_total"),
        "rules_version": "text NOT NULL",
        "updated_at": "timestamptz NOT NULL DEFAULT now()",
        "CONSTRAINT": "focus_sessions_quiz_counts CHECK (quiz_correct IS NULL OR quiz_correct <= quiz_total)",
    }


def test_029_creates_focus_events_with_the_agreed_columns():
    from backend.agents import policy
    assert table_definition(migration_029(), "focus_events") == {
        "id": "bigserial PRIMARY KEY",
        "session_id": "uuid NOT NULL REFERENCES public.focus_sessions(id) ON DELETE CASCADE",
        "user_id": OWNER,
        "kind": f"text NOT NULL CHECK (kind IN ({_in_list(policy.FOCUS_EVENT_KINDS)}))",
        "client_event_id": "uuid",
        "page_key": f"text CHECK (char_length(page_key) <= {policy.FOCUS_PAGE_KEY_MAX})",
        "position": "float8 CHECK (position >= 0)",
        "had_input": "boolean",
        "client_ts": "timestamptz",
        "server_ts": "timestamptz NOT NULL DEFAULT now()",
    }


def test_029_one_open_session_per_reader_and_the_lookup_indexes():
    from backend.agents import policy
    sql = migration_029()
    assert (f"CREATE UNIQUE INDEX IF NOT EXISTS focus_sessions_one_open ON public.focus_sessions (user_id) "
            f"WHERE status IN ({_in_list(policy.FOCUS_OPEN_STATUSES)})") in sql
    assert "CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_book ON public.focus_sessions (user_id, book_id, started_at DESC)" in sql
    assert "CREATE INDEX IF NOT EXISTS idx_focus_events_session ON public.focus_events (session_id, server_ts, id)" in sql
    assert ("CREATE UNIQUE INDEX IF NOT EXISTS focus_events_client_id ON public.focus_events (session_id, client_event_id) "
            "WHERE client_event_id IS NOT NULL") in sql


def test_029_readers_only_read_their_own_rows_and_events_are_append_only():
    sql = migration_029()
    for table in ("focus_sessions", "focus_events"):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in sql
        policies = re.findall(rf"CREATE POLICY \"[^\"]+\" ON public\.{table} FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
        assert policies == ["SELECT"]  # only the backend writes: it timestamps events and scores sessions
    assert sql.count("CREATE POLICY") == 2 and "SECURITY DEFINER" not in sql
    # Append-only even for the service role: an UPDATE raises; rows go only with their session, book or reader.
    assert "CREATE OR REPLACE FUNCTION public.focus_events_append_only() RETURNS trigger" in sql
    assert "RAISE EXCEPTION 'focus_events is append-only'" in sql
    assert ("CREATE OR REPLACE TRIGGER focus_events_no_update BEFORE UPDATE ON public.focus_events "
            "FOR EACH ROW EXECUTE FUNCTION public.focus_events_append_only()") in sql


def test_029_touches_only_its_tables():
    sql = migration_029()
    assert sorted(set(re.findall(r"(?:ALTER|CREATE) TABLE (?:IF NOT EXISTS )?public\.(\w+)", sql))) == [
        "focus_events", "focus_sessions"]
    assert not re.search(r"\bINSERT INTO\b|\bUPDATE public\.", sql)


# --- 030: ignored focus events (C23.4) ---------------------------------------------------------------------

def test_030_adds_only_the_ignored_events_counter():
    sql = re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "030_focus_ignored_events.sql")).strip()
    assert sql == ("ALTER TABLE public.focus_sessions ADD COLUMN IF NOT EXISTS ignored_events integer NOT NULL "
                   "DEFAULT 0 CHECK (ignored_events >= 0);")


# --- 031: the XP ledger and each reader's progress (C24.1) ---------------------------------------------------------

def migration_031() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "031_xp.sql"))


def test_031_creates_the_xp_ledger_with_one_row_per_source_event():
    from backend.agents import policy
    assert table_definition(migration_031(), "xp_events") == {
        "id": "bigserial PRIMARY KEY",
        "user_id": OWNER,
        "source": f"text NOT NULL CHECK (source IN ({_in_list(policy.XP_SOURCES)}))",
        "source_id": "text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 200)",
        "amount": "integer NOT NULL CHECK (amount > 0 OR (source = 'adjustment' AND amount <> 0))",
        "earned_at": "timestamptz NOT NULL",
        "local_day": "date NOT NULL",
        "created_at": "timestamptz NOT NULL DEFAULT now()",
        "UNIQUE": "(source, source_id)",
    }


def test_031_creates_user_progress_with_the_agreed_columns_and_ranges():
    from backend.agents import policy
    assert table_definition(migration_031(), "user_progress") == {
        "user_id": "uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE",
        "total_xp": "integer NOT NULL DEFAULT 0 CHECK (total_xp >= 0)",
        "daily_goal": (f"integer NOT NULL DEFAULT {policy.DAILY_GOAL_XP} CHECK (daily_goal BETWEEN "
                       f"{policy.DAILY_GOAL_MIN_XP} AND {policy.DAILY_GOAL_MAX_XP})"),
        "timezone": f"text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) BETWEEN 1 AND {policy.XP_TIMEZONE_MAX})",
        "streak_days": "integer NOT NULL DEFAULT 0 CHECK (streak_days >= 0)",
        "streak_freezes": f"integer NOT NULL DEFAULT 0 CHECK (streak_freezes BETWEEN 0 AND {policy.STREAK_FREEZE_MAX})",
        "last_goal_day": "date",
        "display_name": (f"text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND "
                         f"{policy.DISPLAY_NAME_MAX})"),
        "leaderboard_opt_out": "boolean NOT NULL DEFAULT false",
        "updated_at": "timestamptz NOT NULL DEFAULT now()",
    }


def test_031_indexes_a_readers_days():
    assert "CREATE INDEX IF NOT EXISTS idx_xp_events_user_day ON public.xp_events (user_id, local_day)" in migration_031()


def test_031_readers_only_read_their_own_rows_and_the_ledger_is_append_only():
    sql = migration_031()
    for table in ("xp_events", "user_progress"):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in sql
        policies = re.findall(rf"CREATE POLICY \"[^\"]+\" ON public\.{table} FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
        assert policies == ["SELECT"]  # only the server writes XP and streaks (G2)
    assert sql.count("CREATE POLICY") == 2 and "SECURITY DEFINER" not in sql
    assert "CREATE OR REPLACE FUNCTION public.xp_events_append_only() RETURNS trigger" in sql
    assert "RAISE EXCEPTION 'xp_events is append-only'" in sql
    assert ("CREATE OR REPLACE TRIGGER xp_events_no_update BEFORE UPDATE ON public.xp_events "
            "FOR EACH ROW EXECUTE FUNCTION public.xp_events_append_only()") in sql


def test_031_touches_only_its_tables():
    sql = migration_031()
    assert sorted(set(re.findall(r"(?:ALTER|CREATE) TABLE (?:IF NOT EXISTS )?public\.(\w+)", sql))) == [
        "user_progress", "xp_events"]
    assert not re.search(r"\bINSERT INTO\b|\bUPDATE public\.", sql)


# --- 032: badges each reader holds (C24.2) --------------------------------------------------------------------------

def migration_032() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "032_badges.sql"))


def test_032_creates_user_badges_keyed_by_reader_and_badge():
    assert table_definition(migration_032(), "user_badges") == {
        "user_id": OWNER,
        "badge_id": "text NOT NULL CHECK (char_length(badge_id) BETWEEN 1 AND 64)",
        "awarded_at": "timestamptz NOT NULL DEFAULT now()",
        "PRIMARY": "KEY (user_id, badge_id)",
    }


def test_032_readers_only_read_their_own_badges_and_it_touches_nothing_else():
    sql = migration_032()
    assert "ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(r"CREATE POLICY \"[^\"]+\" ON public\.user_badges FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert policies == ["SELECT"] and sql.count("CREATE POLICY") == 1  # only the server awards (G2)
    assert sorted(set(re.findall(r"(?:ALTER|CREATE) TABLE (?:IF NOT EXISTS )?public\.(\w+)", sql))) == ["user_badges"]
    assert not re.search(r"\bINSERT INTO\b|\bUPDATE public\.|SECURITY DEFINER", sql)


# --- 033: weekly leagues (C24.3) --------------------------------------------------------------------------------------

def migration_033() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "033_leagues.sql"))


def test_033_creates_the_three_league_tables_with_the_agreed_columns():
    from backend.agents import policy
    sql = migration_033()
    tier = f"text NOT NULL CHECK (tier IN ({_in_list(policy.LEAGUE_TIERS)}))"
    assert table_definition(sql, "league_weeks") == {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "starts_at": "timestamptz NOT NULL UNIQUE",
        "ends_at": "timestamptz NOT NULL",
        "status": "text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))",
        "grouped_at": "timestamptz",
        "closed_at": "timestamptz",
        "CONSTRAINT": "league_weeks_order CHECK (ends_at > starts_at)",
    }
    assert table_definition(sql, "league_groups") == {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "week_id": "uuid NOT NULL REFERENCES public.league_weeks(id) ON DELETE CASCADE",
        "tier": tier,
        "created_at": "timestamptz NOT NULL DEFAULT now()",
    }
    assert table_definition(sql, "league_members") == {
        "week_id": "uuid NOT NULL REFERENCES public.league_weeks(id) ON DELETE CASCADE",
        "group_id": "uuid NOT NULL REFERENCES public.league_groups(id) ON DELETE CASCADE",
        "user_id": OWNER,
        "tier": tier,
        "joined_at": "timestamptz NOT NULL",
        "weekly_xp": "integer NOT NULL DEFAULT 0 CHECK (weekly_xp >= 0)",
        "xp_reached_at": "timestamptz",
        "final_rank": "integer CHECK (final_rank >= 1)",
        "outcome": f"text CHECK (outcome IS NULL OR outcome IN ({_in_list(policy.LEAGUE_OUTCOMES)}))",
        "PRIMARY": "KEY (week_id, user_id)",
    }


def test_033_indexes_a_groups_members_and_a_readers_weeks():
    sql = migration_033()
    assert "CREATE INDEX IF NOT EXISTS idx_league_members_group ON public.league_members (group_id)" in sql
    assert "CREATE INDEX IF NOT EXISTS idx_league_members_user ON public.league_members (user_id, week_id)" in sql
    assert "CREATE INDEX IF NOT EXISTS idx_league_groups_week ON public.league_groups (week_id, tier)" in sql


def test_033_readers_read_only_their_own_membership_and_nothing_else():
    sql = migration_033()
    for table in ("league_weeks", "league_groups", "league_members"):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in sql
    # Others' standings go only through the backend, which shows display name and XP alone (G3).
    policies = re.findall(r"CREATE POLICY \"[^\"]+\" ON public\.(\w+) FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert policies == [("league_members", "SELECT")] and sql.count("CREATE POLICY") == 1
    assert sorted(set(re.findall(r"(?:ALTER|CREATE) TABLE (?:IF NOT EXISTS )?public\.(\w+)", sql))) == [
        "league_groups", "league_members", "league_weeks"]
    assert not re.search(r"\bINSERT INTO\b|\bUPDATE public\.|SECURITY DEFINER", sql)


def test_035_keeps_every_status_and_adds_deleting():
    sql = re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "035_book_deleting.sql"))
    assert "ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_status_check, ADD CONSTRAINT books_status_check" in sql
    assert "CHECK (status IN ('processing', 'ready', 'error', 'deleting'))" in sql
    from backend.services import book_purge
    assert book_purge.DELETING == "deleting"


# --- 036: page marks, comments and Edge's colours (C39.1, issue 23) -----------------------------------

def migration_036() -> str:
    return re.sub(r"\s+", " ", sql_without_comments(MIGRATIONS / "036_page_marks.sql"))


def test_036_creates_page_marks_with_the_agreed_columns():
    from backend.agents import policy
    assert table_definition(migration_036(), "page_marks") == {
        "id": "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
        "user_id": OWNER,
        "book_id": BOOK,
        "kind": "text NOT NULL CHECK (kind IN ({}))".format(", ".join(f"'{k}'" for k in policy.MARK_KINDS)),
        "page": "integer NOT NULL CHECK (page >= 1)",
        "position": "float8 NOT NULL CHECK (position >= 0)",
        "color": "text NOT NULL CHECK (color IN ({}))".format(", ".join(f"'{c}'" for c in policy.MARK_COLORS)),
        "data": "jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= "
                f"{policy.MARK_DATA_MAX_BYTES})",
        "created_at": "timestamptz NOT NULL DEFAULT now()",
        "updated_at": "timestamptz NOT NULL DEFAULT now()",
    }


def test_036_readers_only_read_their_own_marks_and_never_write_them():
    sql = migration_036()
    assert "ALTER TABLE public.page_marks ENABLE ROW LEVEL SECURITY" in sql
    policies = re.findall(r"CREATE POLICY \"[^\"]+\" ON public\.(\w+) FOR (\w+) USING \(auth\.uid\(\) = user_id\)", sql)
    assert policies == [("page_marks", "SELECT")] and sql.count("CREATE POLICY") == 1
    assert re.search(r"CREATE INDEX IF NOT EXISTS \w+ ON public\.page_marks \(user_id, book_id, position\)", sql)
    assert not re.search(r"\bINSERT INTO\b|\bUPDATE public\.|SECURITY DEFINER", sql)
    assert sorted(set(re.findall(r"(?:ALTER|CREATE) TABLE (?:IF NOT EXISTS )?public\.(\w+)", sql))) == [
        "annotations", "page_marks"]


def test_036_adds_a_nullable_comment_and_keeps_every_colour():
    from backend.agents import policy
    sql = migration_036()
    assert ("ALTER TABLE public.annotations ADD COLUMN IF NOT EXISTS comment text CHECK (comment IS NULL OR "
            f"char_length(comment) BETWEEN 1 AND {policy.ANNOTATION_COMMENT_MAX})") in sql
    assert "AND pg_get_constraintdef(oid) LIKE '%color%'" in sql  # only the colour check is swapped
    assert ("ADD CONSTRAINT annotations_color_check CHECK (color IN ({}))".format(
        ", ".join(f"'{c}'" for c in policy.ANNOTATION_COLORS))) in sql
    assert policy.ANNOTATION_COLORS[:5] == ("honey", "sage", "sky", "rose", "lilac")  # 026's rows stay valid
