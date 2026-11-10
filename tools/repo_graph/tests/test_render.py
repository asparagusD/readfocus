"""Tests for tools/repo_graph/render.py, on the fixture repo from test_build."""

import pytest

from tools.repo_graph import build, inventory, render
from tools.repo_graph.tests.test_build import FIXTURE, build_fixture

LIBRARY = "file_frontend_src_pages_Library_jsx"
API = "file_frontend_src_lib_api_js"
BOOKS = "file_backend_routers_books_py"
DB = "file_backend_services_db_py"


@pytest.fixture(scope="module")
def doc():
    inv = inventory.build(
        sorted(FIXTURE), {p: f"Purpose of {p}." for p in FIXTURE},
        lambda p: FIXTURE[p].encode("utf-8"),
    )
    return render.render_map(build_fixture(), inv)


def test_layer_diagram_follows_the_request_path(doc):
    for link in (
        f"{LIBRARY} --> {API}",
        f"{API} --> {BOOKS}",
        f"{BOOKS} --> {DB}",
        f"{DB} --> supabase",
        f"{DB} --> external_groq",
    ):
        assert f"  {link}\n" in doc
    assert 'external_groq["groq (banned)"]:::banned' in doc
    assert f'{BOOKS}["books.py"]' in doc


def test_langgraph_diagram_marks_conditional_edges(doc):
    assert "graph_node___start__ -.-> graph_node_planner\n" in doc
    assert "graph_node_planner --> graph_node___end__\n" in doc
    assert 'graph_node_planner["planner<br/>planner_node in planner.py"]' in doc


def test_lookup_tables(doc):
    page = "`frontend/src/pages/Library.jsx`"
    assert f"| `GET /books` | `list_books` | `backend/routers/books.py` | {page} |" in doc
    assert "| `GET /health` | `health` | `backend/main.py` | none |" in doc
    assert (
        "| `books` | `supabase/migrations/001_initial.sql` | "
        "`supabase/migrations/001_initial.sql` | `backend/services/db.py` | "
        "`backend/services/db.py` |"
    ) in doc
    assert "| `match_chunks` | `supabase/migrations/001_initial.sql` | `backend/services/db.py` |" in doc
    assert "| `groq` | yes | `backend/services/db.py:3` |" in doc
    assert "| `UNUSED_KEY` | `.env.example` | none |" in doc


def test_every_file_is_listed_once(doc):
    for path in FIXTURE:
        assert doc.count(f"\n| `{path}` | ") == 1  # one row in the Files section
    assert "| Purpose of backend/main.py. |" in doc


def test_real_map_has_two_diagrams_and_is_deterministic():
    def real():
        inv = inventory.build_repo()
        graph = build.build_graph(inv["files"], lambda p: (inventory.ROOT / p).read_bytes())
        return render.render_map(graph, inv)

    first = real()
    assert first.count("```mermaid") == 2
    assert "graph_node_planner" in first and "external_groq" in first
    assert first == real()
