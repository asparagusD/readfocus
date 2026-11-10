"""Render docs/repo-graph/REPO_MAP.md from the inventory and the graph.

Usage, from the repo root:

    python tools/repo_graph/render.py

The map has two Mermaid diagrams (the request path through the layers, and
the LangGraph wiring) and lookup tables for endpoints, database tables and
functions, external services, env vars and files. It is rebuilt from the
code every time; never edit it by hand. Standard library only.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:  # allow `python tools/repo_graph/render.py`
    sys.path.insert(0, str(ROOT))

from tools.repo_graph import build, inventory

OUT_FILE = ROOT / "docs" / "repo-graph" / "REPO_MAP.md"
API_CLIENT = "frontend/src/lib/api.js"
LAYERS = (
    ("caller", "Pages and components"), ("api", "API client"), ("router", "Routers"),
    ("agent", "Agents"), ("service", "Services and shared"),
)
BACKEND_LAYER = {"router": "router", "agent": "agent", "service": "service", "lib": "service"}
DATA_EDGES = ("reads_table", "writes_table", "calls_function")
SUPABASE = 'supabase[("Supabase: tables, RPC, auth")]'


def mid(name: str) -> str:
    """A Mermaid-safe node id."""
    return re.sub(r"\W", "_", name)


def code(items) -> str:
    return ", ".join(f"`{i}`" for i in sorted(items)) or "none"


def table(headers: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(c.replace("|", "\\|") for c in row) + " |" for row in rows]
    return [*lines, ""]


class View:
    """Lookups over graph.json. File ids lose their `file:` prefix."""

    def __init__(self, graph: dict) -> None:
        self.nodes = {n["id"]: n for n in graph["nodes"]}
        self.out, self.into = defaultdict(list), defaultdict(list)
        for edge in graph["edges"]:
            self.out[edge["type"], edge["from"]].append(edge)
            self.into[edge["type"], edge["to"]].append(edge)

    def of_type(self, node_type: str) -> list[dict]:
        return [n for n in self.nodes.values() if n["type"] == node_type]

    def sources(self, edge_type: str, node_id: str) -> list[str]:
        return sorted(e["from"][5:] for e in self.into[edge_type, node_id])

    def layer(self, node: dict) -> str | None:
        path = node["id"][5:]
        if path == API_CLIENT:
            return "api"
        if self.out["calls_endpoint", node["id"]]:
            return "caller"
        if path.startswith("backend/") and not path.endswith("__init__.py"):
            return BACKEND_LAYER.get(node["role"])
        return None


def layer_diagram(view: View) -> list[str]:
    """Pages -> API client -> routers -> agents and services -> Supabase / external."""
    layers = {n["id"]: view.layer(n) for n in view.of_type("file")}
    links, sinks = set(), {}
    api = f"file:{API_CLIENT}"
    for file_id, layer in layers.items():
        if layer == "caller":
            links.add((file_id, api))
            for edge in view.out["calls_endpoint", file_id]:
                links.add((api, "file:" + view.sources("defines_endpoint", edge["to"])[0]))
        if layer not in BACKEND_LAYER:
            continue
        for edge in view.out["imports", file_id]:
            if layers.get(edge["to"]) in ("agent", "service"):
                links.add((file_id, edge["to"]))
        if any(view.out[t, file_id] for t in DATA_EDGES):
            links.add((file_id, "supabase"))
            sinks["supabase"] = SUPABASE
        for edge in view.out["calls_external", file_id]:
            node = view.nodes[edge["to"]]
            name = edge["to"].split(":", 1)[1]
            if name == "supabase":
                links.add((file_id, "supabase"))
                sinks["supabase"] = SUPABASE
                continue
            label = f"{name} (banned)" if node["banned"] else name
            sinks[mid(edge["to"])] = f'{mid(edge["to"])}["{label}"]' + (
                ":::banned" if node["banned"] else ""
            )
            links.add((file_id, mid(edge["to"])))
    shown = {end for link in links for end in link}
    lines = ["```mermaid", "flowchart LR"]
    for key, title in LAYERS:
        members = sorted(f for f, layer in layers.items() if layer == key and f in shown)
        lines.append(f'  subgraph {key}["{title}"]')
        lines += [f'    {mid(f)}["{f.rsplit("/", 1)[-1]}"]' for f in members]
        lines.append("  end")
    lines.append('  subgraph sink["Supabase and external"]')
    lines += [f"    {sinks[k]}" for k in sorted(sinks)]
    lines.append("  end")
    lines += [f"  {mid(a)} --> {mid(b)}" for a, b in sorted(links)]
    lines.append("  classDef banned stroke:#c0392b,stroke-width:2px")
    return [*lines, "```", ""]


def langgraph_diagram(view: View) -> list[str]:
    lines = ["```mermaid", "flowchart TD"]
    for node in view.of_type("graph_node"):
        name = node["id"].split(":", 1)[1]
        if "handler" in node:
            where = node.get("handler_file", "?").rsplit("/", 1)[-1]
            lines.append(f'  {mid(node["id"])}["{name}<br/>{node["handler"]} in {where}"]')
        else:
            lines.append(f'  {mid(node["id"])}(["{name}"])')
        for edge in sorted(view.out["graph_edge", node["id"]], key=lambda e: e["to"]):
            arrow = "-.->" if edge.get("conditional") else "-->"
            lines.append(f'  {mid(edge["from"])} {arrow} {mid(edge["to"])}')
    return [*lines, "```", ""]


def render_map(graph: dict, inv: dict) -> str:
    view = View(graph)
    counts = inv["counts"]
    doc = [
        "# Repository map",
        "",
        "Generated by `tools/repo_graph/render.py` from `inventory.json` and",
        "`graph.json`. Do not edit by hand; regenerate it instead.",
        "",
        (f"{counts['inventoried']} files inventoried, {counts['excluded']} excluded, "
         f"{len(graph['nodes'])} graph nodes, {len(graph['edges'])} edges, "
         f"{len(graph['unresolved'])} unresolved references."),
        "",
        "## Layers",
        "",
        "How a request travels. An arrow means the left file imports or calls the",
        "right one. Files with no such link are left out.",
        "",
        *layer_diagram(view),
        "## LangGraph wiring",
        "",
        "Dotted arrows are conditional edges.",
        "",
        *langgraph_diagram(view),
        "## Endpoints",
        "",
        *table(["Endpoint", "Handler", "Defined in", "Frontend callers"], [
            [f"`{n['method']} {n['path']}`", f"`{n['handler']}`",
             code(view.sources("defines_endpoint", n["id"])),
             code(view.sources("calls_endpoint", n["id"]))]
            for n in view.of_type("endpoint")
        ]),
        "## Database tables",
        "",
        *table(["Table", "Defined in", "Altered by", "Readers", "Writers"], [
            [f"`{n['id'][6:]}`", *(code(view.sources(t, n["id"])) for t in (
                "defines_table", "alters_table", "reads_table", "writes_table"))]
            for n in view.of_type("table")
        ]),
        "## Database functions",
        "",
        *table(["Function", "Defined in", "Called by"], [
            [f"`{n['id'][9:]}`", code(view.sources("defines_function", n["id"])),
             code(view.sources("calls_function", n["id"]))]
            for n in view.of_type("function")
        ]),
        "## External services",
        "",
        "Each use is the file and line of the first import of that service.",
        "",
        *table(["Service", "Banned by CLAUDE.md", "Used at"], [
            [f"`{n['id'][9:]}`", "yes" if n["banned"] else "no",
             code(f"{e['from'][5:]}:{e['line']}" for e in view.into["calls_external", n["id"]])]
            for n in view.of_type("external")
        ]),
        "## Environment variables",
        "",
        *table(["Variable", "Declared in", "Read by"], [
            [f"`{n['id'][4:]}`", code(view.sources("declares_env", n["id"])),
             code(view.sources("uses_env", n["id"]))]
            for n in view.of_type("env")
        ]),
        "## Files",
        "",
    ]
    for role in inventory.ROLES:
        files = [f for f in inv["files"] if f["role"] == role]
        if files:
            doc += [f"### {role} ({len(files)})", ""]
            doc += table(["File", "Lines", "Purpose"], [
                [f"`{f['path']}`", str(f["lines"]), f["purpose"]] for f in files
            ])
    return "\n".join(doc).rstrip("\n") + "\n"


def main() -> int:
    try:
        inv = inventory.build_repo()
        graph = build.build_graph(inv["files"], lambda p: (ROOT / p).read_bytes())
    except (inventory.InventoryError, build.GraphError, SyntaxError) as error:
        print(error, file=sys.stderr)
        return 1
    OUT_FILE.write_text(render_map(graph, inv), encoding="utf-8", newline="\n")
    print(f"wrote {OUT_FILE.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
