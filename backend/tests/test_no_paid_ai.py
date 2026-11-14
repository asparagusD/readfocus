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
    STEVE_PACKAGES,
    STEVE_PROVIDER,
    provider_keys_outside_steve,
    steve_gate_text,
    steve_sdk_allowed,
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
            names |= {f"{node.module}.{alias.name}" for alias in node.names}  # from google import genai
    return names


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def test_no_backend_file_imports_a_banned_sdk():
    offenders = {
        f"{rel(path)}: {name}"
        for path in python_files() for name in imported_modules(path)
        if (name.split(".")[0] in BANNED_MODULES or name.startswith(BANNED_MODULE_PREFIXES))
        and not steve_sdk_allowed(rel(path), name)
    }
    assert not offenders


def test_no_backend_file_reads_a_provider_key():
    """Only Steve's provider may name his three Gemini variables (C20.2); no file names any other key."""
    offenders = [
        rel(p) for p in python_files()
        if (provider_keys_outside_steve(p.read_text(encoding="utf-8")) if rel(p) == STEVE_PROVIDER
            else BANNED_KEYS.search(p.read_text(encoding="utf-8")))
    ]
    assert not offenders


def test_backend_names_no_provider():
    """Gate G3's grep over backend/, every text file."""
    offenders = [
        p.relative_to(ROOT).as_posix() for p in BACKEND.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts
        and GATE_PATTERN.search(steve_gate_text(rel(p), p.read_text(encoding="utf-8", errors="ignore")))
    ]
    assert not offenders


def test_requirements_list_no_banned_package_and_keep_langgraph():
    names = {
        re.split(r"[=<>\[ ]", line.strip())[0].lower()
        for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }
    assert not names & (BANNED_PACKAGES - STEVE_PACKAGES)
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


def test_only_steves_provider_may_import_the_gemini_sdk():
    """C20.2: the guard is narrowed to one file, backend/steve/provider.py, and nothing else."""
    sdk, sub = "google" + ".genai", "google" + ".genai.types"
    assert steve_sdk_allowed(STEVE_PROVIDER, sdk) and steve_sdk_allowed(STEVE_PROVIDER, sub)
    for other in ("backend/steve/service.py", "backend/routers/steve.py", "backend/steve/provider_extra.py",
                  "backend/tests/test_steve_provider.py"):
        assert not steve_sdk_allowed(other, sdk), other
    assert not steve_sdk_allowed(STEVE_PROVIDER, "open" + "ai")
    assert not steve_sdk_allowed(STEVE_PROVIDER, "google" + ".generativeai")


def test_the_provider_is_the_one_file_that_imports_the_sdk():
    importers = {rel(p) for p in python_files() if any(n.startswith("google" + ".genai") for n in imported_modules(p))}
    assert importers == {STEVE_PROVIDER}


def test_a_second_file_naming_the_sdk_or_a_gemini_variable_is_still_caught():
    gem = "GEM" + "INI"
    assert BANNED_KEYS.search(f"os.environ['{gem}_API_KEY']")  # checked in every file but the provider
    assert steve_gate_text("backend/steve/service.py", "google" + "_genai") == "google" + "_genai"
    assert steve_gate_text(STEVE_PROVIDER, "logging.getLogger('google" + "_genai')") == "logging.getLogger('')"
    assert GATE_PATTERN.search(steve_gate_text(STEVE_PROVIDER, "import open" + "ai"))
