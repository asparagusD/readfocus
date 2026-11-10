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


@pytest.mark.parametrize("path", sorted(MIGRATIONS.glob("*.sql")), ids=lambda p: p.name)
def test_migrations_are_additive(path):
    found = DESTRUCTIVE.findall(sql_without_comments(path))
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
