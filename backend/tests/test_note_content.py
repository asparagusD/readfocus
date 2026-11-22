"""Note block content (C22.1): each kind's content is checked against an allow-list before it is stored.

Text is a TipTap JSON document (never HTML) with allowed nodes, marks and attributes only; drawings are an
Excalidraw scene whose images are files in the reader's own folder of the "notes" bucket; equation, code and
figure blocks have fixed fields. Sizes are capped from policy.
"""

import pytest

from backend.agents import policy
from backend.services.note_content import ContentError, check_content, has_words

USER, BOOK = "user-1", "book-1"
MINE = f"{USER}/{BOOK}/a1b2.webp"


def doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def para(*inline):
    return {"type": "paragraph", "content": list(inline)}


def text(value, *marks):
    node = {"type": "text", "text": value}
    if marks:
        node["marks"] = [{"type": m} for m in marks]
    return node


def check(kind, content):
    return check_content(kind, content, user_id=USER, book_id=BOOK)


def test_a_rich_text_document_with_inline_math_is_kept_as_given():
    content = doc(
        para(text("The "), text("coefficients", "bold"), text(" say "), {"type": "inlineMath", "attrs": {"latex": "a_n"}}),
        {"type": "bulletList", "content": [{"type": "listItem", "content": [para(text("odd", "italic", "code"))]}]},
        {"type": "orderedList", "attrs": {"start": 3}, "content": [{"type": "listItem", "content": [para(text("x"))]}]},
        {"type": "blockquote", "content": [para(text("quote"), {"type": "hardBreak"}, text("more", "strike"))]},
        para(),
    )
    assert check("text", content) == content


def test_checklists_and_display_math_are_kept():
    """C22.2b: TipTap's task list and our display-math node, as the editor writes them."""
    content = doc(
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": True}, "content": [para(text("read 4.2"))]},
            {"type": "taskItem", "attrs": {"checked": False}, "content": [para(text("eq. 4.4")), {
                "type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": False}, "content": [para(text("odd"))]}]}]},
        ]},
        {"type": "blockMath", "attrs": {"latex": r"\sum_{k=1}^{n} k"}},
        {"type": "orderedList", "attrs": {"start": 1, "type": None}, "content": [{"type": "listItem", "content": [para(text("x"))]}]},
    )
    assert check("text", content) == content


@pytest.mark.parametrize("node", [
    {"type": "taskItem", "attrs": {"checked": "yes"}, "content": []},
    {"type": "blockMath", "attrs": {"latex": 1}},
    {"type": "blockMath", "attrs": {}},
    {"type": "blockMath", "attrs": {"latex": "x"}, "content": [text("x")]},
])
def test_bad_checklists_and_display_math_are_refused(node):
    with pytest.raises(ContentError):
        check("text", doc(node))


@pytest.mark.parametrize("content", [
    {"type": "paragraph"},                                           # the root is a doc
    doc({"type": "image", "attrs": {"src": "x"}}),                   # images are not text nodes
    doc(para(text("x", "link"))),                                    # no links
    doc(para({"type": "text", "text": "x", "marks": [{"type": "bold", "attrs": {"href": "x"}}]})),
    doc({"type": "paragraph", "attrs": {"style": "color:red"}}),     # attributes only where listed
    doc(para({"type": "inlineMath", "attrs": {"latex": 3}})),
    doc(para({"type": "text", "text": ""})),                         # ProseMirror never stores empty text
    doc(para({"type": "text", "text": "x", "html": "<b>x</b>"})),    # unknown keys
    doc({"type": "orderedList", "attrs": {"start": "1"}, "content": []}),
    {"type": "doc", "content": "<p>x</p>"},
])
def test_text_outside_the_allow_list_is_refused(content):
    with pytest.raises(ContentError):
        check("text", content)


def test_text_depth_and_length_are_capped():
    deep = para(text("x"))
    for _ in range(policy.NOTE_DOC_DEPTH_MAX):
        deep = {"type": "blockquote", "content": [deep]}
    with pytest.raises(ContentError, match="deep"):
        check("text", doc(deep))
    with pytest.raises(ContentError, match="long"):
        check("text", doc(para(text("x" * (policy.NOTE_TEXT_MAX + 1)))))


