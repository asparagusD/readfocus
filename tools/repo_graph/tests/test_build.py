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
    "backend/services/db.py": "client = None\n",
    "frontend/src/lib/api.js": "export async function fetchApi(endpoint, options = {}) {}\n",
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
