"""Write the small EPUB fixtures the original view is tested on (C17.3).

Standard library only; every byte is generated here, so no third-party book
is committed. Run from the repo root:

    python tools/make_reader_fixtures.py

Writes into frontend/e2e/fixtures/books/:

- reflow.epub: three chapters of text with every kind of image a book uses
  (<img> PNG and GIF, an <img> of an SVG file, inline <svg> with <image>
  by xlink:href and by SVG 2 href, a CSS background, a <figure> with a
  <figcaption>, a srcset, the cover), MathML, and a <pre><code> block.
- fixed.epub: a pre-paginated book of two pages, each a full-page image.
- hostile.epub: a script, an event handler, a javascript: link, a form, an
  iframe, a meta refresh, a remote image, a remote stylesheet and a remote
  CSS import.

The output is deterministic (fixed timestamps), so a re-run changes nothing.
"""

import struct
import zipfile
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "frontend" / "e2e" / "fixtures" / "books"
DATE = (2026, 11, 12, 0, 0, 0)


def png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """A solid-colour PNG; rows compress to almost nothing."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    row = b"\x00" + bytes(rgb) * width
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * height, 9)) + chunk(b"IEND", b""))


def gif(width: int, height: int) -> bytes:
    """A one-colour GIF (two-entry palette, LZW stream of clear + index 0 runs + end)."""
    header = b"GIF89a" + struct.pack("<HHBBB", width, height, 0x80, 0, 0) + b"\x2b\x6c\x4c\xff\xff\xff"
    image = b"\x2c" + struct.pack("<HHHHB", 0, 0, width, height, 0)
    return header + image + b"\x02\x02\x44\x01\x00\x3b"  # min code size 2; a 1x1 stream, stretched by the decoder


SVG_FILE = ('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">'
            '<rect width="400" height="200" fill="#5b7f95"/><circle cx="200" cy="100" r="70" fill="#f2e6c9"/></svg>')

PARA = ("The lamp on the desk threw a small circle of light, and inside it the page was "
        "the only thing that mattered. ") * 6

CSS = """body { font-family: Georgia, serif; line-height: 1.5; }
h1 { font-size: 1.6em; }
.banner { height: 120px; background: url(../images/banner.png) center / cover no-repeat; }
pre { font-family: monospace; background: #f3ede3; padding: 0.5em; }
"""


def xhtml(title: str, body: str, head: str = "") -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">'
            f'<head><meta charset="UTF-8"/><title>{title}</title>'
            f'<link rel="stylesheet" type="text/css" href="../styles/book.css"/>{head}</head>'
            f'<body>{body}</body></html>')


def opf(title: str, items: list[tuple[str, str, str, str]], spine: list[str], meta: str = "") -> str:
    manifest = "".join(f'<item id="{i}" href="{h}" media-type="{t}"{p}/>' for i, h, t, p in items)
    refs = "".join(f'<itemref idref="{i}"/>' for i in spine)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<dc:identifier id="uid">urn:readfocus:fixture:{title}</dc:identifier>'
            f'<dc:title>{title}</dc:title><dc:language>en</dc:language><dc:creator>ReadFocus fixtures</dc:creator>'
            f'<meta property="dcterms:modified">2026-11-12T00:00:00Z</meta>{meta}</metadata>'
            f'<manifest>{manifest}</manifest><spine>{refs}</spine></package>')


def nav(entries: list[tuple[str, str]]) -> str:
    links = "".join(f'<li><a href="{h}">{t}</a></li>' for h, t in entries)
    return xhtml("Contents", f'<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>{links}</ol></nav>')


def write(name: str, files: dict[str, str | bytes]) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    with zipfile.ZipFile(path, "w") as archive:
        mimetype = zipfile.ZipInfo("mimetype", DATE)  # first and stored, as EPUB requires
        archive.writestr(mimetype, "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        container = ('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                     '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                     '</rootfiles></container>')
        for file_name, data in {"META-INF/container.xml": container, **files}.items():
            archive.writestr(zipfile.ZipInfo(file_name, DATE), data, compress_type=zipfile.ZIP_DEFLATED)
    return path


def reflow() -> Path:
    images = {
        "images/cover.png": png(600, 900, (122, 74, 52)),
        "images/plate.png": png(1200, 800, (88, 120, 96)),
        "images/small.gif": gif(64, 48),
        "images/diagram.svg": SVG_FILE,
        "images/inline-x.png": png(300, 150, (200, 170, 90)),
        "images/inline-href.png": png(300, 150, (90, 140, 200)),
        "images/banner.png": png(800, 120, (160, 120, 160)),
        "images/wide.png": png(1600, 400, (60, 60, 60)),
        "images/wide-2x.png": png(3200, 800, (60, 60, 60)),
    }
    math = ('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><msub><mi>c</mi><mi>k</mi></msub>'
            '<mo>=</mo><mfrac><mn>1</mn><mi>N</mi></mfrac><munderover><mo>&#x2211;</mo><mrow><mi>n</mi><mo>=</mo><mn>0</mn>'
            '</mrow><mrow><mi>N</mi><mo>-</mo><mn>1</mn></mrow></munderover><msub><mi>x</mi><mi>n</mi></msub></mrow></math>')
    code = '<pre><code>def total(xs):\n    s = 0\n    for x in xs:\n        s += x  # keep the indent\n    return s</code></pre>'
    chapters = {
        "text/cover.xhtml": xhtml("Cover", '<section epub:type="cover"><img src="../images/cover.png" alt="Cover"/></section>'),
        "text/ch1.xhtml": xhtml("Chapter 1", f'<h1>Chapter 1</h1><p>{PARA}</p>'
                                '<figure id="plate"><img src="../images/plate.png" alt="A green plate"/>'
                                '<figcaption>Figure 1.1 A plate that must not be split from its caption.</figcaption></figure>'
                                f'<p>{PARA}</p><p><img src="../images/small.gif" alt="A small mark"/> {PARA}</p>'
                                f'<p><img src="../images/diagram.svg" alt="A diagram"/></p><p>{PARA}</p>'),
        "text/ch2.xhtml": xhtml("Chapter 2", f'<h1>Chapter 2</h1><div class="banner" role="img" aria-label="Banner"></div><p>{PARA}</p>'
                                '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="320" height="160">'
                                '<image xlink:href="../images/inline-x.png" width="300" height="150"/></svg>'
                                '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160">'
                                '<image href="../images/inline-href.png" width="300" height="150"/></svg>'
                                f'<p>{PARA}</p>{math}<p>{PARA}</p>'),
        "text/ch3.xhtml": xhtml("Chapter 3", f'<h1>Chapter 3</h1><p>{PARA}</p>{code}'
                                '<p><img src="../images/wide.png" srcset="../images/wide.png 1x, ../images/wide-2x.png 2x" alt="A wide image"/></p>'
                                f'<p>{PARA}</p>'),
        "text/nav.xhtml": nav([("cover.xhtml", "Cover"), ("ch1.xhtml", "Chapter 1"), ("ch2.xhtml", "Chapter 2"), ("ch3.xhtml", "Chapter 3")]),
    }
    media = {"png": "image/png", "gif": "image/gif", "svg": "image/svg+xml"}
    items = [("nav", "text/nav.xhtml", "application/xhtml+xml", ' properties="nav"'),
             ("css", "styles/book.css", "text/css", "")]
    items += [(Path(h).stem, h, media[h.rsplit(".", 1)[1]], ' properties="cover-image"' if "cover" in h else "") for h in images]
    items += [(Path(h).stem, h, "application/xhtml+xml", ' properties="svg mathml"' if "ch2" in h else "")
              for h in chapters if "nav" not in h]
    content = opf("Reflow fixture", items, ["cover", "ch1", "ch2", "ch3"])
    files = {"OEBPS/content.opf": content, "OEBPS/styles/book.css": CSS}
    files.update({f"OEBPS/{h}": d for h, d in {**images, **chapters}.items()})
    return write("reflow.epub", files)


def fixed() -> Path:
    page = ('<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{t}</title>'
            '<meta name="viewport" content="width=600, height=800"/></head>'
            '<body style="margin:0"><img src="../images/{i}" width="600" height="800" alt="{t}"/></body></html>')
    images = {"images/p1.png": png(600, 800, (180, 90, 60)), "images/p2.png": png(600, 800, (60, 90, 180))}
    pages = {"text/p1.xhtml": page.format(t="Page one", i="p1.png"), "text/p2.xhtml": page.format(t="Page two", i="p2.png")}
    items = [("nav", "text/nav.xhtml", "application/xhtml+xml", ' properties="nav"')]
    items += [(Path(h).stem, h, "image/png", "") for h in images]
    items += [(Path(h).stem, h, "application/xhtml+xml", "") for h in pages]
    meta = ('<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">auto</meta>')
    content = opf("Fixed fixture", items, ["p1", "p2"], meta).replace(
        '<package ', '<package prefix="rendition: http://www.idpf.org/vocab/rendition/#" ')
    files = {"OEBPS/content.opf": content, "OEBPS/text/nav.xhtml": nav([("p1.xhtml", "Page one"), ("p2.xhtml", "Page two")]),
             "OEBPS/styles/book.css": ""}
    files.update({f"OEBPS/{h}": d for h, d in {**images, **pages}.items()})
    return write("fixed.epub", files)


def hostile() -> Path:
    head = ('<script>window.__hostile = "ran";</script>'
            '<meta http-equiv="refresh" content="0; url=https://example.invalid/away"/>'
            '<link rel="stylesheet" href="https://example.invalid/remote.css"/>'
            '<style>@import url("https://example.invalid/import.css"); p { background: url(https://example.invalid/bg.png); }</style>')
    body = ('<h1 onclick="window.__hostile = \'clicked\'">Hostile</h1>'
            '<img src="../images/ok.png" alt="A local image" onload="window.__hostile = \'onload\'"/>'
            '<img src="https://example.invalid/tracker.png" alt="A remote image"/>'
            '<p><a href="javascript:window.__hostile=\'link\'">a javascript link</a></p>'
            '<form action="https://example.invalid/steal"><input name="q"/></form>'
            '<iframe src="https://example.invalid/frame"></iframe>'
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>window.__hostile = "svg"</script></svg>'
            f'<p style="background-image: url(https://example.invalid/inline.png)">{PARA}</p>')
    items = [("nav", "text/nav.xhtml", "application/xhtml+xml", ' properties="nav"'),
             ("css", "styles/book.css", "text/css", ""), ("ok", "images/ok.png", "image/png", ""),
             ("ch1", "text/ch1.xhtml", "application/xhtml+xml", ' properties="scripted remote-resources svg"')]
    files = {"OEBPS/content.opf": opf("Hostile fixture", items, ["ch1"]),
             "OEBPS/styles/book.css": CSS + '@import "https://example.invalid/css-import.css";\n',
             "OEBPS/images/ok.png": png(200, 100, (120, 160, 120)),
             "OEBPS/text/ch1.xhtml": xhtml("Hostile", body, head),
             "OEBPS/text/nav.xhtml": nav([("ch1.xhtml", "Hostile")])}
    return write("hostile.epub", files)


if __name__ == "__main__":
    for made in (reflow(), fixed(), hostile()):
        print(f"{made.relative_to(OUT.parents[3])}: {made.stat().st_size} bytes")
