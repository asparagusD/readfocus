"""Tests for tools/repo_graph/query.py, on the fixture repo from test_build."""

import pytest

from tools.repo_graph import query
from tools.repo_graph.render import View
from tools.repo_graph.tests.test_build import build_fixture


@pytest.fixture(scope="module")
def view():
    return View(build_fixture())


def text(view, target, files=None):
    return "\n".join(
        line for node in query.resolve(view, target)
        for line in query.describe(view, node, files or {})
    )


def test_file_query_lists_both_directions(view):
    files = {"backend/services/db.py": {"lines": 16, "purpose": "Database access."}}
    out = text(view, "backend/services/db.py", files)
    assert out.startswith("backend/services/db.py  [service, python, 16 lines]\n  Database access.")
    assert "Imported by (1):\n  backend/routers/books.py" in out
    assert "Imports (0): none" in out
    assert "Reads tables (2):\n  books\n  chunks" in out
    assert "Writes tables (3):" in out
    assert "Reads env vars (3):" in out
    assert "External calls (2):\n  groq (banned) (line 3)\n  supabase (line 2)" in out


def test_endpoint_query_with_and_without_method(view):
    assert query.resolve(view, "/books") == ["endpoint:GET /books"]
    opened = ["endpoint:POST /books/{book_id}/open"]
    assert query.resolve(view, "/books/{id}/open") == opened
    assert query.resolve(view, "post /books/{id}/open") == opened
    assert query.resolve(view, "GET /books/{id}/open") == []
    out = text(view, "/books")
    assert "GET /books  [endpoint, handler list_books]" in out
    assert "Defined in (1):\n  backend/routers/books.py" in out
    assert "Called by (1):\n  frontend/src/pages/Library.jsx" in out


def test_table_and_other_names(view):
    out = text(view, "books")
    assert "books  [table]" in out
    assert "Read by (1):\n  backend/services/db.py" in out
    assert "Defined in (1):\n  supabase/migrations/001_initial.sql" in out
    assert "groq  [external, banned by CLAUDE.md]" in text(view, "groq")
    assert "planner  [graph_node, handler planner_node, in backend/agents/planner.py]" in text(
        view, "planner"
    )
    assert "Handles LangGraph nodes (1):\n  planner" in text(view, "backend/agents/planner.py")


def test_windows_and_dotted_paths_are_accepted(view):
    expected = ["file:backend/routers/books.py"]
    assert query.resolve(view, "backend\\routers\\books.py") == expected
    assert query.resolve(view, "./backend/routers/books.py") == expected


def test_unknown_target_exits_2_with_suggestions(capsys):
    assert query.main(["backend/services/lm.py"]) == 2
    assert query.main(["llm.py"]) == 2
    err = capsys.readouterr().err
    assert "Nothing in the graph matches 'llm.py'" in err
    assert "did you mean: backend/services/llm.py" in err
    assert query.main([]) == 2


def test_real_graph_lists_every_agent_that_uses_llm(capsys):
    assert query.main(["backend/services/llm.py"]) == 0
    out = capsys.readouterr().out
    imported_by = out.split("Imported by (4):\n")[1].split("Imports (")[0]
    assert imported_by.split() == [
        f"backend/agents/{name}_agent.py"
        for name in ("evaluator", "optimizer", "planner", "test_generator")
    ]
    assert "External calls (1):\n  groq (banned) (line 8)" in out
