"""Build a standards-compliant EPUB 3 package from converted chapters (C19.1).

Every converter (Markdown, Jupyter, LaTeX) hands over chapters as XHTML body
fragments plus the images they use; this module packages them so the book
opens in the EPUB renderer and goes through ingestion like any EPUB.
Standard library only. The output is deterministic: the same input gives the
same bytes (the identifier is a hash of the content, zip dates come from
`modified`).

Layout: `mimetype` (first, stored), `META-INF/container.xml`, and in
`OEBPS/`: `content.opf`, `nav.xhtml`, `style.css`, `chapter-NNN.xhtml`,
`images/<name>`. A chapter refers to an image as `images/<name>`.
"""

import hashlib
import io
import re
import uuid
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from xml.dom import minidom
from xml.parsers.expat import ExpatError
from xml.sax.saxutils import escape, quoteattr

from backend.convert.image_size import image_size

XHTML_NS = "http://www.w3.org/1999/xhtml"
EPUB_NS = "http://www.idpf.org/2007/ops"
MATHML_NS = "http://www.w3.org/1998/Math/MathML"
SVG_NS = "http://www.w3.org/2000/svg"
MEDIA_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
HEADINGS = {"h1": 1, "h2": 2, "h3": 3}
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
MODIFIED = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")

STYLE = """body { font-family: "Lora", Georgia, serif; line-height: 1.6; }
h1, h2, h3 { font-family: "Playfair Display", Georgia, serif; line-height: 1.25; break-after: avoid; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
pre { white-space: pre; overflow-x: auto; tab-size: 4; font-size: 0.875em; line-height: 1.45; padding: 0.75em 1em; }
figure { margin: 1.5em auto; text-align: center; break-inside: avoid; page-break-inside: avoid; }
img, svg { max-width: 100%; height: auto; }
figcaption { font-size: 0.875em; font-style: italic; margin-top: 0.5em; }
math[display="block"] { display: block; margin: 1em auto; text-align: center; }
table { border-collapse: collapse; margin: 1em auto; }
th, td { border: 1px solid currentColor; padding: 0.25em 0.5em; }
"""


@dataclass(frozen=True)
class Chapter:
    title: str
    body: str  # an XHTML fragment: the contents of <body>, well-formed XML


@dataclass(frozen=True)
class Image:
    name: str  # file name under images/
    data: bytes
    media_type: str


def _xhtml(title: str, body: str, language: str) -> str:
    return ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
            f'<html xmlns="{XHTML_NS}" xmlns:epub="{EPUB_NS}" lang="{language}" xml:lang="{language}">'
            f'<head><meta charset="utf-8"/><title>{escape(title)}</title>'
            '<link rel="stylesheet" type="text/css" href="style.css"/></head>'
            f"<body>{body}</body></html>\n")


def _text(node) -> str:
    parts = [n.data if n.nodeType == n.TEXT_NODE else _text(n) for n in node.childNodes
             if n.nodeType in (n.TEXT_NODE, n.ELEMENT_NODE)]
    return " ".join("".join(parts).split())


def _chapter(number: int, chapter: Chapter, images: dict[str, Image], figures: list[int]) -> tuple[str, list, set]:
    """The chapter's XHTML body, its nav entries (level, label, href) and its manifest properties."""
    if "<!DOCTYPE" in chapter.body.upper():
        raise ValueError(f"chapter {number} may not hold a DOCTYPE")
    try:
        doc = minidom.parseString(f'<body xmlns="{XHTML_NS}" xmlns:epub="{EPUB_NS}">{chapter.body}</body>'.encode())
    except ExpatError as e:
        raise ValueError(f"chapter {number} is not well-formed XHTML: {e}") from e
    href = f"chapter-{number:03d}.xhtml"
    elements = [e for e in doc.getElementsByTagName("*") if e.namespaceURI == XHTML_NS]
    taken = {e.getAttribute("id") for e in doc.getElementsByTagName("*") if e.getAttribute("id")}
    entries = []
    for element in elements:
        if element.localName in HEADINGS:
            if not element.getAttribute("id"):
                n = len(taken)
                while f"h{number}-{n}" in taken:
                    n += 1
                element.setAttribute("id", f"h{number}-{n}")
                taken.add(f"h{number}-{n}")
            label = _text(element) or chapter.title
            entries.append((HEADINGS[element.localName], label, f"{href}#{element.getAttribute('id')}"))
        elif element.localName == "img":
            src = element.getAttribute("src")
            image = images.get(src.removeprefix("images/")) if src.startswith("images/") else None
            if image is None:
                raise ValueError(f"chapter {number}: no packaged image for <img src={src!r}>")
            figures[0] += 1
            if not element.getAttribute("alt").strip():
                element.setAttribute("alt", f"Figure {figures[0]}")
            size = image_size(image.data, image.media_type)
            if size and not (element.getAttribute("width") and element.getAttribute("height")):
                element.setAttribute("width", str(size[0]))
                element.setAttribute("height", str(size[1]))
    if not entries:
        entries.append((1, chapter.title, href))
    properties = set()
    if doc.getElementsByTagNameNS(MATHML_NS, "math"):
        properties.add("mathml")
    if doc.getElementsByTagNameNS(SVG_NS, "svg"):
        properties.add("svg")
    body = "".join(child.toxml() for child in doc.documentElement.childNodes)
    return body, entries, properties


