"""Tests for tools/repo_graph/inventory.py."""

import pytest

from tools.repo_graph import inventory as inv


@pytest.mark.parametrize("path, expected", [
    ("backend/main.py", "entry"),
    ("frontend/src/App.jsx", "entry"),
    ("backend/routers/books.py", "router"),
    ("backend/agents/graph.py", "agent"),
    ("backend/services/llm.py", "service"),
    ("backend/dependencies.py", "lib"),
    ("supabase/migrations/001_initial.sql", "migration"),
    ("frontend/src/pages/Library.css", "page"),
    ("frontend/src/components/ui/Button.jsx", "component"),
    ("frontend/src/hooks/useAuth.jsx", "hook"),
    ("frontend/src/lib/api.js", "lib"),
    ("frontend/src/index.css", "asset"),
    ("backend/tests/test_health.py", "test"),
    ("test_planner.py", "test"),
    ("tools/repo_graph/tests/test_inventory.py", "test"),
    ("tools/repo_graph/inventory.py", "script"),
    ("scripts/dev/create_test_users.py", "script"),
    (".claude/skills/repo-graph/SKILL.md", "doc"),
    ("frontend/vite.config.js", "config"),
    ("Makefile", "config"),
])
def test_role(path, expected):
    assert inv.role(path) == expected


@pytest.mark.parametrize("path, expected", [
    ("backend/main.py", "python"),
    ("frontend/src/App.jsx", "jsx"),
    ("render.yaml", "yaml"),
    ("Dockerfile", "dockerfile"),
    ("frontend/.env.example", "dotenv"),
    ("LICENSE", "text"),
])
def test_language(path, expected):
    assert inv.language(path) == expected


@pytest.mark.parametrize("path, expected", [
    ("sample.pdf", "binary"),
    ("frontend/public/favicon.svg", "binary"),
    ("frontend/package-lock.json", "lockfile"),
    ("docs/repo-graph/inventory.json", "generated"),
    ("frontend/package.json", None),
])
def test_exclusion_reason(path, expected):
    assert inv.exclusion_reason(path) == expected


def test_measure_counts_crlf_as_lf():
    assert inv.measure(b"a\r\nb\r\n") == inv.measure(b"a\nb\n") == (2, 4)
    assert inv.measure(b"no newline") == (1, 10)
    assert inv.measure(b"") == (0, 0)


def test_build_sorts_and_counts():
    result = inv.build(
        ["b.py", "a.md", "x.png"], {"a.md": "Doc.", "b.py": "Code."}, lambda p: b"x\n"
    )
    assert [f["path"] for f in result["files"]] == ["a.md", "b.py"]
    assert result["excluded"] == [{"path": "x.png", "reason": "binary"}]
    assert result["counts"] == {"tracked": 3, "inventoried": 2, "excluded": 1}


def test_build_rejects_missing_and_stale_purposes():
    with pytest.raises(inv.InventoryError, match="a.py"):
        inv.build(["a.py"], {}, lambda p: b"")
    with pytest.raises(inv.InventoryError, match="gone.py"):
        inv.build(["a.py"], {"a.py": "Code.", "gone.py": "Old."}, lambda p: b"")


def test_repo_inventory_is_complete_and_deterministic():
    first = inv.build_repo()
    counts = first["counts"]
    assert counts["tracked"] == counts["inventoried"] + counts["excluded"]
    assert counts["tracked"] == len(inv.tracked_files())
    assert {f["role"] for f in first["files"]} <= set(inv.ROLES)
    assert inv.render(first) == inv.render(inv.build_repo())
