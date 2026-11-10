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


def test_005_leaves_the_old_column_and_function_alone():
    sql = migration_005()
    assert not re.search(r"\bmatch_chunks\s*\(", sql)
    assert not re.search(r"\bembedding\b(?!_local)", sql.replace("query_embedding", ""))
