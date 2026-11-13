"""Jupyter notebooks (nbformat 4) to EPUB chapters (C19.2b).

Markdown cells go through the Markdown converter (math, tables, code, and
`attachment:` images packed). Code cells become code blocks in the
kernel's language. Outputs, in order: an image (PNG, JPEG or SVG; a plot
is a PNG) becomes a figure captioned "Output of cell N", N being the
cell's place in the notebook from 1; otherwise `text/latex` becomes
MathML and `text/plain` a small output block (`text/html` is never used:
it is not run or trusted); `stream` and `error` outputs are output blocks
with ANSI colour codes removed. Widgets and JavaScript are left out. Each
top-level markdown heading starts a chapter when there are two or more.
"""

import base64
import binascii
import json
from itertools import pairwise
from xml.sax.saxutils import escape

from backend.convert.assets import Converted, ImageStore, clean
from backend.convert.epub_builder import Chapter
from backend.convert.markdown import MD, environment
from backend.convert.texmath import tex_to_mathml

IMAGE_TYPES = ("image/png", "image/jpeg", "image/svg+xml")


def _text(value) -> str:
    """A notebook string field, stored as one string or a list of lines."""
    return clean("".join(value) if isinstance(value, list) else str(value or ""))


def _image_bytes(value, media_type: str) -> bytes | None:
    if media_type == "image/svg+xml":
        return _text(value).encode()
    try:
        return base64.b64decode("".join(_text(value).split()), validate=True)
    except (binascii.Error, ValueError):
        return None


def _block(text: str, kind: str = "rf-output") -> str:
    return f'<pre class="{kind}"><code>{escape(text)}</code></pre>' if text.strip() else ""


def _output(output: dict, cell: int, store: ImageStore, notes: list[str]) -> str:
    kind = output.get("output_type")
    if kind == "stream":
        return _block(_text(output.get("text")), "rf-output rf-stderr" if output.get("name") == "stderr" else "rf-output")
    if kind == "error":
        return _block("\n".join(_text(line) for line in output.get("traceback") or []) or
                      f"{output.get('ename', 'Error')}: {output.get('evalue', '')}", "rf-output rf-error")
    data = output.get("data") or {}
    for media_type in IMAGE_TYPES:
        if media_type in data:
            raw = _image_bytes(data[media_type], media_type)
            src = store.add(raw) if raw else None
            if src is None:
                notes.append(f"Image not included: an output of cell {cell} could not be read")
                return f'<p class="rf-missing-image">[Image not included: output of cell {cell}]</p>'
            caption = f"Output of cell {cell}"
            return f'<figure><img src="{src}" alt="{caption}" /><figcaption>{caption}</figcaption></figure>'
    if "text/latex" in data:
        tex = _text(data["text/latex"]).strip().strip("$").strip()
        return tex_to_mathml(tex, display=True)
    return _block(_text(data.get("text/plain")))


def _markdown_segments(source: str, env: dict) -> list[tuple[str | None, str]]:
    """(h1 text or None, XHTML) for one markdown cell, cut before each top-level heading."""
    tokens = MD.parse(source, env)
    starts = [i for i, t in enumerate(tokens) if t.type == "heading_open" and t.tag == "h1"]
    bounds = sorted({0, *starts, len(tokens)})
    out = []
    for a, b in pairwise(bounds):
        label = None
        if a in starts:
            label = MD.renderer.renderInlineAsText(tokens[a + 1].children or [], MD.options, env).strip() or None
        out.append((label, MD.renderer.render(tokens[a:b], MD.options, env)))
    return out


def convert_notebook(data: bytes, name: str) -> Converted:
    """A notebook file as chapters and images; `name` (the file's stem) titles one with no heading."""
    try:
        notebook = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ValueError("This is not a Jupyter notebook (the file is not JSON).") from e
    if not isinstance(notebook, dict) or notebook.get("nbformat") != 4:
        raise ValueError("Only Jupyter notebooks in format 4 (Jupyter 4 or later) can be added.")
    meta = notebook.get("metadata") or {}
    language = ((meta.get("language_info") or {}).get("name") or (meta.get("kernelspec") or {}).get("language")
                or "python")
    store, notes, segments = ImageStore(), [], []
    for number, cell in enumerate(notebook.get("cells") or [], 1):
        source = _text(cell.get("source"))
        if cell.get("cell_type") == "markdown":
            attachments = {key: _image_bytes(value, media)
                           for key, kinds in (cell.get("attachments") or {}).items()
                           for media, value in kinds.items() if media in IMAGE_TYPES}
            env = environment(store, notes, attachments={k: v for k, v in attachments.items() if v})
            segments += _markdown_segments(source, env)
        elif cell.get("cell_type") == "code":
            parts = [f'<pre><code class="language-{escape(language)}">{escape(source)}</code></pre>'] if source.strip() else []
            parts += [_output(o, number, store, notes) for o in cell.get("outputs") or []]
            segments.append((None, "".join(parts)))
    labels = [label for label, _ in segments if label]
    title = clean(str(meta.get("title") or "")).strip() or (labels[0] if labels else name)
    if len(labels) < 2:
        return Converted(title, [Chapter(title, "".join(html for _, html in segments) or "<p></p>")], store.images, notes)
    chapters: list[list] = []
    for label, html in segments:
        if label or not chapters:
            chapters.append([label or title, []])
        chapters[-1][1].append(html)
    return Converted(title, [Chapter(t, "".join(parts)) for t, parts in chapters], store.images, notes)
