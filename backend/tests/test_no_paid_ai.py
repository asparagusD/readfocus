"""Hard constraint 1 (CLAUDE.md): no LLM or embedding API in the backend, its dependencies or its config.

This file names the banned providers on purpose, so it is the one file the
free-intelligence grep is expected to list.
"""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
THIS = Path(__file__).resolve()

# Top-level modules of banned SDKs, and of the LangChain chat-model stack (LangGraph itself is allowed).
BANNED_MODULES = {
    "groq", "langchain_groq", "openai", "langchain_openai", "anthropic", "langchain_anthropic",
    "langchain_google_genai", "google_genai", "cerebras", "sambanova", "openrouter",
    "langchain", "langchain_community",
}
BANNED_GOOGLE = ("google.generativeai", "google.genai")
BANNED_PACKAGES = {
    "groq", "langchain-groq", "openai", "langchain-openai", "anthropic", "langchain-anthropic",
    "google-generativeai", "google-genai", "langchain-google-genai", "langchain", "langchain-community",
    "cerebras-cloud-sdk", "sambanova", "openrouter",
}
BANNED_KEYS = re.compile(r"GROQ|GOOGLE_AI_STUDIO|GEMINI|OPENAI|ANTHROPIC|CEREBRAS|SAMBANOVA|OPENROUTER")


def python_files():
    return [p for p in BACKEND.rglob("*.py") if p.resolve() != THIS and ".venv" not in p.parts]


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
        if name.split(".")[0] in BANNED_MODULES or name.startswith(BANNED_GOOGLE)
    }
    assert not offenders


def test_no_backend_file_reads_a_provider_key():
    offenders = [p.relative_to(ROOT).as_posix() for p in python_files() if BANNED_KEYS.search(p.read_text(encoding="utf-8"))]
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
    for name in (".env.example", "render.yaml"):
        assert not BANNED_KEYS.search((ROOT / name).read_text(encoding="utf-8")), name


def test_the_old_provider_clients_are_gone():
    assert not (BACKEND / "services" / "llm.py").exists()
    assert not (BACKEND / "services" / "embeddings.py").exists()
