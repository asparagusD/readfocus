"""requirements.txt lists every package backend/ imports, each pinned."""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUIREMENTS = ROOT / "requirements.txt"

# Import name -> distribution name, where they differ.
DISTRIBUTION = {"bs4": "beautifulsoup4", "dotenv": "python-dotenv"}


def normalise(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def requirement_lines():
    lines = REQUIREMENTS.read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]


def required_packages():
    return {normalise(re.split(r"[\[=<>~! ]", ln, maxsplit=1)[0]) for ln in requirement_lines()}


def imported_packages():
    """Third-party top-level modules imported by backend/ outside its tests."""
    found = {}
    for path in sorted((ROOT / "backend").rglob("*.py")):
        if "tests" in path.relative_to(ROOT).parts:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            else:
                continue
            for name in names:
                top = name.split(".")[0]
                if top not in sys.stdlib_module_names and top != "backend":
                    found.setdefault(normalise(DISTRIBUTION.get(top, top)), path.name)
    return found


def test_every_imported_package_is_required():
    required = required_packages()
    missing = {pkg: f for pkg, f in imported_packages().items() if pkg not in required}
    assert not missing, f"imported but not in requirements.txt: {missing}"


def test_every_requirement_is_pinned():
    unpinned = [ln for ln in requirement_lines() if not re.fullmatch(r"[A-Za-z0-9_.\-]+(\[[a-z,]+\])?==[0-9][A-Za-z0-9.]*", ln)]
    assert not unpinned, f"not pinned with ==: {unpinned}"


def test_backend_has_one_requirements_file():
    assert not (ROOT / "backend" / "requirements.txt").exists()
