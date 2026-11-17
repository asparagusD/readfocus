"""Write backend/tests/fixtures/regions_sample.epub, the C18.5b EPUB fixture.

A small EPUB 3 of our own with every region kind: headings and prose with
inline code and inline MathML, display MathML with a LaTeX annotation, a
<pre><code class="language-python"> block and a class-less <pre> of Scheme,
a <figure> with <img> and <figcaption>, a bare <img> with alt text, a bare
<img> without alt followed by a "Figure 2.2" paragraph, an inline <svg>
drawing an image, and a <table> with <caption>. Every image in the package
is used by a spine document.

Run from the repo root with the virtualenv active:

    python scripts/dev/make_epub_fixture.py
"""

import base64
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "backend" / "tests" / "fixtures" / "regions_sample.epub"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==")
SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
PYTHON = "def double(x):\n    \"\"\"Twice x.\"\"\"\n    return x * 2"
SCHEME = "(define (square x)\n  (* x x))"

HEAD = ('<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{title}</title></head><body>{body}</body></html>')

CHAPTER_1 = f"""<section><h1>Chapter 1 Doubling</h1>
<p>The function <code>double</code> returns twice its input, so
<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><mn>2</mn><mi>x</mi></math>
for every <em>real</em> number.</p>
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">x^2 + 1</annotation></semantics></math>
<pre><code class="language-python">{PYTHON}</code></pre>
<pre>{SCHEME}</pre>
<figure id="fig-1-1"><img src="images/plot.png" alt="A rising line"/><figcaption>Figure 1.1 A plot of double.</figcaption></figure>
<table><caption>Table 1.1 Values of double</caption><tr><th>x</th><th>double(x)</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>6</td></tr></table>
<p>That is all for the first chapter.</p></section>"""

CHAPTER_2 = """<section><h1>Chapter 2 Pictures</h1>
<p>A photograph comes first.</p>
<img src="images/photo.png" alt="A lamp on a desk"/>
<p>Then a picture with no alternative text.</p>
<img src="images/night.png"/>
<p>Figure 2.2 The same lamp at night.</p>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="20"><image xlink:href="images/diagram.svg" width="20" height="20"/></svg>
<p>The end.</p></section>"""

OPF = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">readfocus-regions-sample</dc:identifier>
<dc:title>Regions sample</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-11-13T00:00:00Z</meta></metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml" properties="mathml"/>
<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml" properties="svg"/>
<item id="plot" href="images/plot.png" media-type="image/png"/>
<item id="photo" href="images/photo.png" media-type="image/png"/>
<item id="night" href="images/night.png" media-type="image/png"/>
<item id="diagram" href="images/diagram.svg" media-type="image/svg+xml"/>
</manifest>
<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>"""

NAV = ('<nav epub:type="toc"><ol><li><a href="ch1.xhtml">Chapter 1</a></li>'
       '<li><a href="ch2.xhtml">Chapter 2</a></li></ol></nav>')
CONTAINER = ('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
             '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
             '</rootfiles></container>')


def build() -> None:
    with zipfile.ZipFile(OUT, "w") as epub:
        epub.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip")  # first and stored, as EPUB asks
        files = {
            "META-INF/container.xml": CONTAINER, "OEBPS/content.opf": OPF,
            "OEBPS/nav.xhtml": HEAD.format(title="Contents", body=NAV),
            "OEBPS/ch1.xhtml": HEAD.format(title="Chapter 1", body=CHAPTER_1),
            "OEBPS/ch2.xhtml": HEAD.format(title="Chapter 2", body=CHAPTER_2),
            "OEBPS/images/diagram.svg": SVG,
        }
        for name, text in files.items():
            epub.writestr(name, text, compress_type=zipfile.ZIP_DEFLATED)
        for name in ("plot", "photo", "night"):
            epub.writestr(f"OEBPS/images/{name}.png", PNG)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