def _nav_list(entries: list) -> str:
    """Nested <ol> from (level, label, href), each heading under the nearest one above it."""
    root: list = []
    stack = [(0, root)]
    for level, label, href in entries:
        while stack[-1][0] >= level:
            stack.pop()
        node = {"label": label, "href": href, "children": []}
        stack[-1][1].append(node)
        stack.append((level, node["children"]))

    def render(nodes: list) -> str:
        return "<ol>" + "".join(
            f'<li><a href={quoteattr(n["href"])}>{escape(n["label"])}</a>'
            f'{render(n["children"]) if n["children"] else ""}</li>' for n in nodes) + "</ol>"
    return render(root)


def build_epub(title: str, author: str, chapters: list[Chapter], images: list[Image] = (),
               language: str = "en", modified: str | None = None) -> bytes:
    """An EPUB 3 file. Raises ValueError for a bad body, image name or type, or an <img> with no image."""
    if not title.strip() or not chapters:
        raise ValueError("a book needs a title and at least one chapter")
    modified = modified or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not MODIFIED.fullmatch(modified):
        raise ValueError("modified must look like 2026-11-13T00:00:00Z")
    by_name: dict[str, Image] = {}
    for image in images:
        if not SAFE_NAME.fullmatch(image.name) or image.name in by_name or image.media_type not in MEDIA_TYPES:
            raise ValueError(f"image {image.name!r}: bad or repeated name, or type {image.media_type!r}")
        by_name[image.name] = image
    figures, nav_entries, files, items = [0], [], {}, []
    for number, chapter in enumerate(chapters, 1):
        body, entries, properties = _chapter(number, chapter, by_name, figures)
        href = f"chapter-{number:03d}.xhtml"
        files[href] = _xhtml(chapter.title, body, language).encode()
        items.append((f"chapter-{number:03d}", href, "application/xhtml+xml", " ".join(sorted(properties))))
        nav_entries += entries
    nav = (f'<nav epub:type="toc" id="toc"><h1>Contents</h1>{_nav_list(nav_entries)}</nav>')
    files["nav.xhtml"] = _xhtml("Contents", nav, language).encode()
    files["style.css"] = STYLE.encode()
    items[:0] = [("nav", "nav.xhtml", "application/xhtml+xml", "nav"), ("style", "style.css", "text/css", "")]
    for index, image in enumerate(images, 1):
        files[f"images/{image.name}"] = image.data
        items.append((f"image-{index:03d}", f"images/{image.name}", image.media_type, ""))
    digest = hashlib.sha256(f"{title}\0{author}\0{language}".encode())
    for name in sorted(files):
        digest.update(name.encode() + b"\0" + files[name])
    identifier = uuid.uuid5(uuid.NAMESPACE_URL, "readfocus:" + digest.hexdigest())
    manifest = "".join(f'<item id="{i}" href={quoteattr(h)} media-type="{t}"'
                       + (f' properties="{p}"' if p else "") + "/>" for i, h, t, p in items)
    spine = "".join(f'<itemref idref="{i}"/>' for i, h, *_ in items if h.startswith("chapter-"))
    creator = f"<dc:creator>{escape(author)}</dc:creator>" if author.strip() else ""
    opf = ('<?xml version="1.0" encoding="utf-8"?>\n'
           f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="{language}">'
           '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
           f'<dc:identifier id="book-id">urn:uuid:{identifier}</dc:identifier><dc:title>{escape(title)}</dc:title>'
           f'{creator}<dc:language>{language}</dc:language><meta property="dcterms:modified">{modified}</meta>'
           f"</metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>\n")
    container = ('<?xml version="1.0" encoding="utf-8"?>\n'
                 '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                 '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                 "</rootfiles></container>\n")
    stamp = tuple(int(x) for x in re.findall(r"\d+", modified))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        def put(name: str, data: bytes, method: int = zipfile.ZIP_DEFLATED) -> None:
            info = zipfile.ZipInfo(name, date_time=stamp)
            info.compress_type = method
            archive.writestr(info, data)
        put("mimetype", b"application/epub+zip", zipfile.ZIP_STORED)
        put("META-INF/container.xml", container.encode())
        put("OEBPS/content.opf", opf.encode())
        for name, data in files.items():
            put(f"OEBPS/{name}", data)
    return out.getvalue()


