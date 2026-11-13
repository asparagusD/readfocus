"""The shared EPUB 3 builder (C19.1): package structure, images, nav, and that ingestion reads it."""

import io
import struct
import zipfile
import zlib
from xml.dom import minidom

import pytest

from backend.convert.epub_builder import Chapter, Image, build_epub, check_epub
from backend.regions import epub as epub_regions
from backend.services import book_ingestor

MODIFIED = "2026-11-13T00:00:00Z"
MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>x</mi><mo>=</mo><mn>2</mn></math>'
CODE = "def f(x):\n    return  x\t+ 1\n"


def png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = (b"\x00" + b"\x80\x80\x80" * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40"/></svg>'
CHAPTERS = [
    Chapter("One", "<h1>One &amp; only</h1><p>Text.</p><h2>A part</h2>"
            '<figure><img src="images/plot.png" alt="A plot"/><figcaption>Figure 1. A plot</figcaption></figure>'
            f"<pre><code class=\"language-python\">{CODE}</code></pre>"),
    Chapter("Two", f'<h1 id="two">Two</h1><p>Math:</p>{MATHML}<p><img src="images/shape.svg"/></p>'),
    Chapter("Untitled section", "<p>No heading here.</p>"),
]
IMAGES = [Image("plot.png", png(64, 32), "image/png"), Image("shape.svg", SVG, "image/svg+xml")]


def build(**kwargs) -> bytes:
    args = {"title": "Q&A <notes>", "author": "Ada", "chapters": CHAPTERS, "images": IMAGES, "modified": MODIFIED}
    return build_epub(**{**args, **kwargs})


def files(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {info.filename: archive.read(info) for info in archive.infolist()}


def opf(data: bytes) -> minidom.Document:
    return minidom.parseString(files(data)["OEBPS/content.opf"])


def manifest(data: bytes) -> dict[str, dict[str, str]]:
    return {item.getAttribute("href"): {"id": item.getAttribute("id"), "type": item.getAttribute("media-type"),
                                        "properties": item.getAttribute("properties")}
            for item in opf(data).getElementsByTagName("item")}


def chapter_doc(data: bytes, number: int) -> minidom.Document:
    return minidom.parseString(files(data)[f"OEBPS/chapter-{number:03d}.xhtml"])


def test_mimetype_is_first_and_stored_and_the_package_is_sound():
    data = build()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        first = archive.infolist()[0]
        assert first.filename == "mimetype" and first.compress_type == zipfile.ZIP_STORED and not first.extra
        assert archive.read(first) == b"application/epub+zip"
    assert data[30:38] == b"mimetype"  # the name right after the first local header, as readers sniff it
    container = minidom.parseString(files(data)["META-INF/container.xml"])
    assert container.getElementsByTagName("rootfile")[0].getAttribute("full-path") == "OEBPS/content.opf"
    assert check_epub(data) == []


def test_every_xhtml_file_is_well_formed_xml():
    for name, body in files(build()).items():
        if name.endswith((".xhtml", ".opf", ".xml")):
            minidom.parseString(body)  # raises on any error


def test_package_metadata_is_epub3_and_escaped():
    package = opf(build()).documentElement
    assert package.getAttribute("version") == "3.0"
    text = {tag: package.getElementsByTagName(tag)[0].firstChild.data for tag in ("dc:title", "dc:creator", "dc:language")}
    assert text == {"dc:title": "Q&A <notes>", "dc:creator": "Ada", "dc:language": "en"}
    identifier = package.getElementsByTagName("dc:identifier")[0]
    assert identifier.getAttribute("id") == package.getAttribute("unique-identifier")
    assert identifier.firstChild.data.startswith("urn:uuid:")
    modified = [m for m in package.getElementsByTagName("meta") if m.getAttribute("property") == "dcterms:modified"]
    assert modified[0].firstChild.data == MODIFIED


def test_spine_lists_the_chapters_in_order_and_flags_math_and_svg():
    data = build()
    items = manifest(data)
    ids = {v["id"]: href for href, v in items.items()}
    spine = [ids[ref.getAttribute("idref")] for ref in opf(data).getElementsByTagName("itemref")]
    assert spine == ["chapter-001.xhtml", "chapter-002.xhtml", "chapter-003.xhtml"]
    assert items["nav.xhtml"]["properties"] == "nav"
    assert items["chapter-002.xhtml"]["properties"] == "mathml"
    assert items["chapter-001.xhtml"]["properties"] == ""
    assert items["style.css"]["type"] == "text/css"


def test_images_are_in_the_manifest_and_every_img_points_at_one():
    data = build()
    items, archive = manifest(data), files(data)
    assert items["images/plot.png"]["type"] == "image/png"
    assert items["images/shape.svg"]["type"] == "image/svg+xml"
    assert archive["OEBPS/images/plot.png"] == IMAGES[0].data
    for number in (1, 2):
        for img in chapter_doc(data, number).getElementsByTagName("img"):
            assert img.getAttribute("src") in items


def test_every_img_gets_width_height_and_alt():
    data = build()
    plot = chapter_doc(data, 1).getElementsByTagName("img")[0]
    shape = chapter_doc(data, 2).getElementsByTagName("img")[0]
    assert (plot.getAttribute("width"), plot.getAttribute("height"), plot.getAttribute("alt")) == ("64", "32", "A plot")
    assert (shape.getAttribute("width"), shape.getAttribute("height"), shape.getAttribute("alt")) == ("120", "40", "Figure 2")


def test_an_img_with_no_packaged_image_is_refused():
    with pytest.raises(ValueError, match="missing.png"):
        build(chapters=[Chapter("One", '<p><img src="images/missing.png"/></p>')])


def test_a_body_that_is_not_well_formed_is_refused():
    with pytest.raises(ValueError, match="chapter 1"):
        build(chapters=[Chapter("One", "<p>open")])


def test_nav_matches_the_headings():
    data = build()
    nav = minidom.parseString(files(data)["OEBPS/nav.xhtml"])
    toc = next(n for n in nav.getElementsByTagName("nav") if n.getAttribute("epub:type") == "toc")
    top = [li for li in toc.getElementsByTagName("ol")[0].childNodes if li.nodeType == li.ELEMENT_NODE]
    labels = [li.getElementsByTagName("a")[0].firstChild.data for li in top]
    assert labels == ["One & only", "Two", "Untitled section"]
    nested = top[0].getElementsByTagName("ol")[0].getElementsByTagName("a")
    assert [a.firstChild.data for a in nested] == ["A part"]
    for a in toc.getElementsByTagName("a"):  # every link lands on an element that exists
        href = a.getAttribute("href")
        page, _, fragment = href.partition("#")
        assert f"OEBPS/{page}" in files(data)
        if fragment:
            number = int(page[8:11])
            assert any(e.getAttribute("id") == fragment for e in chapter_doc(data, number).getElementsByTagName("*"))
    assert nav.getElementsByTagName("a")[1].getAttribute("href") == "chapter-001.xhtml#" + \
        chapter_doc(data, 1).getElementsByTagName("h2")[0].getAttribute("id")


def test_code_whitespace_and_mathml_namespace_survive():
    data = build()
    code = chapter_doc(data, 1).getElementsByTagName("code")[0]
    assert code.firstChild.data == CODE
    math = chapter_doc(data, 2).getElementsByTagNameNS("http://www.w3.org/1998/Math/MathML", "math")
    assert len(math) == 1


def test_the_same_input_gives_the_same_bytes():
    assert build() == build()
    assert build() != build(title="Another")


def test_ingestion_and_the_region_map_read_the_built_book():
    data = build()
    assert book_ingestor.extract_metadata("epub", data) == ("Q&A <notes>", "Ada")
    text = "\n".join(book_ingestor.extract("epub", data))
    assert "No heading here." in text and "return  x" in text
    kinds = [r["kind"] for r in epub_regions.epub_regions(data)]
    assert {"math", "code", "figure"} <= set(kinds)


def test_check_epub_names_what_is_wrong():
    broken = io.BytesIO()
    with zipfile.ZipFile(broken, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("META-INF/container.xml", "<container/>")
        archive.writestr("mimetype", "application/epub+zip")
    problems = check_epub(broken.getvalue())
    assert any("mimetype" in p for p in problems)
