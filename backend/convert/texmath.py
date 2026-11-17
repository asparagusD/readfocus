"""LaTeX to MathML for converted books (C19.2), with the LaTeX kept beside it.

The MathML from latex2mathml (MIT, pure Python) goes inside
`<semantics><mrow>...</mrow><annotation encoding="application/x-tex">`, as
KaTeX writes it, so "Copy as LaTeX" and the region map (`regions/epub.py`)
read the source back without guessing. TeX that does not convert, or uses a
command latex2mathml does not know, is kept as `<code class="tex-error">`
with its source: never dropped, never shown as garbled symbols.
"""

from xml.dom import minidom
from xml.sax.saxutils import escape

from latex2mathml.converter import convert

MATHML_NS = "http://www.w3.org/1998/Math/MathML"


def tex_to_mathml(tex: str, display: bool) -> str:
    """One `<math>` element (display "block" or "inline"), or a `tex-error` code span."""
    source = tex.strip()
    fallback = f'<code class="tex-error">{escape(source)}</code>'
    try:
        math = minidom.parseString(convert(source)).documentElement
    except Exception:  # noqa: BLE001 - latex2mathml raises many kinds for bad TeX; minidom ExpatError too
        return fallback
    unknown = any((node.firstChild is not None and node.firstChild.nodeType == node.TEXT_NODE
                   and node.firstChild.data.startswith("\\"))
                  for name in ("mi", "mo", "mtext") for node in math.getElementsByTagName(name))
    if unknown or not math.childNodes:
        return fallback
    inner = "".join(child.toxml() for child in math.childNodes)
    return (f'<math xmlns="{MATHML_NS}" display="{"block" if display else "inline"}"><semantics>'
            f'<mrow>{inner}</mrow><annotation encoding="application/x-tex">{escape(source)}</annotation>'
            "</semantics></math>")
