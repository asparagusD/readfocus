"""Tests for tools/repo_graph/build.py, on a tiny in-memory fixture repo."""

import pytest

from tools.repo_graph import build, inventory

FIXTURE = {
    "backend/__init__.py": "",
    "backend/main.py": (
        "import os\n"
        "from fastapi import FastAPI\n"
        "from backend.routers import books\n"
        "app = FastAPI()\n"
        'app.include_router(books.router, prefix="/books")\n'
        '@app.get("/health")\n'
        "def health():\n"
        "    return {}\n"
    ),
    "backend/routers/__init__.py": "",
    "backend/routers/books.py": (
        "from fastapi import APIRouter\n"
        "from backend.services import db\n"
        "router = APIRouter()\n"
        '@router.get("")\n'
        "async def list_books():\n"
        "    return []\n"
        '@router.post("/{book_id}/open")\n'
        "async def open_book(book_id: str):\n"
        "    from .helpers import touch\n"
        "    return touch(book_id)\n"
    ),
    "backend/routers/helpers.py": "def touch(x):\n    return x\n",
    "backend/services/__init__.py": "",
    "backend/services/db.py": (
        "import os\n"
        "from supabase import create_client\n"
        "from langchain_groq import ChatGroq\n"
        'URL = os.getenv("SUPABASE_URL")\n'
        'KEY = os.environ.get("SUPABASE_SERVICE_KEY")\n'
        'ENV = os.environ["ENV"]\n'
        "def load(c):\n"
        '    c.table("books").select("*").execute()\n'
        '    rows = (\n        c\n        .table("chunks")\n        .select("id")\n    )\n'
        '    c.table("books").insert({}).execute()\n'
        '    c.table("sessions").update({}).execute()\n'
        '    c.table("results").upsert({}).execute()\n'
        '    c.table("results").delete().execute()\n'
        '    return c.rpc("match_chunks", {}).execute()\n'
    ),
    "backend/agents/__init__.py": "",
    "backend/agents/planner.py": "def planner_node(state):\n    return {}\n",
    "backend/agents/graph.py": (
        "from langgraph.graph import StateGraph, END\n"
        "from backend.agents.planner import planner_node\n"
        "g = StateGraph(dict)\n"
        'g.add_node("planner", planner_node)\n'
        'g.add_conditional_edges("__start__", route, {"planner": "planner", END: END})\n'
        'g.add_edge("planner", END)\n'
    ),
    "supabase/migrations/001_initial.sql": (
        "CREATE TABLE public.books (id uuid);\n"
        "ALTER TABLE public.books ADD COLUMN IF NOT EXISTS pace jsonb;\n"
        "ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;\n"
        "CREATE OR REPLACE FUNCTION match_chunks(q int)\nRETURNS TABLE (id uuid) AS $$ $$;\n"
    ),
    ".env.example": "# Supabase\nSUPABASE_URL=\nUNUSED_KEY=x\n",
    "frontend/src/lib/api.js": (
        "import { createClient } from '@supabase/supabase-js';\n"
        "const base = import.meta.env.VITE_API_URL || '';\n"
        "export async function fetchApi(endpoint, options = {}) {}\n"
    ),
    "frontend/src/pages/Library.css": ".a { color: red; }\n",
    "frontend/src/pages/Library.jsx": (
        "import React, {\n  useState,\n} from 'react';\n"
        "import { fetchApi } from '../lib/api';\n"
        "import { Gone } from './Gone';\n"
        "import './Library.css';\n"
        "const a = await fetchApi('/books');\n"
        "await fetchApi(`/books/${id}/open`, {\n  method: 'POST',\n});\n"
        "fetchApi('/nope').catch(console.error);\n"
    ),
}


def build_fixture(files=FIXTURE):
    records = [
        {"path": p, "role": inventory.role(p), "language": inventory.language(p)}
        for p in sorted(files)
    ]
    return build.build_graph(records, lambda p: files[p].encode("utf-8"))


@pytest.fixture(scope="module")
def graph():
    return build_fixture()


def edges(graph, edge_type):
    return {(e["from"], e["to"]) for e in graph["edges"] if e["type"] == edge_type}


def test_every_file_is_a_node_with_its_role(graph):
    nodes = {n["id"]: n for n in graph["nodes"]}
    assert {f"file:{p}" for p in FIXTURE} <= set(nodes)
    assert nodes["file:backend/routers/books.py"]["role"] == "router"


def test_python_imports(graph):
    assert edges(graph, "imports") >= {
        ("file:backend/main.py", "file:backend/routers/books.py"),
        ("file:backend/routers/books.py", "file:backend/services/db.py"),
        ("file:backend/routers/books.py", "file:backend/routers/helpers.py"),
    }
    assert not any("fastapi" in to for _, to in edges(graph, "imports"))


def test_js_imports(graph):
    page = "file:frontend/src/pages/Library.jsx"
    assert {to for src, to in edges(graph, "imports") if src == page} == {
        "file:frontend/src/lib/api.js",
        "file:frontend/src/pages/Library.css",
    }
    assert {"from": page, "type": "imports", "target": "./Gone"} in graph["unresolved"]


def test_defines_endpoint_joins_router_prefix(graph):
    assert edges(graph, "defines_endpoint") == {
        ("file:backend/main.py", "endpoint:GET /health"),
        ("file:backend/routers/books.py", "endpoint:GET /books"),
        ("file:backend/routers/books.py", "endpoint:POST /books/{book_id}/open"),
    }
    node = next(n for n in graph["nodes"] if n["id"] == "endpoint:GET /books")
    assert node["handler"] == "list_books"


