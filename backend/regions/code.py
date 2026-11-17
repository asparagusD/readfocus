"""Code blocks of a PDF page, rebuilt with their exact indentation (C18.4). Pure functions.

A line is code when most of its characters are monospace: a monospace font
name (policy.MONO_FONT_PATTERN) or, when the name says nothing, equal
advances for narrow and wide letters alike. Consecutive code lines make a
block; a line of prose between them ends it. Rows are the block's lines
sharing a baseline (a gutter number pulled apart from its code is one row).

Text is rebuilt from positions, not from the extracted words: every
character goes to column round((x0 - block_left) / char_width), char_width
being the mean advance of the block's monospace characters, so indentation
and inner alignment come back exactly. A line-number gutter (numbers
counting up by one at the start of most rows) is stripped and recorded as
meta.line_numbers; numbered blank lines and gaps of a whole line pitch
become blank lines. meta.language_guess comes from keyword patterns.
Thresholds: backend/regions/policy.py.
"""

import re
from itertools import pairwise
from statistics import mean, median, pstdev

from backend.regions import policy

MONO_FONT = re.compile(policy.MONO_FONT_PATTERN, re.IGNORECASE)
UNNAMED_FONT = re.compile(policy.CODE_UNNAMED_FONT_PATTERN)
NARROW, WIDE = set("iljtfI1."), set("mwMW")

LANGUAGES = {  # pattern -> weight; each pattern counts once per line
    "python": {r"^\s*def \w+\(.*\):\s*$": 2, r"^\s*(import \w+|from \w+(\.\w+)* import )": 2, r"\bself\b": 1,
               r"^\s*(if|elif|while|for|with|try|else|except)\b.*:\s*(#.*)?$": 1, r'"""': 2,
               r"\b(None|True|False)\b": 1, r"^\s*class \w+(\(.*\))?:\s*$": 2, r"\bprint\(": 1},
    "scheme": {r"^\s*\((define|lambda|let\*?|letrec|cond|if|begin|set!)\b": 2, r"\((lambda|define)\b": 1,
               r"^\s*\([\w\-!?*<>=/+]+[\s)]": 1,
               r"\((car|cdr|cons|null\?|else|list|display)\b": 1, r"^\s*\(": 1, r"\)\)\)\s*$": 1},
    "c": {r"#include\s*[<\"]": 3, r"\bprintf\s*\(": 2, r"\b(int|void|char|double|float|long)\s+\**\w+\s*\(": 2,
          r";\s*(//.*)?$": 1, r"\bstd::": 3, r"\b(struct|typedef|sizeof|unsigned)\b": 2, r"\w->\w": 1},
    "java": {r"\b(public|private|protected)\s+(static\s+)?(final\s+)?(class|void|int|String|boolean)\b": 3,
             r"\bSystem\.out\.": 3, r"\bnew\s+[A-Z]\w*\s*[(<\[]": 2, r"^\s*import\s+java\.": 3, r"@Override": 3,
             r"\bString\[\]": 2},
    "javascript": {r"\bfunction\s*\w*\s*\(": 2, r"\b(const|let|var)\s+\w+\s*=": 2, r"=>": 2, r"\bconsole\.log\(": 3,
                   r"\bdocument\.|\bwindow\.": 2, r"===|!==": 2},
    "matlab": {r"^\s*%": 2, r"^\s*function\s+(\[[^\]]*\]|\w+)\s*=": 3, r"^\s*end\s*;?\s*$": 1,
               r"\b(zeros|ones|disp|linspace|plot|size|numel)\(": 2, r"\.\*|\.\^|\./": 2},
}
COMPILED = {lang: [(re.compile(p), w) for p, w in pats.items()] for lang, pats in LANGUAGES.items()}


def guess_language(text: str) -> str:
    """The language whose keyword patterns score highest, or "unknown" when none stands out."""
    scores = {lang: sum(w for line in text.split("\n") for pattern, w in pats if pattern.search(line))
              for lang, pats in COMPILED.items()}
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best, runner_up = ranked[0], ranked[1]
    if best[1] < policy.CODE_LANGUAGE_MIN_SCORE or best[1] == runner_up[1]:
        return "unknown"
    return best[0]


def monospace_fonts(lines) -> set[str]:
    """Fonts with names that say nothing ("F12", "T1_0") whose letters, narrow and wide, all have one advance
    across the page."""
    by_font: dict[str, list] = {}
    for line in lines:
        for char in line.chars:
            if UNNAMED_FONT.match(char.font):
                by_font.setdefault(char.font, []).append(char)
    found = set()
    for font, chars in by_font.items():
        texts = {c.text for c in chars}
        if len(chars) < policy.CODE_EQUAL_ADVANCE_MIN_CHARS or not (texts & NARROW and texts & WIDE):
            continue  # without a narrow and a wide letter, equal widths prove nothing
        widths = [c.x1 - c.x0 for c in chars]
        if pstdev(widths) <= policy.CODE_EQUAL_ADVANCE_SPREAD * mean(widths):
            found.add(font)
    return found


def is_mono(char, mono_fonts=frozenset()) -> bool:
    return bool(MONO_FONT.search(char.font)) or char.font in mono_fonts