def check_epub(data: bytes) -> list[str]:
    """Structural problems of an EPUB 3 file (empty when sound): what epubcheck checks first, without Java."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return ["not a zip file"]
    infos = archive.infolist()
    names = {info.filename for info in infos}
    first = infos[0] if infos else None
    if not first or first.filename != "mimetype":
        return ["mimetype is not the first entry"]
    if first.compress_type != zipfile.ZIP_STORED or first.extra or archive.read(first) != b"application/epub+zip":
        return ["mimetype must be stored uncompressed, with no extra field, holding application/epub+zip"]
    try:
        container = minidom.parseString(archive.read("META-INF/container.xml"))
        opf_path = container.getElementsByTagName("rootfile")[0].getAttribute("full-path")
        package = minidom.parseString(archive.read(opf_path)).documentElement
    except (KeyError, IndexError, ExpatError) as e:
        return [f"container or package file missing or broken: {e}"]
    problems = []
    base = opf_path.rpartition("/")[0] + "/" if "/" in opf_path else ""
    if package.getAttribute("version") != "3.0":
        problems.append("package version is not 3.0")
    ids = [e for e in package.getElementsByTagName("dc:identifier") if e.getAttribute("id") == package.getAttribute("unique-identifier")]
    metas = [m for m in package.getElementsByTagName("meta") if m.getAttribute("property") == "dcterms:modified"]
    for missing, found in (("dc:identifier", ids), ("dcterms:modified", metas),
                           ("dc:title", package.getElementsByTagName("dc:title")),
                           ("dc:language", package.getElementsByTagName("dc:language"))):
        if not found:
            problems.append(f"package metadata has no {missing}")
    items = {i.getAttribute("id"): i for i in package.getElementsByTagName("item")}
    hrefs = {base + i.getAttribute("href") for i in items.values()}
    problems += [f"manifest item {h} is not in the zip" for h in sorted(hrefs - names)]
    problems += [f"{n} is in the zip but not the manifest" for n in sorted(names - hrefs - {"mimetype", opf_path})
                 if not n.startswith("META-INF/")]
    if sum("nav" in i.getAttribute("properties").split() for i in items.values()) != 1:
        problems.append("the manifest needs exactly one nav item")
    for ref in package.getElementsByTagName("itemref"):
        if ref.getAttribute("idref") not in items:
            problems.append(f"spine item {ref.getAttribute('idref')} is not in the manifest")
    for item in items.values():
        path = base + item.getAttribute("href")
        if item.getAttribute("media-type") != "application/xhtml+xml" or path not in names:
            continue
        try:
            doc = minidom.parseString(archive.read(path))
        except ExpatError as e:
            problems.append(f"{path} is not well-formed: {e}")
            continue
        folder = path.rpartition("/")[0] + "/"
        problems += [f"{path}: <img> {img.getAttribute('src')} is not in the manifest"
                     for img in doc.getElementsByTagName("img") if folder + img.getAttribute("src") not in hrefs]
        problems += [f"{path}: MathML <{e.localName}> must be inside <semantics>"  # as epubcheck's schema asks
                     for name in ("annotation", "annotation-xml") for e in doc.getElementsByTagNameNS(MATHML_NS, name)
                     if e.parentNode.localName != "semantics"]
    return problems
