"""Build docs/repo-graph/graph.json: a typed dependency graph of the repo.

Usage, from the repo root:

    python tools/repo_graph/build.py

Node types: file (from the inventory), endpoint, table, function, env,
external, graph_node. Edges:

    imports           file -> file        Python via ast, JS/JSX via regex
    defines_endpoint  file -> endpoint    FastAPI decorators + include_router prefixes
    calls_endpoint    file -> endpoint    frontend fetchApi('/...') calls
    reads_table       file -> table       .table("x").select(...), table_name="x"
    writes_table      file -> table       .table("x").insert/update/upsert/delete
    calls_function    file -> function    .rpc("fn"), query_name="fn"
    defines_table     file -> table       CREATE TABLE in a migration
    alters_table      file -> table       ALTER TABLE ... ADD COLUMN in a migration
    defines_function  file -> function    CREATE FUNCTION in a migration
    uses_env          file -> env         os.getenv, os.environ, import.meta.env
    declares_env      file -> env         KEY= in .env.example, "- key:" in YAML
    calls_external    file -> external    imports of third-party services, with the
                                          line of first use; `banned` marks providers
                                          ruled out by CLAUDE.md
    graph_node        file -> graph_node  LangGraph add_node
    graph_edge        graph_node -> graph_node  add_edge, add_conditional_edges

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

NODE_TYPES = ("file", "endpoint", "table", "function", "env", "external", "graph_node")
EDGE_TYPES = (
    "imports", "defines_endpoint", "calls_endpoint", "reads_table", "writes_table",
    "calls_function", "defines_table", "alters_table", "defines_function",
    "uses_env", "declares_env", "calls_external", "graph_node", "graph_edge",
)

# Import name (Python top-level module or JS package) -> external service.
EXTERNALS = {
    "groq": "groq", "langchain_groq": "groq",
    "langchain_google_genai": "google_ai_studio", "google": "google_ai_studio",
    "openai": "openai", "langchain_openai": "openai",
    "anthropic": "anthropic", "langchain_anthropic": "anthropic",
    "langchain": "langchain", "langchain_core": "langchain",
    "langchain_community": "langchain", "langgraph": "langgraph",
    "mcp": "mcp", "langchain_mcp_adapters": "mcp",
    "supabase": "supabase", "@supabase/supabase-js": "supabase",
    "fonts.googleapis.com": "google_fonts",
}
BANNED_SERVICES = {"groq", "google_ai_studio", "openai", "anthropic"}
# The graph tooling quotes the patterns it searches for, so it is only scanned
# for imports, not for tables, env vars or services.
SELF_PREFIX = "tools/repo_graph/"
WRITE_METHODS = {"insert", "update", "upsert", "delete"}
PY_TABLE = re.compile(r"""\.table\(\s*["'](\w+)["']\s*\)\s*\.(\w+)""")
SQL = re.IGNORECASE
# language -> (regex with one group, edge type, node type)
TEXT_PATTERNS = {
    "python": (
        (re.compile(r"""table_name\s*=\s*["'](\w+)["']"""), "reads_table", "table"),
        (re.compile(r"""\.rpc\(\s*["'](\w+)["']"""), "calls_function", "function"),
        (re.compile(r"""query_name\s*=\s*["'](\w+)["']"""), "calls_function", "function"),
        (re.compile(r"""os\.(?:getenv\(|environ\.get\(|environ\[)\s*["'](\w+)["']"""),
         "uses_env", "env"),
    ),
    "sql": (
        (re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)", SQL),
         "defines_table", "table"),
        (re.compile(r"ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+COLUMN", SQL),
         "alters_table", "table"),
        (re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)", SQL),
         "defines_function", "function"),
    ),
    "dotenv": ((re.compile(r"^([A-Z][A-Z0-9_]*)=", re.MULTILINE), "declares_env", "env"),),
    "yaml": ((re.compile(r"^\s*-\s*key:\s*(\w+)", re.MULTILINE), "declares_env", "env"),),
}
JS_ENV = ((re.compile(r"import\.meta\.env\.([A-Z][A-Z0-9_]*)"), "uses_env", "env"),)
TEXT_PATTERNS["javascript"] = TEXT_PATTERNS["jsx"] = JS_ENV
TEXT_PATTERNS["html"] = ()

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
        key = (edge_type, source, target)
        old = self.edges.get(key)
        if old is None or attrs.get("line", 0) < old.get("line", 0):  # keep first use
            self.edges[key] = {"type": edge_type, "from": source, "to": target, **attrs}

    def miss(self, source: str, edge_type: str, target: str) -> None:
        self.unresolved.append({"from": source, "type": edge_type, "target": target})

    def to_dict(self) -> dict:
        for node in self.nodes.values():
            if node["type"] not in NODE_TYPES:
                raise GraphError(f"unknown node type: {node['type']}")
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