def _has_prose_word(line, mono_fonts) -> bool:
    """A run of at least CODE_PROSE_WORD_LETTERS letters outside the monospace font: a word of prose."""
    run = 0
    for char in line.chars:
        run = run + 1 if char.text.isalpha() and not is_mono(char, mono_fonts) else 0
        if run >= policy.CODE_PROSE_WORD_LETTERS:
            return True
    return False


def is_code_line(line, mono_fonts=frozenset()) -> bool:
    """Mostly monospace; or partly, with no word of prose (placeholders such as "⟨??⟩" in a code template)."""
    visible = [c for c in line.chars if not c.text.isspace()]
    if not visible:
        return False
    share = sum(1 for c in visible if is_mono(c, mono_fonts)) / len(visible)
    if share >= policy.CODE_MONO_SHARE:
        return True
    return share >= policy.CODE_TEMPLATE_SHARE and not _has_prose_word(line, mono_fonts)


def _overlap_x(a, b) -> bool:
    return min(a[2], b[2]) > max(a[0], b[0])


def code_groups(lines) -> list[list[int]]:
    """Indexes of lines in each code block, top to bottom."""
    mono_fonts = monospace_fonts(lines)
    order = sorted(range(len(lines)), key=lambda i: (lines[i].top, lines[i].x0))
    groups, current, box = [], [], None
    for i in order:
        line = lines[i]
        span = [line.x0, line.top, line.x1, line.bottom]
        if is_code_line(line, mono_fonts):
            pitch = policy.CODE_MAX_GAP_LINES * line.size
            if current and line.top - box[3] <= pitch and (_overlap_x(span, box) or abs(line.top - lines[current[-1]].top)
                                                           < line.size / 2):
                current.append(i)
                box = [min(box[0], span[0]), box[1], max(box[2], span[2]), max(box[3], span[3])]
                continue
            if current:
                groups.append(current)
            current, box = [i], span
        elif current and _overlap_x(span, box) and line.top >= box[1]:
            groups.append(current)  # prose below the block ends it
            current, box = [], None
    if current:
        groups.append(current)
    alnum = [sum(1 for i in group for c in lines[i].chars if c.text.isalnum()) for group in groups]
    return [g for g, count in zip(groups, alnum, strict=True) if count >= policy.CODE_MIN_ALNUM]


def _rows(lines) -> list[list]:
    """Characters of the block grouped by baseline, top to bottom, each row left to right."""
    rows: list[list] = []
    for line in sorted(lines, key=lambda n: n.baseline):
        if rows and abs(rows[-1][0] - line.baseline) <= policy.CODE_SAME_ROW_EM * line.size:
            rows[-1][1].extend(line.chars)
        else:
            rows.append([line.baseline, list(line.chars)])
    return [[baseline, sorted(chars, key=lambda c: c.x0)] for baseline, chars in rows]


def _gutter(rows, width) -> list[int] | None:
    """How many leading characters of each row are its line number, if the block has a gutter."""
    numbers, counts = [], []
    for _, chars in rows:
        k = 0
        while k < len(chars) and chars[k].text.isdigit():
            k += 1
        followed = k == len(chars) or (k and chars[k].x0 - chars[k - 1].x1 >= policy.CODE_GUTTER_GAP_CHARS * width)
        if k and followed:
            numbers.append(int("".join(c.text for c in chars[:k])))
            counts.append(k)
        else:
            numbers.append(None)
            counts.append(0)
    present = [n for n in numbers if n is not None]
    if len(present) < max(policy.CODE_GUTTER_MIN_ROWS, policy.CODE_GUTTER_SHARE * len(rows)):
        return None
    if any(b != a + 1 for a, b in pairwise(present)):
        return None
    return counts


def rebuild(lines) -> tuple[str, dict]:
    """The block's text with exact indentation, and meta (char_width, line_numbers when stripped)."""
    mono_fonts = monospace_fonts(lines)
    mono = [c for n in lines for c in n.chars if is_mono(c, mono_fonts)] or [c for n in lines for c in n.chars]
    width = mean(c.x1 - c.x0 for c in mono)
    rows = _rows(lines)
    meta = {"char_width": round(width, 3)}
    cut = _gutter(rows, width)
    if cut:
        numbers = ["".join(c.text for c in chars[:k]) for (_, chars), k in zip(rows, cut, strict=True) if k]
        meta["line_numbers"] = [int(numbers[0]), int(numbers[-1])]
        rows = [[baseline, chars[k:]] for (baseline, chars), k in zip(rows, cut, strict=True)]
    left = min((chars[0].x0 for _, chars in rows if chars), default=0.0)
    gaps = [b[0] - a[0] for a, b in pairwise(rows)]
    pitch = median(gaps) if gaps else 0.0
    out = []
    for index, (baseline, chars) in enumerate(rows):
        if index and pitch:
            out += [""] * max(0, round((baseline - rows[index - 1][0]) / pitch) - 1)
        text = ""
        for char in chars:
            column = round((char.x0 - left) / width)
            text += " " * max(0, column - len(text)) + char.text
        out.append(text.rstrip())
    while out and not out[-1]:
        out.pop()
    return "\n".join(out), meta
