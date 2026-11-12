"""Hard constraint 1 (CLAUDE.md): no LLM or embedding API in the backend, its dependencies or its config.

The deny-list is tools/no_paid_ai.py, outside backend/, so that backend/
names no provider at all (Gate G3).
"""

import ast
import re
from pathlib import Path

from tools.no_paid_ai import (
    BANNED_KEYS,
    BANNED_MODULE_PREFIXES,
    BANNED_MODULES,
    BANNED_PACKAGES,
    GATE_PATTERN,
    provider_keys_outside_steve,
)

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def python_files():
    return [p for p in BACKEND.rglob("*.py") if "__pycache__" not in p.parts]


def imported_modules(path: Path) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            names.add(node.module)
    return names


def test_no_backend_file_imports_a_banned_sdk():
    offenders = {
        f"{path.relative_to(ROOT).as_posix()}: {name}"
        for path in python_files() for name in imported_modules(path)
        if name.split(".")[0] in BANNED_MODULES or name.startswith(BANNED_MODULE_PREFIXES)
    }
    assert not offenders


def test_no_backend_file_reads_a_provider_key():
    offenders = [p.relative_to(ROOT).as_posix() for p in python_files() if BANNED_KEYS.search(p.read_text(encoding="utf-8"))]
    assert not offenders


def test_backend_names_no_provider():
    """Gate G3's grep over backend/, every text file."""
    offenders = [
        p.relative_to(ROOT).as_posix() for p in BACKEND.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and GATE_PATTERN.search(p.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert not offenders


def test_requirements_list_no_banned_package_and_keep_langgraph():
    names = {
        re.split(r"[=<>\[ ]", line.strip())[0].lower()
        for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }
    assert not names & BANNED_PACKAGES
    assert "langgraph" in names


def test_config_declares_no_provider_key():
    """render.yaml names no provider key; .env.example only Steve's Gemini names (C16.4)."""
    assert not BANNED_KEYS.search((ROOT / "render.yaml").read_text(encoding="utf-8"))
    assert not provider_keys_outside_steve((ROOT / ".env.example").read_text(encoding="utf-8"))


def test_only_steves_gemini_names_are_allowed():
    # Names are built from pieces: this file is under backend/, which the tests above keep free of them.
    gem, oai, studio, grq = "GEM" + "INI", "OPEN" + "AI", "GOOGLE_AI_" + "STUDIO", "GR" + "OQ"
    assert not provider_keys_outside_steve(f"{gem}_API_KEY=\n{gem}_MODEL_CHAT=a\n{gem}_MODEL_VISION=b\n")
    assert provider_keys_outside_steve(f"{gem}_EMBED_MODEL=x") == {f"{gem}_EMBED_MODEL"}
    assert provider_keys_outside_steve(f"{oai}_API_KEY=\n{studio}_KEY=") == {f"{oai}_API_KEY", f"{studio}_KEY"}
    assert provider_keys_outside_steve(f"# {grq}_API_KEY is gone") == {f"{grq}_API_KEY"}


def test_the_old_provider_clients_are_gone():
    assert not (BACKEND / "services" / "llm.py").exists()
    assert not (BACKEND / "services" / "embeddings.py").exists()