def test_a_drawing_keeps_its_elements_and_files_in_the_readers_folder():
    scene = {"elements": [{"type": "rectangle", "id": "r1", "x": 1, "y": 2}],
             "appState": {"viewBackgroundColor": "#fff", "paper": "ruled"},
             "files": {"f1": {"path": MINE, "mimeType": "image/webp"}}}
    assert check("drawing", scene) == scene


@pytest.mark.parametrize("scene", [
    {"elements": "x"},
    {"elements": [{"type": "rectangle"}] * (policy.NOTE_DRAWING_ELEMENTS_MAX + 1)},
    {"elements": [], "appState": {"collaborators": {}}},                         # app state allow-listed
    {"elements": [], "appState": {"paper": "lined"}},                            # C37.1: ruled, squared or plain
    {"elements": [], "files": {"f1": {"dataURL": "data:image/png;base64,AAAA", "mimeType": "image/png"}}},
    {"elements": [], "files": {"f1": {"path": "user-2/book-1/a.webp", "mimeType": "image/webp"}}},
    {"elements": [], "files": {"f1": {"path": f"{USER}/{BOOK}/../x.webp", "mimeType": "image/webp"}}},
    {"elements": [], "extra": 1},
])
def test_bad_drawings_are_refused(scene):
    with pytest.raises(ContentError):
        check("drawing", scene)


@pytest.mark.parametrize(("elements", "words"), [
    ([{"type": "text", "text": "Fourier"}], True),
    ([{"type": "rectangle"}, {"type": "text", "text": "  \n"}], False),          # blank text is not words
    ([{"type": "text", "text": "gone", "isDeleted": True}], False),             # nor a deleted element
    ([{"type": "text"}], False),
])
def test_a_drawing_has_words_when_a_live_text_element_has_text(elements, words):
    assert has_words("drawing", {"elements": elements}) is words


def test_only_a_drawing_has_notebook_words():
    assert has_words("code", {"code": "x = 1", "language": "python"}) is False


def test_equation_code_and_figure_fields():
    anchor = {"kind": "pdf", "page": 4, "quads": [[10, 20, 300, 80]], "text": ""}
    assert check("equation", {"latex": r"a_n = \frac{1}{\pi}", "image_path": MINE})["latex"] == r"a_n = \frac{1}{\pi}"
    assert check("equation", {"latex": "", "image_path": None}) == {"latex": "", "image_path": None}
    assert check("code", {"code": "def f():\n    return 1\n", "language": "python"})["code"].endswith("1\n")
    figure = check("figure", {"image_path": MINE, "caption": "Figure 4.2", "source_anchor": anchor})
    assert figure["source_anchor"]["page"] == 4


@pytest.mark.parametrize(("kind", "content"), [
    ("equation", {"latex": "x" * (policy.NOTE_LATEX_MAX + 1), "image_path": None}),
    ("equation", {"latex": "x", "image_path": "user-2/book-1/a.webp"}),          # another reader's folder
    ("equation", {"latex": "x", "image_path": "https://example.com/a.png"}),
    ("code", {"code": "x", "language": "brainfuck"}),
    ("code", {"code": "x" * (policy.NOTE_CODE_MAX + 1), "language": ""}),
    ("figure", {"image_path": MINE, "caption": "x" * (policy.NOTE_CAPTION_MAX + 1), "source_anchor": None}),
    ("figure", {"image_path": MINE, "caption": "", "source_anchor": {"kind": "pdf", "page": 0, "quads": []}}),
    ("code", {"code": "x", "language": "python", "html": "<script>"}),
    ("poem", {}),
])
def test_bad_fields_are_refused(kind, content):
    with pytest.raises(ContentError):
        check(kind, content)


def test_content_over_the_row_budget_is_refused():
    big = doc(*[para(text("y" * 1_000)) for _ in range(20)])  # 20,000 characters of text, under NOTE_TEXT_MAX
    assert check("text", big)
    scene = {"elements": [{"type": "line", "points": [[i, i] for i in range(1_000)]} for _ in range(40)]}
    with pytest.raises(ContentError, match="large"):
        check("drawing", scene)
