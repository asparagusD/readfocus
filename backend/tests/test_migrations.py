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


@pytest.mark.parametrize("path", sorted(MIGRATIONS.glob("*.sql")), ids=lambda p: p.name)
def test_migrations_are_additive(path):
    sql = sql_without_comments(path)
    if path.name == "018_page_regions.sql":
        sql = re.sub(r"\s+", " ", sql).replace(KIND_CHECK_SWAP, "")
    if path.name == "019_epub_regions.sql":
        sql = re.sub(r"\s+", " ", sql)
        for statement in PLACE_NULLABLE:
            sql = sql.replace(statement, "")
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
