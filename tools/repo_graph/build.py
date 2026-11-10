"""Build docs/repo-graph/graph.json: a typed dependency graph of the repo.

Usage, from the repo root:

    python tools/repo_graph/build.py

Nodes are files (from the inventory) and API endpoints. Edges:

    imports           file -> file      Python via ast, JS/JSX via regex
    defines_endpoint  file -> endpoint  FastAPI decorators + include_router prefixes
    calls_endpoint    file -> endpoint  frontend fetchApi('/...') calls

Anything that looks like an edge but has no target (a relative import that
resolves to no file, a fetchApi call with no matching route) is listed under
"unresolved" instead of being dropped. Output is sorted and has no
timestamps. Standard library only.
"""

from __future__ import annotations

import ast
import json
import posixpath
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:  # allow `python tools/repo_graph/build.py`
    sys.path.insert(0, str(ROOT))

from tools.repo_graph import inventory

OUT_FILE = ROOT / "docs" / "repo-graph" / "graph.json"

NODE_TYPES = ("file", "endpoint")
EDGE_TYPES = ("imports", "defines_endpoint", "calls_endpoint")

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
JS_IMPORT = re.compile(r"""^\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]""", re.MULTILINE)
JS_FETCH = re.compile(r"""fetchApi\(\s*(['"`])(.+?)\1""")
JS_METHOD = re.compile(r"""method:\s*['"](\w+)['"]""")
JS_SUFFIXES = ("", ".js", ".jsx", "/index.js", "/index.jsx")


class GraphError(Exception):
    """The graph is internally inconsistent; the message says where."""


class Graph:
    def __init__(self) -> None:
        self.nodes: dict[str, dict] = {}
        self.edges: dict[tuple[str, str, str], dict] = {}
        self.unresolved: list[dict] = []

    def node(self, node_type: str, name: str, **attrs) -> str:
        node_id = f"{node_type}:{name}"
        self.nodes.setdefault(node_id, {"id": node_id, "type": node_type, **attrs})
        return node_id

    def edge(self, edge_type: str, source: str, target: str, **attrs) -> None:
        self.edges[(edge_type, source, target)] = {
            "type": edge_type, "from": source, "to": target, **attrs
        }

    def miss(self, source: str, edge_type: str, target: str) -> None:
        self.unresolved.append({"from": source, "type": edge_type, "target": target})

    def to_dict(self) -> dict:
        for (edge_type, source, target) in self.edges:
            if edge_type not in EDGE_TYPES:
                raise GraphError(f"unknown edge type: {edge_type}")
            for end in (source, target):
                if end not in self.nodes:
                    raise GraphError(f"{edge_type} edge points at missing node {end}")
        return {
            "version": 1,
            "nodes": [self.nodes[k] for k in sorted(self.nodes)],
            "edges": [self.edges[k] for k in sorted(self.edges)],
            "unresolved": sorted(
                self.unresolved, key=lambda u: (u["from"], u["type"], u["target"])
            ),
        }


def py_module_file(module: str, paths: set[str]) -> str | None:
    base = module.replace(".", "/")
    return next((c for c in (f"{base}.py", f"{base}/__init__.py") if c in paths), None)


def py_bindings(path: str, tree: ast.AST, paths: set[str]) -> dict[str, str]:
    """Map each name a Python file imports to the project file it comes from."""
    bound: dict[str, str] = {}
    package = path.split("/")[:-1]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                target = py_module_file(alias.name, paths)
                if target:
                    bound[alias.asname or alias.name] = target
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level:  # relative import
                parts = package[: len(package) - node.level + 1]
                module = ".".join(parts + ([module] if module else []))
            for alias in node.names:
                target = py_module_file(f"{module}.{alias.name}", paths)
                target = target or py_module_file(module, paths)
                if target:
                    bound[alias.asname or alias.name] = target
    return bound


def router_prefixes(tree: ast.AST, bound: dict[str, str]) -> dict[str, str]:
    """`app.include_router(books.router, prefix="/books")` -> {books file: "/books"}."""
    prefixes = {}
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "include_router"
            and node.args
            and isinstance(node.args[0], ast.Attribute)
            and isinstance(node.args[0].value, ast.Name)
        ):
            target = bound.get(node.args[0].value.id)
            prefix = next(
                (k.value.value for k in node.keywords
                 if k.arg == "prefix" and isinstance(k.value, ast.Constant)), "",
            )
            if target:
                prefixes[target] = prefix
    return prefixes


