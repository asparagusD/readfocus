"""requirements.txt lists every package backend/ imports, each pinned."""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUIREMENTS = ROOT / "requirements.txt"

# Import name -> distribution name, where they differ.
DISTRIBUTION = {"bs4": "beautifulsoup4", "dotenv": "python-dotenv", "markdown_it": "markdown-it-py",
                "google.genai": "google-genai"}  # a namespace package: the dotted name says which (C20.2)


def normalise(name):
    return re.sub(r"[-_.]+", "-", name).lower()


DEV_REQUIREMENTS = ROOT / "requirements-dev.txt"
PROJECT_PACKAGES = {"backend", "scripts", "tools"}


def requirement_lines(path=REQUIREMENTS):
    """Requirement lines of a file, without comments and `-r` includes."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.lstrip().startswith(("#", "-r"))]


def required_packages(path=REQUIREMENTS):
    return {normalise(re.split(r"[\[=<>~! ]", ln, maxsplit=1)[0]) for ln in requirement_lines(path)}


def imported_packages():
    """Third-party top-level modules imported by backend/ outside its tests."""
    paths = [p for p in (ROOT / "backend").rglob("*.py") if "tests" not in p.relative_to(ROOT).parts]
    return third_party_imports(paths)


def third_party_imports(paths):
    """{distribution: a file that imports it} for the given Python files."""
    found = {}
    for path in sorted(paths):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                dotted = [f"{node.module}.{a.name}" for a in node.names if f"{node.module}.{a.name}" in DISTRIBUTION]
                names = dotted or [node.module]  # from google import genai -> google.genai
            else:
                continue
            for name in names:
                top = name.split(".")[0]
                namespaced = next((DISTRIBUTION[k] for k in DISTRIBUTION if "." in k and (name + ".").startswith(k + ".")),
                                  None)
                if top not in sys.stdlib_module_names and top not in PROJECT_PACKAGES:
                    found.setdefault(normalise(namespaced or DISTRIBUTION.get(top, top)), path.name)
    return found


def test_every_imported_package_is_required():
    required = required_packages()
    missing = {pkg: f for pkg, f in imported_packages().items() if pkg not in required}
    assert not missing, f"imported but not in requirements.txt: {missing}"


def test_every_requirement_is_pinned():
    unpinned = [ln for ln in requirement_lines() if not re.fullmatch(r"[A-Za-z0-9_.\-]+(\[[a-z,]+\])?==[0-9][A-Za-z0-9.]*", ln)]
    assert not unpinned, f"not pinned with ==: {unpinned}"


def test_tests_and_scripts_dependencies_are_declared():
    """A clean CI install (requirements-dev.txt) can import every test and script (DEBUG_LOG C14.5)."""
    paths = [*(ROOT / "backend" / "tests").rglob("*.py"), *(ROOT / "scripts").glob("*.py")]
    declared = required_packages() | required_packages(DEV_REQUIREMENTS)
    missing = {pkg: f for pkg, f in third_party_imports(paths).items() if pkg not in declared}
    assert not missing, f"imported by tests or scripts but in no requirements file: {missing}"


def test_dev_requirements_include_the_app_and_are_pinned():
    lines = DEV_REQUIREMENTS.read_text(encoding="utf-8").splitlines()
    assert "-r requirements.txt" in lines
    unpinned = [ln for ln in requirement_lines(DEV_REQUIREMENTS) if "==" not in ln]
    assert not unpinned, f"not pinned with ==: {unpinned}"


def test_backend_has_one_requirements_file():
    assert not (ROOT / "backend" / "requirements.txt").exists()