def line_of(text: str, position: int) -> int:
    return text.count("\n", 0, position) + 1


def external(graph: Graph, source: str, name: str, line: int) -> None:
    service = EXTERNALS.get(name)
    if service:
        node = graph.node("external", service, banned=service in BANNED_SERVICES)
        graph.edge("calls_external", source, node, line=line)


def graph_name(node: ast.AST) -> str | None:
    """Name of a LangGraph node given as a string or as START / END."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and node.id in ("START", "END"):
        return f"__{node.id.lower()}__"
    return None


def py_edges(graph: Graph, path: str, text: str, tree: ast.AST, bound: dict) -> None:
    """Table access, third-party services and LangGraph wiring in a Python file."""
    source = f"file:{path}"
    for table, method in PY_TABLE.findall(text):
        kind = "writes_table" if method in WRITE_METHODS else "reads_table"
        graph.edge(kind, source, graph.node("table", table))
    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                external(graph, source, alias.name.split(".")[0], node.lineno)
        elif isinstance(node, ast.ImportFrom) and not node.level:
            external(graph, source, (node.module or "").split(".")[0], node.lineno)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            calls.append((node.func.attr, node.args, [graph_name(a) for a in node.args]))
    for attr, args, names in calls:  # nodes first, so each keeps its handler
        if attr == "add_node" and names and names[0]:
            attrs = {}
            if len(args) > 1 and isinstance(args[1], ast.Name):
                attrs["handler"] = args[1].id
                if args[1].id in bound:
                    attrs["handler_file"] = bound[args[1].id]
            graph.edge("graph_node", source, graph.node("graph_node", names[0], **attrs))
    for attr, args, names in calls:
        if attr == "add_edge" and len(names) > 1 and names[0] and names[1]:
            graph.edge("graph_edge", graph.node("graph_node", names[0]),
                       graph.node("graph_node", names[1]))
        elif (attr == "add_conditional_edges" and names and names[0]
              and len(args) > 2 and isinstance(args[2], ast.Dict)):
            for target in filter(None, map(graph_name, args[2].values)):
                graph.edge("graph_edge", graph.node("graph_node", names[0]),
                           graph.node("graph_node", target), conditional=True)


def text_edges(graph: Graph, path: str, lang: str, text: str) -> None:
    """Edges found by one-group regexes: env vars, SQL objects, RPC calls."""
    source = f"file:{path}"
    for regex, edge_type, node_type in TEXT_PATTERNS[lang]:
        for name in regex.findall(text):
            graph.edge(edge_type, source, graph.node(node_type, name))
    if lang == "html":
        for host in (h for h in EXTERNALS if "." in h and h in text):
            external(graph, source, host, line_of(text, text.index(host)))


def route_key(method: str, path: str) -> str:
    """Compare routes with every path parameter reduced to `{}`."""
    return f"{method} " + re.sub(r"\$?\{[^}]*\}", "{}", path)


def js_edges(graph: Graph, path: str, text: str, paths: set[str], routes: dict) -> None:
    source = f"file:{path}"
    for found in JS_IMPORT.finditer(text):
        spec = found.group(1)
        if not spec.startswith("."):
            external(graph, source, spec, line_of(text, found.start(1)))
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
        if record["language"] in TEXT_PATTERNS:
            raw = read(record["path"]).decode("utf-8", "replace")
            texts[record["path"]] = (record["language"], raw.replace("\r\n", "\n"))

    trees, prefixes = {}, {}
    for path, (lang, text) in sorted(texts.items()):
        scan = not path.startswith(SELF_PREFIX)
        if scan:
            text_edges(graph, path, lang, text)
        if lang != "python":
            continue
        trees[path] = ast.parse(text, filename=path)
        bound = py_bindings(path, trees[path], paths)
        for target in sorted(set(bound.values()) - {path}):
            graph.edge("imports", f"file:{path}", f"file:{target}")
        prefixes.update(router_prefixes(trees[path], bound))
        if scan:
            py_edges(graph, path, text, trees[path], bound)
    for path, tree in trees.items():
        py_endpoints(graph, path, tree, prefixes.get(path, ""))

    routes = {
        route_key(n["method"], n["path"]): n["id"]
        for n in graph.nodes.values() if n["type"] == "endpoint"
    }
    for path, (lang, text) in sorted(texts.items()):
        if lang in ("javascript", "jsx"):
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
