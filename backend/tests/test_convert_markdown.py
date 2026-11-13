"""Markdown to EPUB (C19.2a): structure, MathML with its LaTeX, exact code, packaged and remote images."""

import io
import zipfile
from pathlib import Path
from xml.dom import minidom

import pytest

from backend.convert.epub_builder import build_epub, check_epub
from backend.convert.markdown import convert_markdown
from backend.convert.texmath import tex_to_mathml
from backend.regions import epub as epub_regions
from backend.tests.test_epub_builder import SVG, png

SOURCE = (Path(__file__).parent / "fixtures" / "sources" / "sample.md").read_text(encoding="utf-8")
RESOURCES = {"figures/spectrum.png": png(40, 20), "figures/filter.svg": SVG}
MATHML_NS = "http://www.w3.org/1998/Math/MathML"


def epub_of(converted) -> bytes:
    return build_epub(converted.title, "Ada", converted.chapters, converted.images, modified="2026-11-13T00:00:00Z")


def documents(data: bytes) -> list[minidom.Document]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = sorted(n for n in archive.namelist() if n.startswith("OEBPS/chapter-"))
        return [minidom.parseString(archive.read(n)) for n in names]


def test_tex_becomes_mathml_with_its_latex_kept():
    math = minidom.parseString(tex_to_mathml(r"\frac{a}{b}", display=True)).documentElement
    assert (math.namespaceURI, math.getAttribute("display")) == (MATHML_NS, "block")
    semantics = math.getElementsByTagName("semantics")[0]
    assert semantics.parentNode is math
    annotation = semantics.getElementsByTagName("annotation")[0]
    assert annotation.getAttribute("encoding") == "application/x-tex"
    assert annotation.firstChild.data == r"\frac{a}{b}"
    assert semantics.getElementsByTagName("mfrac")


def test_tex_that_does_not_convert_is_kept_as_code():
    out = tex_to_mathml(r"\frac{a}{", display=False)
    assert out.startswith('<code class="tex-error">') and r"\frac{a}{" in out


def test_title_chapters_and_structure():
    converted = convert_markdown(SOURCE, "sample", RESOURCES)
    assert converted.title == "Signals and noise"
    assert [c.title for c in converted.chapters] == ["Signals and noise", "Filters"]
    first = converted.chapters[0].body
    for tag in ("<blockquote>", "<ul>", "<ol>", "<table>", "<th>Window</th>", "<h2>A worked equation</h2>"):
        assert tag in first
    assert "$5 and $6" in first  # money is not math
    assert "&lt;b&gt;HTML&lt;/b&gt;" in converted.chapters[1].body  # raw HTML is text


def test_inline_and_display_math_are_mathml_with_latex():
    doc = documents(epub_of(convert_markdown(SOURCE, "sample", RESOURCES)))[0]
    maths = doc.getElementsByTagNameNS(MATHML_NS, "math")
    assert [m.getAttribute("display") for m in maths] == ["inline", "block"]
    latex = [m.getElementsByTagName("annotation")[0].firstChild.data.strip() for m in maths]
    assert latex[0] == r"E = \sum_n |x_n|^2"
    assert latex[1].startswith(r"\hat{x}(f) = \int")


def test_fenced_code_is_exact_with_its_language():
    doc = documents(epub_of(convert_markdown(SOURCE, "sample", RESOURCES)))[0]
    code = doc.getElementsByTagName("pre")[0].getElementsByTagName("code")[0]
    assert code.getAttribute("class") == "language-python"
    assert code.firstChild.data == "def energy(xs):\n    # every space is kept\n    return sum(x * x for x in xs)\n"


def test_local_images_are_packaged_and_counted_remote_ones_listed():
    converted = convert_markdown(SOURCE, "sample", RESOURCES)
    data = epub_of(converted)
    imgs = [img for doc in documents(data) for img in doc.getElementsByTagName("img")]
    local_in_source = 2  # spectrum.png, filter.svg
    assert len(imgs) == len(converted.images) == local_in_source
    assert [img.getAttribute("alt") for img in imgs] == ["A spectrum plot", "A filter diagram"]
    assert {i.media_type for i in converted.images} == {"image/png", "image/svg+xml"}
    assert any("https://example.org/chart.png" in n for n in converted.notes)
    assert "Image not included" in converted.chapters[0].body


def test_a_single_md_lists_its_missing_local_images_and_still_builds():
    converted = convert_markdown(SOURCE, "sample", {})
    assert converted.images == []
    assert sum("figures/" in n for n in converted.notes) == 2
    assert check_epub(epub_of(converted)) == []


def test_data_uri_images_are_packaged():
    import base64
    uri = "data:image/png;base64," + base64.b64encode(png(3, 3)).decode()
    converted = convert_markdown(f"# T\n\n![dot]({uri})\n", "t", {})
    assert len(converted.images) == 1 and converted.notes == []


def test_relative_links_lose_their_target_remote_ones_keep_it():
    body = convert_markdown(SOURCE, "sample", RESOURCES).chapters[0].body
    assert 'href="https://example.org/source"' in body
    assert 'href="notes.md"' not in body


def test_a_path_out_of_the_upload_is_not_read():
    converted = convert_markdown("# T\n\n![x](../secret.png)\n", "t", {"secret.png": png(2, 2)})
    assert converted.images == [] and converted.notes


def test_no_heading_gives_one_chapter_named_by_the_file():
    converted = convert_markdown("Just a paragraph.\n", "my_notes", {})
    assert converted.title == "my_notes" and len(converted.chapters) == 1


@pytest.mark.parametrize("resources", [RESOURCES, {}])
def test_the_epub_is_sound_and_its_regions_found(resources):
    data = epub_of(convert_markdown(SOURCE, "sample", resources))
    assert check_epub(data) == []
    kinds = {r["kind"] for r in epub_regions.epub_regions(data)}
    assert {"math", "code", "table", "prose"} <= kinds
    if resources:
        assert "figure" in kinds
