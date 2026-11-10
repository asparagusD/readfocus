"""Query the repo graph: what a file, endpoint or table touches, and what touches it.

Usage, from the repo root:

    python tools/repo_graph/query.py backend/routers/sessions.py
    python tools/repo_graph/query.py /sessions/start
    python tools/repo_graph/query.py "POST /sessions/{id}/abandon"
    python tools/repo_graph/query.py reading_progress

The target can also be a database function, an env var, an external service
or a LangGraph node. For a file it prints who imports it, what it imports,
and its endpoints, tables, env vars and external calls.

Git Bash on Windows rewrites an argument that starts with `/` into a Windows
path before Python sees it. There, give the method ("POST /sessions/start")
or set MSYS_NO_PATHCONV=1. PowerShell passes it through unchanged.

Reads docs/repo-graph/graph.json and inventory.json; run `make graph` first
if the code has changed. Exit codes: 0 found, 1 graph files missing,
2 nothing matches. Standard library only.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:  # allow `python tools/repo_graph/query.py`
    sys.path.insert(0, str(ROOT))

from tools.repo_graph import build
from tools.repo_graph.render import View

GRAPH_DIR = ROOT / "docs" / "repo-graph"
ENDPOINT = re.compile(r"^(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(/.*)$", re.IGNORECASE)

# edge type -> (heading when the node is the target, heading when it is the source)
HEADINGS = {
    "imports": ("Imported by", "Imports"),
    "defines_endpoint": ("Defined in", "Defines endpoints"),
    "calls_endpoint": ("Called by", "Calls endpoints"),
    "reads_table": ("Read by", "Reads tables"),
    "writes_table": ("Written by", "Writes tables"),
    "calls_function": ("Called by", "Calls database functions"),
    "defines_table": ("Defined in", "Defines tables"),
    "alters_table": ("Altered by", "Alters tables"),
    "defines_function": ("Defined in", "Defines database functions"),
    "uses_env": ("Read by", "Reads env vars"),
    "declares_env": ("Declared in", "Declares env vars"),
    "calls_external": ("Used by", "External calls"),
    "graph_node": ("Registered in", "Registers LangGraph nodes"),
    "graph_edge": ("LangGraph edges from", "LangGraph edges to"),
}


def normalise_path(target: str) -> str:
    """Accept Windows separators, a leading ./ and absolute paths inside the repo."""
    path = target.replace("\\", "/")
    if Path(target).is_absolute():
        try:
            path = Path(target).resolve().relative_to(ROOT).as_posix()
        except ValueError:
            pass
    return path.removeprefix("./")


def resolve(view: View, target: str) -> list[str]:
    """Node ids the target names: a file, endpoints, or any other node by name."""
    file_id = f"file:{normalise_path(target)}"
    if file_id in view.nodes:
        return [file_id]
    found = ENDPOINT.match(target.strip())
    if found:
        method, path = found.group(1), found.group(2)
        return [
            n["id"] for n in view.of_type("endpoint")
            if build.route_key("", n["path"]) == build.route_key("", path)
            and (method is None or method.upper() == n["method"])
        ]
    return [
        f"{node_type}:{target}" for node_type in build.NODE_TYPES
        if f"{node_type}:{target}" in view.nodes
    ]


def suggestions(view: View, target: str) -> list[str]:
    needle = normalise_path(target).lower()
    return [i.split(":", 1)[1] for i in view.nodes if needle in i.lower()][:8]


def item(view: View, edge: dict, end: str) -> str:
    node = view.nodes[edge[end]]
    text = edge[end].split(":", 1)[1]
    if node.get("banned"):
        text += " (banned)"
    if "line" in edge:
        text += f" (line {edge['line']})"
    if edge.get("conditional"):
        text += " (conditional)"
    return text


def describe(view: View, node_id: str, files: dict) -> list[str]:
    node = view.nodes[node_id]
    name = node_id.split(":", 1)[1]
    facts = [node["type"]]
    if node["type"] == "file":
        facts = [node["role"], node["language"]]
        if name in files:
            facts.append(f"{files[name]['lines']} lines")
    if "handler" in node:
        facts.append(f"handler {node['handler']}")
    if "handler_file" in node:
        facts.append(f"in {node['handler_file']}")
    if node.get("banned"):
        facts.append("banned by CLAUDE.md")
    lines = [f"{name}  [{', '.join(facts)}]"]
    if name in files:
        lines.append(f"  {files[name]['purpose']}")
    for edge_type in build.EDGE_TYPES:
        sides = (("from", view.into[edge_type, node_id]), ("to", view.out[edge_type, node_id]))
        for heading, (end, edges) in zip(HEADINGS[edge_type], sides):
            if edges:
                lines.append(f"{heading} ({len(edges)}):")
                lines += [f"  {text}" for text in sorted(item(view, e, end) for e in edges)]
            elif node["type"] == "file" and edge_type == "imports":
                lines.append(f"{heading} (0): none")
    handled = [
        n["id"].split(":", 1)[1] for n in view.of_type("graph_node")
        if n.get("handler_file") == name
    ]
    if handled:
        lines += [f"Handles LangGraph nodes ({len(handled)}):", *(f"  {h}" for h in handled)]
    return lines


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if args and args[0] in ("-h", "--help") else 2
    try:
        graph = json.loads((GRAPH_DIR / "graph.json").read_text(encoding="utf-8"))
        inv = json.loads((GRAPH_DIR / "inventory.json").read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        print(f"{error.filename} is missing; run `make graph`.", file=sys.stderr)
        return 1
    view = View(graph)
    matches = resolve(view, args[0])
    if not matches:
        print(f"Nothing in the graph matches {args[0]!r}.", file=sys.stderr)
        for hint in suggestions(view, args[0]):
            print(f"  did you mean: {hint}", file=sys.stderr)
        return 2
    files = {f["path"]: f for f in inv["files"]}
    print("\n\n".join("\n".join(describe(view, m, files)) for m in matches))
    return 0


if __name__ == "__main__":
    sys.exit(main())
