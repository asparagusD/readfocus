"""POST /steve/latex (C20.8): a PDF equation as LaTeX, one Gemini call per equation ever (migration 025).

The cache is keyed by the file's sha256, the page and a hash of the box, so every reader with that same PDF gets the
first reader's answer without a call. Reuses test_steve_api's in-memory database and fake Gemini.
"""

import base64

import pytest

from backend.dependencies import get_current_user
from backend.main import app
from backend.tests.test_steve_api import BOOK, OTHER, PNG, USER, env  # noqa: F401 - env is a fixture

IMAGE = base64.b64encode(PNG).decode()
SHA = "f" * 64


@pytest.fixture
def latex_env(env, monkeypatch):  # noqa: F811 - the fixture above
    env.db.tables["books"][0]["file_sha256"] = SHA
    env.db.tables["books"].append({"id": "book-2", "user_id": OTHER, "title": "Same file", "author": "", "toc": [],
                                   "file_sha256": SHA})
    env.db.tables["books"].append({"id": "book-3", "user_id": OTHER, "title": "Another file", "author": "",
                                   "toc": [], "file_sha256": "0" * 64})
    env.db.tables["page_regions"] += [
        {"id": "r-eq", "book_id": BOOK, "page": 4, "kind": "math", "bbox": [100.04, 150.0, 300.0, 170.0], "text": "",
         "meta": {"drawn": True}, "order_in_page": 1},
        {"id": "r-eq2", "book_id": "book-2", "page": 4, "kind": "math", "bbox": [100.0, 150.0, 300.0, 170.0],
         "text": "", "meta": {}, "order_in_page": 1},
        {"id": "r-eq3", "book_id": "book-3", "page": 4, "kind": "math", "bbox": [100.0, 150.0, 300.0, 170.0],
         "text": "", "meta": {}, "order_in_page": 1},
        {"id": "r-epub-eq", "book_id": BOOK, "page": None, "spine_index": 2, "kind": "math", "bbox": None, "text": "x",
         "meta": {"latex": "x"}, "order_in_page": 0},
    ]
    env.gemini.pieces = ["$$a_n = \\frac{1}{\\pi}$$"]
    return env


def latex(env, region_id="r-eq", book_id=BOOK, image=IMAGE):  # noqa: F811
    body = {"book_id": book_id, "region_id": region_id}
    if image is not None:
        body["image_png_b64"] = image
    return env.client.post("/steve/latex", json=body)


def test_the_first_ask_calls_gemini_once_and_stores_bare_latex(latex_env):
    response = latex(latex_env)
    assert response.status_code == 200
    assert response.json() == {"latex": "a_n = \\frac{1}{\\pi}", "cached": False, "model": "gemini-test-vision"}
    (call,) = latex_env.gemini.calls
    assert call["model"] == "vision" and call["stream"] is False and "Return ONLY the LaTeX" in call["system"]
    assert call["parts"][1] == {"inline_data": {"mime_type": "image/png", "data": PNG}}
    (row,) = latex_env.db.tables["equation_latex"]
    assert (row["file_sha256"], row["page"], row["latex"]) == (SHA, 4, "a_n = \\frac{1}{\\pi}")
    assert len(row["bbox_hash"]) == 32


def test_asking_again_costs_nothing(latex_env):
    latex(latex_env)
    again = latex(latex_env, image=None)  # no image needed once it is known
    assert again.json()["cached"] is True and again.json()["latex"] == "a_n = \\frac{1}{\\pi}"
    assert len(latex_env.gemini.calls) == 1


def test_another_reader_with_the_same_file_gets_it_without_a_call(latex_env):
    latex(latex_env)
    app.dependency_overrides[get_current_user] = lambda: OTHER
    shared = latex(latex_env, region_id="r-eq2", book_id="book-2", image=None)
    assert shared.status_code == 200 and shared.json()["cached"] is True  # a box within rounding is the same box
    other_file = latex(latex_env, region_id="r-eq3", book_id="book-3", image=None)
    assert other_file.status_code == 422 and other_file.json()["detail"]["code"] == "needs_image"
    assert len(latex_env.gemini.calls) == 1


def test_a_cached_equation_needs_no_consent_but_a_new_one_does(latex_env):
    latex(latex_env)
    latex_env.db.tables["profiles"][0].update(steve_consent_at=None, steve_consent_version=None)
    assert latex(latex_env, image=None).json()["cached"] is True
    latex_env.db.tables["equation_latex"].clear()
    response = latex(latex_env)
    assert response.status_code == 403 and response.json()["detail"]["code"] == "no_consent"
    assert len(latex_env.gemini.calls) == 1


@pytest.mark.parametrize("region_id, status, code", [
    ("r-code", 422, "not_pdf_equation"),
    ("r-epub-eq", 422, "not_pdf_equation"),   # an EPUB equation is converted on the device, never by Gemini
    ("nope", 404, "region_not_found"),
    ("r-eq2", 404, "region_not_found"),       # another reader's region
])
def test_only_the_readers_own_pdf_equations(latex_env, region_id, status, code):
    response = latex(latex_env, region_id=region_id)
    assert response.status_code == status and response.json()["detail"]["code"] == code
    assert latex_env.gemini.calls == []


def test_another_readers_book_is_not_found(latex_env):
    response = latex(latex_env, book_id="book-2", region_id="r-eq2")
    assert response.status_code == 404 and response.json()["detail"]["code"] == "book_not_found"


def test_a_pause_is_typed_and_nothing_is_stored(latex_env):
    from backend.steve.errors import SteveUnavailable
    latex_env.gemini.error = SteveUnavailable("paused_quota", retry_after=60)
    response = latex(latex_env)
    assert response.status_code == 429 and response.json()["detail"]["code"] == "paused_quota"
    assert "equation_latex" not in latex_env.db.tables or not latex_env.db.tables["equation_latex"]


def test_an_empty_answer_is_not_stored(latex_env):
    latex_env.gemini.pieces = ["   "]
    response = latex(latex_env)
    assert response.status_code == 503 and not latex_env.db.tables.get("equation_latex")


def test_a_too_large_image_is_refused(latex_env):
    big = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * (501 * 1024)).decode()
    assert latex(latex_env, image=big).status_code == 413
