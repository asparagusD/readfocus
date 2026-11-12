"""The deny-list for hard constraint 1 (CLAUDE.md): LLM and embedding providers the app must not use.

Kept in tooling, outside backend/, so that a search for these names over
the application finds nothing (Gate G3). backend/tests/test_no_paid_ai.py
imports it; the repo graph's banned services are in tools/repo_graph/build.py.
"""

import re

# Top-level modules of banned SDKs, and of the LangChain chat-model stack (LangGraph itself is allowed).
BANNED_MODULES = frozenset({
    "groq", "langchain_groq", "openai", "langchain_openai", "anthropic", "langchain_anthropic",
    "langchain_google_genai", "google_genai", "cerebras", "sambanova", "openrouter",
    "langchain", "langchain_community",
})
BANNED_MODULE_PREFIXES = ("google.generativeai", "google.genai")

# Distribution names that must not appear in requirements.txt.
BANNED_PACKAGES = frozenset({
    "groq", "langchain-groq", "openai", "langchain-openai", "anthropic", "langchain-anthropic",
    "google-generativeai", "google-genai", "langchain-google-genai", "langchain", "langchain-community",
    "cerebras-cloud-sdk", "sambanova", "openrouter",
})

# Environment variable names of provider keys.
BANNED_KEYS = re.compile(r"GROQ|GOOGLE_AI_STUDIO|GEMINI|OPENAI|ANTHROPIC|CEREBRAS|SAMBANOVA|OPENROUTER")

# Gate G3's search, case-insensitive: none of these may appear anywhere under backend/.
GATE_PATTERN = re.compile(
    r"groq|ChatGroq|google_genai|GoogleGenerativeAI|openai|cerebras|sambanova|openrouter", re.IGNORECASE
)
