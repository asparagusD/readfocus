"""Only backend/steve/provider.py may import Google's Gemini SDK (CLAUDE.md constraint 1, steve-guardrails 1). C25.2.

Repo-wide, not just backend/ (backend/tests/test_no_paid_ai.py covers that with the rest of the deny-list):

- every Python file git knows (tracked or not ignored): its imports, read with ast, may not reach google.genai or
  google.generativeai, except in the provider;
- the frontend: no Google AI package in frontend/package.json, and no file in frontend/src importing one or naming
  Gemini's API host (the browser never calls Google; our backend does).

    python tools/check_gemini_sdk.py      # exit 1 and the offenders when anything else imports it
"""

import ast
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.no_paid_ai import STEVE_PROVIDER, steve_sdk_allowed  # noqa: E402 - after the path is set

SDK_PREFIXES = ("google.genai", "google.generativeai")
JS_PACKAGES = re.compile(r"^@google/(genai|generative-ai)$|^@google-cloud/vertexai$")
JS_IMPORT = re.compile(r"""(?:from|import\(|require\()\s*['"](@google/(?:genai|generative-ai)|@google-cloud/vertexai)""")
GEMINI_HOST = "generativelanguage.googleapis.com"


def python_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "*.py"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return sorted({line for line in out.splitlines() if line and (ROOT / line).is_file()})


def imports(path: Path) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path))):
        if isinstance(node, ast.Import):
            names |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            names.add(node.module)
            names |= {f"{node.module}.{alias.name}" for alias in node.names}  # from google import genai
    return names


def python_offenders() -> list[str]:
    return [f"{rel}: {name}" for rel in python_files() for name in sorted(imports(ROOT / rel))
            if name.startswith(SDK_PREFIXES) and not steve_sdk_allowed(rel, name)]


def frontend_offenders() -> list[str]:
    found = []
    package = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    for group in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
        found += [f"frontend/package.json: {group} {name}" for name in package.get(group, {}) if JS_PACKAGES.match(name)]
    for path in sorted((ROOT / "frontend" / "src").rglob("*")):
        if path.suffix in (".js", ".jsx", ".mjs", ".ts", ".tsx") and path.is_file():
            text = path.read_text(encoding="utf-8", errors="ignore")
            rel = path.relative_to(ROOT).as_posix()
            found += [f"{rel}: imports {m}" for m in JS_IMPORT.findall(text)]
            if GEMINI_HOST in text:
                found.append(f"{rel}: names {GEMINI_HOST}")
    return found


def offenders() -> list[str]:
    return python_offenders() + frontend_offenders()


def main() -> int:
    found = offenders()
    for line in found:
        print(f"::error::{line}")
    files = len(python_files())
    print(f"Gemini SDK: {files} Python files and frontend/src checked; only {STEVE_PROVIDER} may import it; "
          f"{len(found)} offender(s).")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
