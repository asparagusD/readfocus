"""Build docs/repo-graph/inventory.json: one record per tracked file.

Usage, from the repo root:

    python tools/repo_graph/inventory.py

Each record has the file's path, language, line count, size, role and a
one-line purpose. Purposes are hand-written in purposes.json after reading
the file; the build fails if a file has none, or if a purpose points at a
file that is no longer inventoried. Binaries, lockfiles and generated graph
files are listed under "excluded" with a reason instead.

Output is deterministic: sorted paths, sizes and line counts taken after
normalising CRLF to LF, no timestamps. Standard library only.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
PURPOSES_FILE = Path(__file__).with_name("purposes.json")
OUT_FILE = ROOT / "docs" / "repo-graph" / "inventory.json"

ROLES = (
    "entry", "router", "agent", "service", "migration", "page", "component",
    "hook", "lib", "config", "test", "doc", "asset", "script",
)

BINARY_EXTENSIONS = {".png", ".pdf", ".svg", ".ico"}
LOCKFILES = {"package-lock.json"}
GENERATED_PREFIX = "docs/repo-graph/"

LANGUAGE_BY_NAME = {
    "Dockerfile": "dockerfile",
    "Makefile": "makefile",
    ".gitignore": "gitignore",
    ".env.example": "dotenv",
}
LANGUAGE_BY_EXTENSION = {
    ".py": "python", ".js": "javascript", ".jsx": "jsx", ".css": "css",
    ".html": "html", ".sql": "sql", ".md": "markdown", ".json": "json",
    ".toml": "toml", ".yml": "yaml", ".yaml": "yaml", ".txt": "text",
}

ENTRY_FILES = {
    "backend/main.py",
    "backend/mcp_server.py",
    "frontend/index.html",
    "frontend/src/main.jsx",
    "frontend/src/App.jsx",
}
# First matching prefix wins, so the specific ones come first.
ROLE_BY_PREFIX = (
    ("supabase/migrations/", "migration"),
    ("backend/routers/", "router"),
    ("backend/agents/", "agent"),
    ("backend/services/", "service"),
    ("backend/", "lib"),
    ("frontend/src/pages/", "page"),
    ("frontend/src/components/", "component"),
    ("frontend/src/hooks/", "hook"),
    ("frontend/src/lib/", "lib"),
    ("frontend/src/", "asset"),
    ("scripts/", "script"),
    ("tools/", "script"),
)


class InventoryError(Exception):
    """The inventory cannot be built; the message says what to fix."""


def tracked_files(root: Path = ROOT) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True
    )
    return sorted(p for p in result.stdout.decode("utf-8").split("\0") if p)


def exclusion_reason(path: str) -> str | None:
    pure = PurePosixPath(path)
    if path.startswith(GENERATED_PREFIX):
        return "generated"
    if pure.suffix.lower() in BINARY_EXTENSIONS:
        return "binary"
    if pure.name in LOCKFILES:
        return "lockfile"
    return None


def language(path: str) -> str:
    pure = PurePosixPath(path)
    if pure.name in LANGUAGE_BY_NAME:
        return LANGUAGE_BY_NAME[pure.name]
    return LANGUAGE_BY_EXTENSION.get(pure.suffix.lower(), "text")


def role(path: str) -> str:
    pure = PurePosixPath(path)
    if path in ENTRY_FILES:
        return "entry"
    if "tests" in pure.parts[:-1] or (
        pure.name.startswith("test_") and pure.suffix == ".py"
    ):
        return "test"
    for prefix, name in ROLE_BY_PREFIX:
        if path.startswith(prefix):
            return name
    return "doc" if pure.suffix == ".md" else "config"


def measure(data: bytes) -> tuple[int, int]:
    """Return (lines, size in bytes) with CRLF counted as LF."""
    data = data.replace(b"\r\n", b"\n")
    lines = data.count(b"\n")
    if data and not data.endswith(b"\n"):
        lines += 1
    return lines, len(data)


def build(paths: list[str], purposes: dict[str, str], read) -> dict:
    """Assemble the inventory. `read(path)` returns the file's bytes."""
    files, excluded, missing = [], [], []
    for path in sorted(paths):
        reason = exclusion_reason(path)
        if reason:
            excluded.append({"path": path, "reason": reason})
            continue
        purpose = purposes.get(path, "").strip()
        if not purpose:
            missing.append(path)
            continue
        lines, size = measure(read(path))
        files.append({
            "path": path,
            "language": language(path),
            "lines": lines,
            "size_bytes": size,
            "role": role(path),
            "purpose": purpose,
        })
    stale = sorted(set(purposes) - {f["path"] for f in files} - set(missing))
    if missing or stale:
        raise InventoryError(
            "purposes.json is out of date.\n"
            f"  No purpose (read the file, then add one): {missing}\n"
            f"  Purpose for a file that is not inventoried: {stale}"
        )
    return {
        "version": 1,
        "counts": {
            "tracked": len(paths),
            "inventoried": len(files),
            "excluded": len(excluded),
        },
        "files": files,
        "excluded": excluded,
    }


def render(inventory: dict) -> str:
    return json.dumps(inventory, indent=2, ensure_ascii=False) + "\n"


def build_repo(root: Path = ROOT) -> dict:
    purposes = json.loads(PURPOSES_FILE.read_text(encoding="utf-8"))
    return build(tracked_files(root), purposes, lambda p: (root / p).read_bytes())


def main() -> int:
    try:
        inventory = build_repo()
    except InventoryError as error:
        print(error, file=sys.stderr)
        return 1
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(render(inventory), encoding="utf-8", newline="\n")
    counts = inventory["counts"]
    print(
        f"{counts['tracked']} tracked = {counts['inventoried']} inventoried "
        f"+ {counts['excluded']} excluded -> {OUT_FILE.relative_to(ROOT).as_posix()}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
