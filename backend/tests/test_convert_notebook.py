"""Jupyter notebooks to EPUB (C19.2b): cells in order, plots and image outputs kept as captioned figures."""

import io
import json
import zipfile
from pathlib import Path
from xml.dom import minidom

import pytest

from backend.convert.epub_builder import build_epub, check_epub
from backend.convert.markdown import convert_markdown
from backend.convert.notebook import convert_notebook
from backend.regions import epub as epub_regions

FIXTURE = (Path(__file__).parent / "fixtures" / "sources" / "sample.ipynb").read_bytes()
MATHML_NS = "http://www.w3.org/1998/Math/MathML"


def epub_of(converted) -> bytes:
    return build_epub(converted.title, "Ada", converted.chapters, converted.images, modified="2026-11-13T00:00:00Z")


def documents(data: bytes) -> list[minidom.Document]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return [minidom.parseString(archive.read(n)) for n in sorted(archive.namelist()) if n.startswith("OEBPS/chapter-")]


def source_images(notebook: dict) -> int:
    """Images the notebook holds: markdown attachments plus image outputs (one per output)."""
    attachments = sum(len(c.get("attachments", {})) for c in notebook["cells"])
    outputs = sum(1 for c in notebook["cells"] for o in c.get("outputs", [])
                  if any(k in o.get("data", {}) for k in ("image/png", "image/jpeg", "image/svg+xml")))
    return attachments + outputs


def test_title_and_chapters_follow_the_top_headings():
    converted = convert_notebook(FIXTURE, "sample")
    assert converted.title == "Fourier basics"
    assert [c.title for c in converted.chapters] == ["Fourier basics", "Results"]


def test_image_count_in_source_equals_image_count_in_epub():
    converted = convert_notebook(FIXTURE, "sample")
    data = epub_of(converted)
    imgs = [img for doc in documents(data) for img in doc.getElementsByTagName("img")]
    assert source_images(json.loads(FIXTURE)) == len(imgs) == len(converted.images) == 3
    assert {i.media_type for i in converted.images} == {"image/png", "image/svg+xml"}


def test_image_outputs_are_figures_captioned_with_their_cell():
    doc = documents(epub_of(convert_notebook(FIXTURE, "sample")))[0]
    figures = doc.getElementsByTagName("figure")
    captions = [f.getElementsByTagName("figcaption")[0].firstChild.data for f in figures]
    assert captions == ["Output of cell 3", "Output of cell 5"]
    alts = [f.getElementsByTagName("img")[0].getAttribute("alt") for f in figures]
    assert alts == captions


def test_code_cells_are_code_blocks_in_the_kernel_language():
    doc = documents(epub_of(convert_notebook(FIXTURE, "sample")))[0]
    codes = [p.getElementsByTagName("code")[0] for p in doc.getElementsByTagName("pre")
             if not p.getAttribute("class")]
    assert codes[0].getAttribute("class") == "language-python"
    assert codes[0].firstChild.data == "import numpy as np\n\nx = np.linspace(0, 1, 5)\nprint(x)"


def test_text_outputs_are_small_output_blocks_without_ansi():
    body = "".join(c.body for c in convert_notebook(FIXTURE, "sample").chapters)
    assert '<pre class="rf-output"><code>[0.   0.25 0.5  0.75 1.  ]\n</code></pre>' in body
    assert "ZeroDivisionError: division by zero" in body
    assert "\x1b" not in body and "[0;31m" not in body
    assert "   a  b\n0  1  2\n1  3  4" in body  # text/plain chosen over text/html
    assert "&lt;Figure size" not in body  # an image output's text stand-in is not shown as well


def test_markdown_cells_keep_math_and_tables():
    doc = documents(epub_of(convert_notebook(FIXTURE, "sample")))[0]
    assert [m.getAttribute("display") for m in doc.getElementsByTagNameNS(MATHML_NS, "math")] == ["inline", "block"]
    assert doc.getElementsByTagName("table")


def test_the_epub_is_sound_and_its_regions_found():
    data = epub_of(convert_notebook(FIXTURE, "sample"))
    assert check_epub(data) == []
    kinds = [r["kind"] for r in epub_regions.epub_regions(data)]
    assert kinds.count("figure") == 3
    assert {"math", "code", "table", "prose"} <= set(kinds)


@pytest.mark.parametrize("data, message", [
    (b"not json", "not a Jupyter notebook"),
    (json.dumps({"nbformat": 3, "worksheets": []}).encode(), "format 4"),
])
def test_other_files_are_refused_with_a_reason(data, message):
    with pytest.raises(ValueError, match=message):
        convert_notebook(data, "x")


def test_characters_xml_forbids_are_dropped():
    notebook = {"nbformat": 4, "metadata": {}, "cells": [
        {"cell_type": "code", "execution_count": 1, "source": "print('\\x07')", "metadata": {},
         "outputs": [{"output_type": "stream", "name": "stdout", "text": "bell\x07\x00 done\n"}]}]}
    converted = convert_notebook(json.dumps(notebook).encode(), "bell")
    assert check_epub(epub_of(converted)) == []
    assert "bell done" in converted.chapters[0].body
    assert check_epub(epub_of(convert_markdown("# A\x0c\n\nform\x0bfeed\n", "x"))) == []
