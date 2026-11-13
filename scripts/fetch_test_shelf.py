"""Download the technical test shelf for the region map (C18) into samples/technical/.

Each book's licence is checked on its source page first: the page must
still carry the licence's wording, or the book is skipped and the run
fails, so a changed licence is never downloaded unnoticed. Files land in
samples/technical/ (git-ignored); samples/technical/SHELF.md (committed)
records title, source, licence and sha256. A file already present is
hashed, not downloaded again (--force re-downloads).

Run from the repo root with the virtualenv active:

    python scripts/fetch_test_shelf.py --dry-run   # licence checks only
    python scripts/fetch_test_shelf.py [--force]

Touches no database. About 87 MB in all.
"""

import argparse
import hashlib
import re
from datetime import date
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SHELF_DIR = ROOT / "samples" / "technical"
USER_AGENT = "ReadFocus/2.0 test-shelf fetcher"
TIMEOUT = httpx.Timeout(30.0, read=120.0)
MAGIC = {"pdf": b"%PDF-", "epub": b"PK\x03\x04"}

SHELF = [
    {"file": "calculus-volume-1.pdf", "title": "Calculus Volume 1", "author": "Gilbert Strang, Edwin Herman (OpenStax)",
     "role": "heavy math (TeX-like fonts, display equations, figures)",
     "url": "https://assets.openstax.org/oscms-prodcms/media/documents/calculus-volume-1_-_WEB.pdf",
     "licence": "CC BY-NC-SA 4.0",
     "licence_page": "https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&slug=calculus-volume-1"
                     "&fields=license_name",
     "marker": r"Attribution-NonCommercial-ShareAlike"},
    {"file": "sicp.pdf", "title": "Structure and Interpretation of Computer Programs (2nd ed., unofficial texinfo PDF)",
     "author": "Harold Abelson, Gerald Jay Sussman, Julie Sussman; PDF by Andres Raba", "role": "code (Scheme listings)",
     "url": "https://github.com/sarabander/sicp-pdf/raw/master/sicp.pdf",
     "licence": "CC BY-SA 4.0",
     "licence_page": "https://raw.githubusercontent.com/sarabander/sicp-pdf/master/README.md",
     "marker": r"Attribution-ShareAlike 4\.0 International"},
    {"file": "lessons-in-electric-circuits-dc.pdf", "title": "Lessons in Electric Circuits, Volume I: DC",
     "author": "Tony R. Kuphaldt", "role": "circuits (schematics, figures, tables, SPICE listings)",
     "url": "https://www.ibiblio.org/kuphaldt/electricCircuits/DC/DC.pdf",
     "licence": "CC BY 4.0 (the page says CC BY; the version is in the book's Appendix 3)",
     "licence_page": "https://www.ibiblio.org/kuphaldt/electricCircuits/DC/index.html",
     "marker": r"CC BY license"},
    {"file": "interactive-linear-algebra.pdf", "title": "Interactive Linear Algebra",
     "author": "Dan Margalit, Joseph Rabinoff", "role": "matrices (bracketed arrays, vectors)",
     "url": "https://textbooks.math.gatech.edu/ila/ila.pdf",
     "licence": "GNU FDL 1.2 or later (no invariant sections)",
     "licence_page": "https://textbooks.math.gatech.edu/ila/colophon-1.html",
     "marker": r"GNU Free Documentation License, Version 1\.2"},
    {"file": "alices-adventures-in-wonderland.epub", "title": "Alice's Adventures in Wonderland (illustrated)",
     "author": "Lewis Carroll, illustrated by John Tenniel (Standard Ebooks)", "role": "illustrated EPUB (figures, captions)",
     "url": "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/"
            "lewis-carroll_alices-adventures-in-wonderland_john-tenniel.epub?source=download",
     "licence": "Public domain in the US; Standard Ebooks' edition dedicated under CC0 1.0",
     "licence_page": "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel",
     "marker": r"CC0 1\.0 Universal"},
]


def licence_holds(client: httpx.Client, book: dict) -> bool:
    page = client.get(book["licence_page"])
    return page.status_code == 200 and re.search(book["marker"], page.text) is not None


def download(client: httpx.Client, book: dict, target: Path) -> None:
    part = target.with_suffix(target.suffix + ".part")
    with client.stream("GET", book["url"]) as response:
        response.raise_for_status()
        with part.open("wb") as out:
            for block in response.iter_bytes(1 << 20):
                out.write(block)
    part.replace(target)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def shelf_markdown(rows: list[dict], checked: str) -> str:
    lines = [
        "# Technical test shelf (C18)", "",
        "Openly licensed books for the region map's tests and Gate G5. The files are",
        "git-ignored; `python scripts/fetch_test_shelf.py` downloads them here after",
        f"checking each licence on its source page (last checked {checked}).", "",
        "| File | Title | Author | Tests | Licence | Source | Licence checked at | Bytes | sha256 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(f"| `{r['file']}` | {r['title']} | {r['author']} | {r['role']} | {r['licence']} | "
                     f"{r['url']} | {r['licence_page']} | {r['bytes']} | `{r['sha256']}` |")
    lines += ["", "No openly licensed EPUB with MathML was found at C18.1; C19 builds one.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="check the licences only")
    parser.add_argument("--force", action="store_true", help="download files that are already present")
    args = parser.parse_args()
    SHELF_DIR.mkdir(parents=True, exist_ok=True)
    rows, failed = [], []
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True) as client:
        for book in SHELF:
            if not licence_holds(client, book):
                print(f"LICENCE CHANGED OR PAGE GONE, skipped: {book['title']} ({book['licence_page']})")
                failed.append(book["file"])
                continue
            print(f"licence ok: {book['title']} ({book['licence']})")
            if args.dry_run:
                continue
            target = SHELF_DIR / book["file"]
            if args.force or not target.exists():
                download(client, book, target)
            if not target.read_bytes()[:5].startswith(MAGIC[target.suffix[1:]]):
                print(f"NOT A {target.suffix[1:].upper()}: {target}")
                failed.append(book["file"])
                continue
            rows.append({**book, "bytes": target.stat().st_size, "sha256": sha256(target)})
            print(f"  {target.name}: {rows[-1]['bytes']} bytes, sha256 {rows[-1]['sha256']}")
    if rows and not failed:
        (SHELF_DIR / "SHELF.md").write_text(shelf_markdown(rows, date.today().isoformat()), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
