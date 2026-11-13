"""Markdown to EPUB chapters (C19.2a), with markdown-it-py (MIT) and its dollarmath plugin.

CommonMark plus tables; raw HTML is escaped (shown as text, never run).
`$...$` and `$$...$$` become MathML with the LaTeX kept (`texmath`); a
`$` next to a digit stays text, so "$5 and $6" is money. Fenced code keeps
every character, its language in `class="language-x"`. Images: data URIs
and files inside the upload (a .zip) are packed; remote images are never
fetched (no third-party calls) and, with any local image the upload lacks,
are listed in `notes` and shown as "[Image not included: ...]". Links keep
only http(s) and mailto targets: a relative one would point nowhere in the
book. Each top-level heading starts a chapter when there are two or more.
"""

import base64
import binascii
import re
from itertools import pairwise
from urllib.parse import unquote

from markdown_it import MarkdownIt
from markdown_it.common.utils import escapeHtml
from mdit_py_plugins.dollarmath import dollarmath_plugin

from backend.convert.assets import Converted, ImageStore, clean, resolve
from backend.convert.epub_builder import Chapter
from backend.convert.texmath import tex_to_mathml

LANGUAGE = re.compile(r"[A-Za-z0-9_+#.-]{1,30}")
KEPT_LINKS = ("http://", "https://", "mailto:")


def _image(self, tokens, idx, options, env) -> str:
    token = tokens[idx]
    src = token.attrGet("src") or ""
    alt = self.renderInlineAsText(token.children or [], options, env).strip()
    data, missing = None, None
    if src.startswith("data:"):
        head, _, payload = src.partition(",")
        try:
            data = base64.b64decode(payload, validate=True) if head.endswith(";base64") else unquote(payload).encode()
        except (binascii.Error, ValueError):
            missing = "an image whose data could not be read"
    elif src.startswith("attachment:"):
        data = env["attachments"].get(src.removeprefix("attachment:"))
        missing = None if data else f"the attachment {src}"
    elif src.startswith(("http://", "https://", "//")):
        missing = f"{src} (remote images are not downloaded)"
    else:
        path = resolve(env["base"], src)
        data = env["resources"].get(path) if path else None
        missing = None if data else f"{src} (not in the upload)"
    packed = env["store"].add(data) if data else None
    if packed is None:
        env["notes"].append(f"Image not included: {missing or src + ' (not a supported image)'}")
        return f'<span class="rf-missing-image">[Image not included: {escapeHtml(alt or src)}]</span>'
    return f'<img src="{packed}" alt="{escapeHtml(alt)}" />'


def _fence(self, tokens, idx, options, env) -> str:
    token = tokens[idx]
    words = (token.info or "").split()
    language = words[0] if words and LANGUAGE.fullmatch(words[0]) else ""
    attr = f' class="language-{escapeHtml(language)}"' if language else ""
    return f"<pre><code{attr}>{escapeHtml(token.content)}</code></pre>\n"


def _link_open(self, tokens, idx, options, env) -> str:
    token = tokens[idx]
    if not (token.attrGet("href") or "").startswith(KEPT_LINKS):
        token.attrs.pop("href", None)
    return self.renderToken(tokens, idx, options, env)


def _math(display: bool):
    return lambda self, tokens, idx, options, env: tex_to_mathml(tokens[idx].content, display)


def _parser() -> MarkdownIt:
    md = MarkdownIt("commonmark", {"xhtmlOut": True, "html": False}).enable("table")
    md.use(dollarmath_plugin, allow_digits=False, allow_labels=False)
    for name, rule in (("image", _image), ("fence", _fence), ("code_block", _fence), ("link_open", _link_open),
                       ("math_inline", _math(False)), ("math_inline_double", _math(True)),
                       ("math_block", _math(True)), ("math_block_label", _math(True))):
        md.add_render_rule(name, rule)
    return md


MD = _parser()


def environment(store: ImageStore, notes: list[str], resources: dict[str, bytes] | None = None,
                base: str = "", attachments: dict[str, bytes] | None = None) -> dict:
    """What the image rule needs: where packed images go, where notes go, and what the upload holds."""
    return {"store": store, "notes": notes, "resources": resources or {}, "base": base,
            "attachments": attachments or {}}


def sections(text: str, env: dict) -> list[tuple[str | None, str]]:
    """(top-level heading text or None, XHTML) per section: split at every h1 when there are two or more."""
    tokens = MD.parse(text, env)
    starts = [i for i, t in enumerate(tokens) if t.type == "heading_open" and t.tag == "h1"]
    if len(starts) < 2:
        starts = [0]
    elif starts[0] != 0:
        starts[0] = 0  # anything before the first heading opens the first chapter
    bounds = [*starts, len(tokens)]
    out = []
    for a, b in pairwise(bounds):
        heading = next((tokens[i + 1] for i in range(a, b) if tokens[i].type == "heading_open" and tokens[i].tag == "h1"),
                       None)
        label = MD.renderer.renderInlineAsText(heading.children or [], MD.options, env).strip() if heading else None
        out.append((label or None, MD.renderer.render(tokens[a:b], MD.options, env)))
    return out


def convert_markdown(text: str, name: str, resources: dict[str, bytes] | None = None, base: str = "") -> Converted:
    """A Markdown document as chapters and images; `name` (the file's stem) titles a book with no heading."""
    store, notes = ImageStore(), []
    env = environment(store, notes, resources, base)
    parts = sections(clean(text), env)
    title = next((label for label, _ in parts if label), None) or name
    chapters = [Chapter(label or title, body) for label, body in parts]
    return Converted(title, chapters, store.images, notes)
