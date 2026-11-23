"""LaTeX in looked-up definitions as plain reading text (C41.3, issue 30)."""

import pytest

from backend.services import plain_math
from backend.services.plain_math import plain

GRAPH = ("A set of points constituting a graphical representation of a real function; (formally) a set of tuples "
         "(x_1, x_2, \\ldots, x_m, y)\\in\\R^{m+1}, where y=f(x_1, x_2, \\ldots, x_m) for a given function "
         "f: \\R^m\\rightarrow\\R.")


def test_the_graph_definition_from_issue_30_reads_as_text():
    assert plain(GRAPH) == ("A set of points constituting a graphical representation of a real function; (formally) a "
                            "set of tuples (x₁, x₂, …, xₘ, y) ∈ ℝᵐ⁺¹, where y=f(x₁, x₂, …, xₘ) for a given function "
                            "f: ℝᵐ → ℝ.")


@pytest.mark.parametrize("text", ["To move swiftly.", "A device for giving light.", "", "e.g. 3 + 4 = 7 (approx.)",
                                  "Rock 'n' roll; a {curly} word", "A coin worth $5, or $6 in Canada."])
def test_text_without_markup_is_left_alone(text):
    assert plain(text) == text


@pytest.mark.parametrize("latex, text", [
    ("$x^2 + y^2 = r^2$", "x² + y² = r²"),
    ("\\alpha \\le \\beta", "α ≤ β"),
    ("\\mathbb{R}", "ℝ"),
    ("\\mathbb {N}", "ℕ"),
    ("\\frac{1}{2}", "1/2"),
    ("\\frac{a+b}{c}", "(a+b)/c"),
    ("\\sqrt{2}", "√2"),
    ("\\sqrt{x+1}", "√(x+1)"),
    ("\\mathrm{d}x", "dx"),
    ("x_{\\text{max}}", "xₘₐₓ"),
    ("e^{i\\pi} + 1 = 0", "e^(iπ) + 1 = 0"),  # π has no superscript form
    ("\\{1, 2\\}", "{1, 2}"),
    ("{\\displaystyle \\sum _{i=1}^{n}i}", "∑ᵢ₌₁ⁿi"),
    ("a\\,b\\;c", "a b c"),
    ("f\\colon A\\to B", "f: A → B"),
    ("\\sin\\theta", "sinθ"),
])
def test_common_latex_becomes_unicode(latex, text):
    assert plain(latex) == text


def test_a_script_with_no_unicode_form_is_written_plainly():
    assert plain("x_b") == "x_b"
    assert plain("2^{q+1}") == "2^(q+1)"
    assert plain("a_{bc}") == "a_(bc)"


@pytest.mark.parametrize("latex", ["\\begin{matrix} a \\end{matrix}", "\\mathbb{X}", "a } b \\in c", "\\frac{1}",
                                   "\\unknowncommand x"])
def test_markup_that_cannot_be_made_readable_gives_none(latex):
    assert plain(latex) is None


def test_the_script_maps_cover_digits_signs_and_letters():
    assert len(plain_math.SUPERSCRIPT) == 15 + 25 and len(plain_math.SUBSCRIPT) == 15 + 17
    assert all(len(ch) == 1 for ch in [*plain_math.SUPERSCRIPT.values(), *plain_math.SUBSCRIPT.values()])
