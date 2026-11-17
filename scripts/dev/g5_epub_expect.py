"""Gate G5 (C18.G): what each test EPUB's spine documents contain, for the renderer check.

Per EPUB: every spine document's packaged images (img, svg image; remote
ones, which the reader blocks, counted apart), figure captions
(figcaption) and MathML (math), counted from the markup with BeautifulSoup,
and the package's image items. frontend/e2e/gate-g5.spec.js pages
through each book in the original view and compares what it sees with this.

    python scripts/dev/g5_epub_expect.py <out.json>
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
BOOKS = {
    "alice": ROOT / "samples" / "technical" / "alices-adventures-in-wonderland.epub",
    "regions": ROOT / "backend" / "tests" / "fixtures" / "regions_sample.epub",
    "reflow": ROOT / "frontend" / "e2e" / "fixtures" / "books" / "reflow.epub",
    "fixed": ROOT / "frontend" / "e2e" / "fixtures" / "books" / "fixed.epub",
    "hostile": ROOT / "frontend" / "e2e" / "fixtures" / "books" / "hostile.epub",
}


def name(tag) -> str:
    return tag.name.lower().split(":")[-1]


def expect(path: Path) -> dict:
    import ebooklib
    from bs4 import BeautifulSoup

    from backend.regions import epub
    from backend.services.book_structure import _read_epub

    data = path.read_bytes()
    book = _read_epub(data)
    items = {item.get_id(): item for item in book.get_items()}
    sections = []
    for idref, _linear in book.spine:
        item = items.get(idref)
        if item is None or item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue
        body = BeautifulSoup(item.get_content(), "html.parser").find(lambda t: name(t) == "body")
        tags = body.find_all(True) if body else []
        pictures = [t for t in tags if name(t) == "img" or (name(t) == "image" and t.find_parent(lambda p: name(p) == "svg"))]
        remote = [t for t in pictures if (t.get("src") or t.get("xlink:href") or t.get("href") or "").startswith(
            ("http:", "https:"))]
        sections.append({
            "file": item.get_name(),
            "images": len(pictures) - len(remote),  # packaged images: each must be drawn
            "remote": len(remote),                   # remote ones the reader blocks on purpose (C17)
            "captions": [" ".join(t.get_text(" ").split()) for t in tags if name(t) == "figcaption"],
            "math": sum(1 for t in tags if name(t) == "math"),
        })
    return {"file": str(path), "sections": sections, "package_images": len(epub.package_images(data)),
            "spine_images": len(set(epub.spine_images(data)))}


def main() -> int:
    out = {key: expect(path) for key, path in BOOKS.items() if path.exists()}
    Path(sys.argv[1]).write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    for key, book in out.items():
        print(key, {"sections": len(book["sections"]), "images": sum(s["images"] for s in book["sections"]),
                    "remote": sum(s["remote"] for s in book["sections"]),
                    "captions": sum(len(s["captions"]) for s in book["sections"]),
                    "math": sum(s["math"] for s in book["sections"]), "package_images": book["package_images"],
                    "spine_images": book["spine_images"]})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