def test_calls_endpoint_matches_method_and_path(graph):
    page = "file:frontend/src/pages/Library.jsx"
    assert edges(graph, "calls_endpoint") == {
        (page, "endpoint:GET /books"),
        (page, "endpoint:POST /books/{book_id}/open"),
    }
    assert {"from": page, "type": "calls_endpoint", "target": "GET /nope"} in graph["unresolved"]


DB = "file:backend/services/db.py"
MIGRATION = "file:supabase/migrations/001_initial.sql"


def test_table_reads_and_writes(graph):
    assert edges(graph, "reads_table") == {(DB, "table:books"), (DB, "table:chunks")}
    assert edges(graph, "writes_table") == {
        (DB, "table:books"), (DB, "table:sessions"), (DB, "table:results"),
    }


def test_functions_and_migrations(graph):
    assert edges(graph, "calls_function") == {(DB, "function:match_chunks")}
    assert edges(graph, "defines_function") == {(MIGRATION, "function:match_chunks")}
    assert edges(graph, "defines_table") == {(MIGRATION, "table:books")}
    assert edges(graph, "alters_table") == {(MIGRATION, "table:books")}


def test_env_vars_used_and_declared(graph):
    assert edges(graph, "uses_env") == {
        (DB, "env:SUPABASE_URL"), (DB, "env:SUPABASE_SERVICE_KEY"), (DB, "env:ENV"),
        ("file:frontend/src/lib/api.js", "env:VITE_API_URL"),
    }
    assert edges(graph, "declares_env") == {
        ("file:.env.example", "env:SUPABASE_URL"), ("file:.env.example", "env:UNUSED_KEY"),
    }


def test_external_services_and_banned_flag(graph):
    assert edges(graph, "calls_external") == {
        (DB, "external:supabase"), (DB, "external:groq"),
        ("file:frontend/src/lib/api.js", "external:supabase"),
        ("file:backend/agents/graph.py", "external:langgraph"),
    }
    nodes = {n["id"]: n for n in graph["nodes"]}
    assert nodes["external:groq"]["banned"] is True
    assert nodes["external:supabase"]["banned"] is False
    lines = {(e["from"], e["to"]): e["line"]
             for e in graph["edges"] if e["type"] == "calls_external"}
    assert lines[DB, "external:groq"] == 3
    assert lines["file:frontend/src/lib/api.js", "external:supabase"] == 1


def test_langgraph_nodes_and_edges(graph):
    assert edges(graph, "graph_node") == {
        ("file:backend/agents/graph.py", "graph_node:planner"),
    }
    planner = next(n for n in graph["nodes"] if n["id"] == "graph_node:planner")
    assert planner["handler"] == "planner_node"
    assert planner["handler_file"] == "backend/agents/planner.py"
    found = {(e["from"], e["to"], e.get("conditional", False))
             for e in graph["edges"] if e["type"] == "graph_edge"}
    assert found == {
        ("graph_node:__start__", "graph_node:planner", True),
        ("graph_node:__start__", "graph_node:__end__", True),
        ("graph_node:planner", "graph_node:__end__", False),
    }


def test_graph_is_valid_sorted_and_deterministic(graph):
    ids = [n["id"] for n in graph["nodes"]]
    assert ids == sorted(ids)
    assert all(e["from"] in ids and e["to"] in ids for e in graph["edges"])
    assert {e["type"] for e in graph["edges"]} <= set(build.EDGE_TYPES)
    assert build.render(graph) == build.render(build_fixture())


def test_real_graph_covers_routers_and_pages():
    graph = build.build_repo()
    ids = {n["id"] for n in graph["nodes"]}
    expected = [
        p for p in inventory.tracked_files()
        if p.startswith(("backend/routers/", "frontend/src/pages/"))
    ]
    assert expected and all(f"file:{p}" in ids for p in expected)
    assert (
        "file:frontend/src/pages/ReadingSession.jsx",
        "endpoint:POST /sessions/start",
    ) in edges(graph, "calls_endpoint")
    assert not [u for u in graph["unresolved"] if u["type"] == "calls_endpoint"]


def test_real_graph_has_the_schema_and_the_agents():
    graph = build.build_repo()
    tables = {
        "profiles", "books", "chunks", "sessions", "test_results", "reading_progress", "question_bank",
        "concepts", "user_concept_mastery", "agent_decisions",
    }
    assert {to for _, to in edges(graph, "defines_table")} == {f"table:{t}" for t in tables}
    # The tooling and its fixtures must not leak into the graph.
    assert {n["id"] for n in graph["nodes"] if n["type"] == "table"} == {
        f"table:{t}" for t in tables
    }
    assert (
        "file:backend/services/retriever.py", "function:match_chunks_local",
    ) in edges(graph, "calls_function")
    assert {to for _, to in edges(graph, "graph_node")} == {
        f"graph_node:{n}" for n in ("planner", "test_generator", "evaluator", "knowledge_state", "optimizer")
    }
    assert {n["type"] for n in graph["nodes"]} == set(build.NODE_TYPES)


def test_a_graph_built_in_a_test_file_is_not_wiring():
    toy = (
        "from langgraph.graph import StateGraph\n"
        "g = StateGraph(dict)\n"
        'g.add_node("toy", step)\n'
        'g.add_edge("__start__", "toy")\n'
    )
    graph = build_fixture({**FIXTURE, "backend/tests/test_toy.py": toy})
    assert "graph_node:toy" not in {n["id"] for n in graph["nodes"]}
    assert edges(graph, "graph_node") == {("file:backend/agents/graph.py", "graph_node:planner")}
