"""Write converted.epub, the e2e fixture made by the shared EPUB 3 builder (C19.1).

Run from the repo root:

    python tools/make_converted_fixture.py

Two chapters as a converter would hand them over: headings at two levels,
a PNG plot with alt text and an SVG without (the builder adds "Figure 2"),
display MathML, and an indented code block. Deterministic, so a re-run
changes nothing.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.convert.epub_builder import Chapter, Image, build_epub
from tools.make_reader_fixtures import png

OUT = ROOT / "frontend" / "e2e" / "fixtures" / "books" / "converted.epub"
PARA = "The lamp on the desk threw a small circle of light, and inside it the page was the only thing that mattered. " * 4
SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80">'
       b'<rect width="240" height="80" fill="#c8b48a"/><circle cx="40" cy="40" r="24" fill="#5a3e2b"/></svg>')
MATH = ('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>E</mi><mo>=</mo>'
        '<mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow>'
        '<annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math>')
CODE = "def area(r):\n    \"\"\"A circle's area.\"\"\"\n    return 3.14159 * r ** 2\n"


def build() -> bytes:
    chapters = [
        Chapter("Getting started", f"<h1>Getting started</h1><p>{PARA}</p><h2>A plot</h2>"
                '<figure><img src="images/plot.png" alt="A plot of the lamp\'s light"/>'
                f"<figcaption>Figure 1. Light against distance.</figcaption></figure><p>{PARA}</p>"),
        Chapter("Equations and code", f"<h1>Equations and code</h1><p>{PARA}</p>{MATH}<p>{PARA}</p>"
                f'<pre><code class="language-python">{CODE}</code></pre><p><img src="images/mark.svg"/></p>'),
    ]
    images = [Image("plot.png", png(320, 160, (90, 120, 160)), "image/png"), Image("mark.svg", SVG, "image/svg+xml")]
    return build_epub("Converted fixture", "ReadFocus", chapters, images, modified="2026-11-13T00:00:00Z")


def converted(name: str, data: bytes) -> bytes:
    """A source run through the upload's converter (C19.2) and packed, as the server stores it (Gate G6)."""
    from backend.convert.sources import convert_upload

    _, book = convert_upload(name, data)
    return build_epub(book.title, "ReadFocus", book.chapters, book.images, modified="2026-11-13T00:00:00Z")


def markdown_zip() -> bytes:
    """backend/tests/fixtures/sources/sample.md zipped with the two figures it names (one remote image stays out)."""
    import io
    import zipfile

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, data in (("notes/sample.md", (SOURCES / "sample.md").read_bytes()),
                           ("notes/figures/spectrum.png", png(240, 120, (60, 110, 150))),
                           ("notes/figures/filter.svg", SVG)):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 13, 0, 0, 0))
            archive.writestr(info, data)
    return out.getvalue()


SOURCES = ROOT / "backend" / "tests" / "fixtures" / "sources"
GATE = {
    "converted-md.epub": lambda: converted("notes.zip", markdown_zip()),
    "converted-nb.epub": lambda: converted("lab.ipynb", (SOURCES / "sample.ipynb").read_bytes()),
}


if __name__ == "__main__":
    OUT.write_bytes(build())
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size} bytes")
    for name, make in GATE.items():
        target = OUT.parent / name
        target.write_bytes(make())
        print(f"{target.relative_to(ROOT)}: {target.stat().st_size} bytes")