def py_endpoints(graph: Graph, path: str, tree: ast.AST, prefix: str) -> None:
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for deco in node.decorator_list:
            if not (
                isinstance(deco, ast.Call)
                and isinstance(deco.func, ast.Attribute)
                and deco.func.attr in HTTP_METHODS
                and isinstance(deco.func.value, ast.Name)
                and deco.args
                and isinstance(deco.args[0], ast.Constant)
            ):
                continue
            base = prefix if deco.func.value.id == "router" else ""
            route = f"{base}{deco.args[0].value}" or "/"
            method = deco.func.attr.upper()
            endpoint = graph.node(
                "endpoint", f"{method} {route}",
                method=method, path=route, handler=node.name,
            )
            graph.edge("defines_endpoint", f"file:{path}", endpoint)


def route_key(method: str, path: str) -> str:
    """Compare routes with every path parameter reduced to `{}`."""
    return f"{method} " + re.sub(r"\$?\{[^}]*\}", "{}", path)


def js_edges(graph: Graph, path: str, text: str, paths: set[str], routes: dict) -> None:
    source = f"file:{path}"
    for spec in JS_IMPORT.findall(text):
        if not spec.startswith("."):
            continue
        base = posixpath.normpath(posixpath.join(posixpath.dirname(path), spec))
        target = next((base + s for s in JS_SUFFIXES if base + s in paths), None)
        if target:
            graph.edge("imports", source, f"file:{target}")
        else:
            graph.miss(source, "imports", spec)
    for match in JS_FETCH.finditer(text):
        end = text.find(";", match.end())
        options = text[match.end(): end if end != -1 else None]
        found = JS_METHOD.search(options)
        method = found.group(1).upper() if found else "GET"
        endpoint = routes.get(route_key(method, match.group(2)))
        if endpoint:
            graph.edge("calls_endpoint", source, endpoint)
        else:
            graph.miss(source, "calls_endpoint", f"{method} {match.group(2)}")


def build_graph(files: list[dict], read) -> dict:
    """Build the graph from inventory records. `read(path)` returns bytes."""
    graph = Graph()
    paths = {f["path"] for f in files}
    texts = {}
    for record in files:
        graph.node("file", record["path"], role=record["role"], language=record["language"])
        if record["language"] in ("python", "javascript", "jsx"):
            raw = read(record["path"]).decode("utf-8", "replace")
            texts[record["path"]] = (record["language"], raw.replace("\r\n", "\n"))

    trees, prefixes = {}, {}
    for path, (lang, text) in sorted(texts.items()):
        if lang != "python":
            continue
        trees[path] = ast.parse(text, filename=path)
        bound = py_bindings(path, trees[path], paths)
        for target in sorted(set(bound.values()) - {path}):
            graph.edge("imports", f"file:{path}", f"file:{target}")
        prefixes.update(router_prefixes(trees[path], bound))
    for path, tree in trees.items():
        py_endpoints(graph, path, tree, prefixes.get(path, ""))

    routes = {
        route_key(n["method"], n["path"]): n["id"]
        for n in graph.nodes.values() if n["type"] == "endpoint"
    }
    for path, (lang, text) in sorted(texts.items()):
        if lang != "python":
            js_edges(graph, path, text, paths, routes)
    return graph.to_dict()


def render(graph: dict) -> str:
    return json.dumps(graph, indent=2, ensure_ascii=False) + "\n"


def build_repo(root: Path = ROOT) -> dict:
    files = inventory.build_repo(root)["files"]
    return build_graph(files, lambda p: (root / p).read_bytes())


def main() -> int:
    try:
        graph = build_repo()
    except (inventory.InventoryError, GraphError, SyntaxError) as error:
        print(error, file=sys.stderr)
        return 1
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(render(graph), encoding="utf-8", newline="\n")
    print(
        f"{len(graph['nodes'])} nodes, {len(graph['edges'])} edges, "
        f"{len(graph['unresolved'])} unresolved -> {OUT_FILE.relative_to(ROOT).as_posix()}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
