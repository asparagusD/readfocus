"""LaTeX in looked-up text as plain reading text (C41.3, issue 30).

The Free Dictionary API passes Wiktionary's math through as LaTeX source
("(x_1, \\ldots, x_m)\\in\\R^{m+1}"), and Wikipedia extracts can carry
"{\\displaystyle ...}". `plain` turns the common commands into Unicode
(ℝ, ∈, …, →, x₁, ᵐ⁺¹), writes a script with no Unicode form as "x_b" or
"2^(q+1)", and gives None for markup it cannot make readable, so the
caller can leave that text out. Text with no markup comes back unchanged.
Standard library only.
"""

import re

SUPERSCRIPT = dict(zip("0123456789+-=()", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾", strict=True)) | dict(
    zip("abcdefghijklmnoprstuvwxyz", "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ", strict=True))
SUBSCRIPT = dict(zip("0123456789+-=()", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎", strict=True)) | dict(
    zip("aehijklmnoprstuvx", "ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ", strict=True))

BLACKBOARD = {"R": "ℝ", "N": "ℕ", "Z": "ℤ", "Q": "ℚ", "C": "ℂ", "P": "ℙ", "H": "ℍ"}
GREEK = {name: chr(code) for name, code in {
    "alpha": 0x3B1, "beta": 0x3B2, "gamma": 0x3B3, "delta": 0x3B4, "epsilon": 0x3B5, "varepsilon": 0x3B5,
    "zeta": 0x3B6, "eta": 0x3B7, "theta": 0x3B8, "vartheta": 0x3D1, "iota": 0x3B9, "kappa": 0x3BA, "lambda": 0x3BB,
    "mu": 0x3BC, "nu": 0x3BD, "xi": 0x3BE, "pi": 0x3C0, "rho": 0x3C1, "sigma": 0x3C3, "tau": 0x3C4,
    "upsilon": 0x3C5, "phi": 0x3C6, "varphi": 0x3C6, "chi": 0x3C7, "psi": 0x3C8, "omega": 0x3C9,
    "Gamma": 0x393, "Delta": 0x394, "Theta": 0x398, "Lambda": 0x39B, "Xi": 0x39E, "Pi": 0x3A0, "Sigma": 0x3A3,
    "Upsilon": 0x3A5, "Phi": 0x3A6, "Psi": 0x3A8, "Omega": 0x3A9,
}.items()}
# Relations and operators, written with a space either side.
SPACED = {
    "in": "∈", "notin": "∉", "ni": "∋", "subset": "⊂", "subseteq": "⊆", "supset": "⊃", "supseteq": "⊇",
    "to": "→", "rightarrow": "→", "longrightarrow": "→", "mapsto": "↦", "leftarrow": "←", "gets": "←",
    "Rightarrow": "⇒", "implies": "⇒", "Leftarrow": "⇐", "Leftrightarrow": "⇔", "iff": "⇔", "leftrightarrow": "↔",
    "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥", "ne": "≠", "neq": "≠", "approx": "≈", "equiv": "≡", "sim": "∼",
    "simeq": "≃", "cong": "≅", "propto": "∝", "times": "×", "cdot": "·", "cup": "∪", "cap": "∩", "setminus": "∖",
    "oplus": "⊕", "otimes": "⊗", "land": "∧", "wedge": "∧", "lor": "∨", "vee": "∨", "pm": "±", "mp": "∓",
    "mid": "|", "perp": "⊥", "parallel": "∥",
}
SYMBOLS = GREEK | {
    "R": "ℝ", "N": "ℕ", "Z": "ℤ", "Q": "ℚ", "C": "ℂ", "reals": "ℝ", "Reals": "ℝ", "naturals": "ℕ", "integers": "ℤ",
    "infty": "∞", "circ": "∘", "ast": "*", "star": "⋆", "emptyset": "∅", "varnothing": "∅", "forall": "∀",
    "exists": "∃", "neg": "¬", "lnot": "¬", "partial": "∂", "nabla": "∇", "sum": "∑", "prod": "∏", "int": "∫",
    "oint": "∮", "ldots": "…", "dots": "…", "cdots": "…", "vdots": "⋮", "ddots": "⋱", "prime": "′", "degree": "°",
    "angle": "∠", "vert": "|", "lvert": "|", "rvert": "|", "Vert": "‖", "langle": "⟨", "rangle": "⟩",
    "lfloor": "⌊", "rfloor": "⌋", "lceil": "⌈", "rceil": "⌉", "aleph": "ℵ", "hbar": "ℏ", "ell": "ℓ", "Re": "ℜ",
    "Im": "ℑ", "colon": ":", "quad": " ", "qquad": " ", "mod": " mod ", "bmod": " mod ",
} | {name: name for name in (
    "lim", "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log",
    "ln", "lg", "exp", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "gcd", "arg", "Pr",
)} | {name: f" {sym} " for name, sym in SPACED.items()}
DROPPED = {"displaystyle", "textstyle", "scriptstyle", "left", "right", "big", "Big", "bigl", "bigr", "Bigl", "Bigr",
           "limits", "nolimits", "middle"}
TEXT = {"mathrm", "text", "textrm", "mathit", "mathbf", "mathsf", "mathtt", "operatorname", "boldsymbol", "textit",
        "textbf", "emph", "mbox", "hbox"}
FRACTIONS = {"frac", "dfrac", "tfrac"}
ESCAPED = {",": " ", ";": " ", ":": " ", "!": "", " ": " ", "{": "{", "}": "}", "\\": " ", "%": "%", "_": "_",
           "&": "&", "#": "#", "$": "$", "|": "‖"}

_MARKUP = re.compile(r"\\|[\w)}][_^]")
_INLINE = re.compile(r"\$([^$]*[\\^_][^$]*)\$")  # $...$ around math, not a price
_SIMPLE = re.compile(r"\w+")


class _Unreadable(Exception):
    """Markup with no plain reading."""


def plain(text: str) -> str | None:
    """`text` with its LaTeX as readable Unicode; unchanged with no markup; None when it cannot be made readable."""
    if not text or not _MARKUP.search(text):
        return text
    try:
        out = _Reader(_INLINE.sub(r"\1", text)).read(closing=False)
    except _Unreadable:
        return None
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"\s+([,.;:)\]])", r"\1", out)
    return re.sub(r"([(\[])\s+", r"\1", out).strip()


class _Reader:
    def __init__(self, text: str):
        self.text, self.at = text, 0

    def read(self, closing: bool) -> str:
        """Read up to the end, or to the `}` closing a group when `closing`."""
        out = []
        while self.at < len(self.text):
            ch = self.text[self.at]
            self.at += 1
            if ch == "}":
                if closing:
                    return "".join(out)
                raise _Unreadable("unmatched }")
            if ch == "{":
                out.append(self.read(closing=True))
            elif ch == "\\":
                out.append(self.command())
            elif ch in "^_":
                out.append(self.script(ch))
            else:
                out.append(ch)
        if closing:
            raise _Unreadable("unclosed {")
        return "".join(out)

    def command(self) -> str:
        match = re.compile(r"[A-Za-z]+").match(self.text, self.at)
        if not match:  # \, \{ \\ and the like
            if self.at >= len(self.text) or self.text[self.at] not in ESCAPED:
                raise _Unreadable("unknown escape")
            self.at += 1
            return ESCAPED[self.text[self.at - 1]]
        name = match.group()
        self.at = match.end()
        if self.text[self.at:].lstrip(" ")[:1] in ("^", "_"):  # \sum _{i}: the space after a control word goes
            self.at = len(self.text) - len(self.text[self.at:].lstrip(" "))
        if name in DROPPED:
            return ""
        if name in TEXT:
            return self.argument()
        if name == "mathbb":
            letter = self.argument().strip()
            if letter not in BLACKBOARD:
                raise _Unreadable(f"\\mathbb{{{letter}}}")
            return BLACKBOARD[letter]
        if name in FRACTIONS:
            top, bottom = self.argument(), self.argument()
            return f"{_wrapped(top)}/{_wrapped(bottom)}"
        if name == "sqrt":
            return f"√{_wrapped(self.argument())}"
        if name in SYMBOLS:
            return SYMBOLS[name]
        raise _Unreadable(f"\\{name}")

    def argument(self) -> str:
        """A command's or a script's argument: a {group}, a \\command, or one character."""
        while self.at < len(self.text) and self.text[self.at] == " ":
            self.at += 1
        if self.at >= len(self.text):
            raise _Unreadable("missing argument")
        ch = self.text[self.at]
        self.at += 1
        if ch == "{":
            return self.read(closing=True)
        if ch == "\\":
            return self.command()
        if ch == "}":
            raise _Unreadable("missing argument")
        return ch

    def script(self, mark: str) -> str:
        body = self.argument().replace(" ", "")
        table = SUPERSCRIPT if mark == "^" else SUBSCRIPT
        if body and all(ch in table for ch in body):
            return "".join(table[ch] for ch in body)
        return f"{mark}{body}" if len(body) == 1 else f"{mark}({body})"


def _wrapped(part: str) -> str:
    part = part.strip()
    return part if _SIMPLE.fullmatch(part) else f"({part})"
