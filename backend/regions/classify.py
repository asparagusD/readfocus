"""Display math regions and inline math spans of a PDF page (C18.3). Pure functions.

Input is an extract.Page; output is the page's regions in reading order:
kind "math" for display math (equations, systems, matrices set apart from
the text), kind "block" for everything else, which C18.4 and C18.5 split
further into prose, code, figures and tables. A block's meta carries its
inline math as character ranges into its text ("inline_math") and boxes
("inline_boxes"), so prose for the agents can put placeholders there.

Evidence, character by character (monospace characters never count: they
are code): a math font, a math symbol (Unicode Sm, Greek, arrows, primes,
the dot operators), or a sub- or superscript (off the baseline and smaller;
raised digits after a word are footnote marks, a unit after a number is
not math). A line is display math when enough of it is evidence and it
holds an operator or relation, or it is set off from the text column with
some evidence. Display lines closer than MATH_GROUP_GAP_EM make one region,
which takes in short neighbours (a radical's top, a limit, a fraction's
numerator and denominator) and an equation number at the right margin.
Every threshold is in backend/regions/policy.py.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from statistics import median

from backend.regions import code, policy

MATH_FONT = re.compile(policy.MATH_FONT_PATTERN)
MONO_FONT = re.compile(policy.MONO_FONT_PATTERN, re.IGNORECASE)
EQUATION_NUMBER = re.compile(policy.MATH_EQUATION_NUMBER)
EXTRA_SYMBOLS = set("·⋅′″‴∘") | {chr(c) for c in range(0x2190, 0x2200)} | {chr(c) for c in range(0x27F0, 0x2800)}
EDGE_PUNCTUATION = ",.;:"


@dataclass
class Region:
    kind: str
    lines: list = field(repr=False)
    bbox: list
    text: str
    meta: dict


def is_math_font(font: str) -> bool:
    return bool(MATH_FONT.search(font))


def is_math_symbol(text: str) -> bool:
    if not text or len(text) != 1:
        return False
    if text in EXTRA_SYMBOLS or unicodedata.category(text) == "Sm":
        return True
    code = ord(text)
    return 0x0391 <= code <= 0x03C9 or 0x03D0 <= code <= 0x03F5 or 0x1D400 <= code <= 0x1D7FF


def iou(a, b) -> float:
    """Intersection over union of two [x0, top, x1, bottom] boxes."""
    width = min(a[2], b[2]) - max(a[0], b[0])
    height = min(a[3], b[3]) - max(a[1], b[1])
    if width <= 0 or height <= 0:
        return 0.0
    shared = width * height
    total = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - shared
    return shared / total if total else 0.0


def _box(items) -> list:
    return [min(i.x0 for i in items), min(i.top for i in items), max(i.x1 for i in items),
            max(i.bottom for i in items)]


# --- characters -------------------------------------------------------------------------------

def _is_script(char, line) -> bool:
    offset = abs(char.baseline_offset)
    if char.size <= policy.MATH_SMALL_SCRIPT_SIZE * line.size:
        return offset >= policy.MATH_SMALL_SCRIPT_OFFSET_EM * line.size
    return offset >= policy.MATH_SCRIPT_OFFSET_EM * line.size and char.size <= policy.MATH_SCRIPT_SIZE * line.size


def _footnotes(line) -> set:
    """Indexes of raised characters that are not math: footnote digits after a word or full stop (or
    opening the line), and ordinal endings ("kth", "2nd")."""
    marks, chars = set(), line.chars
    i = 0
    while i < len(chars):
        char = chars[i]
        if not (char.baseline_offset > 0 and _is_script(char, line) and char.text.isalnum()):
            i += 1
            continue
        j = i
        while j < len(chars) and chars[j].baseline_offset > 0 and _is_script(chars[j], line) and chars[j].text.isalnum():
            j += 1
        raised = "".join(c.text for c in chars[i:j])
        before = chars[i - 1] if i else None
        footnote = raised.isdigit() and (before is None or (not is_math_font(before.font) and (
            before.text.isalpha() or before.text in ".,;:)”’\"'")))
        ordinal = raised in ("st", "nd", "rd", "th") and before is not None and before.text.isalnum()
        if footnote or ordinal:
            marks.update(range(i, j))
        i = j
    return marks


def _evidence(line) -> list[set]:
    """For each character: the kinds of math evidence it gives (empty for none)."""
    marks = _footnotes(line)
    out = []
    for index, char in enumerate(line.chars):
        found = set()
        if not MONO_FONT.search(char.font) and index not in marks:
            if is_math_font(char.font):
                found.add("math_font")
            if is_math_symbol(char.text):
                found.add("symbols")
            if _is_script(char, line):
                found.add("scripts")
            if char.text in policy.MATH_UNIT_SYMBOLS and _after_number(line, index):
                found.clear()
        out.append(found)
    return out


def _after_number(line, index) -> bool:
    before = line.text[:line.chars[index].offset].rstrip()
    return bool(before) and before[-1].isdigit()


def _is_operator(char) -> bool:
    """A symbol, or any glyph of a math font that is not a letter or digit (a relation drawn as "(cid:21)")."""
    if char.text.isalnum():
        return False
    return is_math_symbol(char.text) or (is_math_font(char.font) and char.text not in "()[]{},.;:")


# --- display math ----------------------------------------------------------------------------

def _column(lines) -> tuple[float, float]:
    long = [n for n in lines if len(n.text) >= policy.MATH_COLUMN_LINE_CHARS] or lines
    return median(n.x0 for n in long), median(n.x1 for n in long)


def _visible(line) -> int:
    return sum(1 for c in line.chars if not c.text.isspace())


def _display_line(line, evidence, column) -> set | None:
    """The clues that make this line display math, or None."""
    strong = [c for c, e in zip(line.chars, evidence, strict=True) if e]
    if len(strong) < policy.MATH_DISPLAY_MIN_STRONG or not any(_is_operator(c) for c in strong):
        return None
    share = len(strong) / max(1, _visible(line))
    set_off = line.x0 - column[0] >= policy.MATH_SET_OFF_INDENT_EM * line.size
    if share >= policy.MATH_DISPLAY_SHARE or (set_off and share >= policy.MATH_DISPLAY_SET_OFF_SHARE):
        clues = set().union(*evidence)
        return clues | ({"set_off"} if set_off else set())
    return None


def _near(line, group, size) -> bool:
    top, bottom = min(n.top for n in group), max(n.bottom for n in group)
    return line.top - bottom <= policy.MATH_GROUP_GAP_EM * size and top - line.bottom <= policy.MATH_GROUP_GAP_EM * size


def _overlaps_x(line, group) -> bool:
    return min(line.x1, max(n.x1 for n in group)) > max(line.x0, min(n.x0 for n in group))


def _beside(line, group, size) -> bool:
    """Overlapping the group horizontally, or within MATH_GROUP_GAP_EM of its sides."""
    gap = max(min(n.x0 for n in group) - line.x1, line.x0 - max(n.x1 for n in group))
    return gap <= policy.MATH_GROUP_GAP_EM * size


def _stacked(lines, evidence_of) -> tuple[set, set]:
    """Short lines stacked on one another (a fraction): all of them, and those that stand on their
    own because each stack's lines include math evidence."""
    pairs = []
    short = [i for i, n in enumerate(lines) if _visible(n) <= policy.MATH_STACK_MAX_CHARS]
    for a in short:
        for b in short:
            upper, lower = lines[a], lines[b]
            gap = lower.top - upper.bottom
            if a != b and 0 <= gap <= policy.MATH_STACK_GAP_EM * upper.size and _overlaps_x(lower, [upper]):
                pairs.append((a, b))
    every = {i for pair in pairs for i in pair}
    return every, {i for pair in pairs if evidence_of[pair[0]] or evidence_of[pair[1]] for i in pair}


def _display_groups(lines, evidences, column) -> list[dict]:
    clues = {i: _display_line(n, evidences[i], column) for i, n in enumerate(lines)}
    seeds = {i for i, c in clues.items() if c is not None}
    stacked_all, stacked = _stacked(lines, {i: any(e for e in evidences[i]) for i in range(len(lines))})
    groups: list[dict] = []
    for i in sorted(seeds | stacked, key=lambda k: (lines[k].top, lines[k].x0)):
        line = lines[i]
        home = next((g for g in groups if _near(line, [lines[k] for k in g["ids"]], line.size)), None)
        if home is None:
            groups.append({"ids": [i], "clues": set()})
            home = groups[-1]
        else:
            home["ids"].append(i)
        home["clues"] |= clues[i] or set()
        if i in stacked:
            home["clues"].add("stack")
    groups = [g for g in groups if any(i in seeds for i in g["ids"]) or "stack" in g["clues"]]
    taken = {i for g in groups for i in g["ids"]}
    for group in groups:  # short neighbours and equation numbers
        for i, line in enumerate(lines):
            if i in taken:
                continue
            members = [lines[k] for k in group["ids"]]
            number = EQUATION_NUMBER.match(line.text.strip())
            middle = (line.top + line.bottom) / 2
            if number and line.x1 >= column[1] - policy.MATH_EQUATION_NUMBER_MARGIN_EM * line.size \
                    and min(n.top for n in members) <= middle <= max(n.bottom for n in members):
                group["ids"].append(i)
                group["number"] = number.group(1)
                group["clues"].add("equation_number")
                taken.add(i)
            elif (_visible(line) <= policy.MATH_FRAGMENT_MAX_CHARS or i in stacked_all) \
                    and _near(line, members, line.size) and _beside(line, members, line.size):
                group["ids"].append(i)
                taken.add(i)
                if i in stacked_all:
                    group["clues"].add("stack")
    for group in groups:  # an equation number glued to the end of a display line
        if "number" not in group:
            for i in group["ids"]:
                tail = re.search(r"\((\d+(?:\.\d+)*[a-z]?)\)\s*$", lines[i].text)
                if tail and lines[i].x1 >= column[1] - policy.MATH_EQUATION_NUMBER_MARGIN_EM * lines[i].size:
                    group["number"] = tail.group(1)
                    group["clues"].add("equation_number")
    return groups


# --- inline math -----------------------------------------------------------------------------

def _tokens(line, evidence):
    """(start, end, strong, chars) for each space-separated token of the line's text."""
    out, start = [], None
    for index, char in enumerate(line.chars):
        if start is not None and char.offset > out[-1][1]:
            start = None
        if start is None:
            out.append([char.offset, char.offset + len(char.text), False, []])
            start = char.offset
        out[-1][1] = char.offset + len(char.text)
        out[-1][2] = out[-1][2] or bool(evidence[index])
        out[-1][3].append((char, evidence[index]))
    return out


def _compatible(token_text: str) -> bool:
    core = token_text.strip(EDGE_PUNCTUATION + "()[]{}")
    letters = [ch for ch in core if not ch.isdigit() and ch not in EDGE_PUNCTUATION + "()[]{}/|+-'"]
    if not core:
        return True
    if any(b in token_text for b in "()[]{}") and len(letters) <= 4:
        return True
    return len(core) <= policy.MATH_INLINE_SHORT and (any(ch.isdigit() for ch in core) or len(letters) <= 1)


def _trim(token):
    """Cut a plain word glued to the front or back of a strong token ("withpn" -> "pn")."""
    start, end, _, chars = token
    first = next(i for i, (_, e) in enumerate(chars) if e)
    last = max(i for i, (_, e) in enumerate(chars) if e)
    if first and all(c.text.isdigit() and c.baseline_offset > 0 for c, _ in chars[:first]):
        start = chars[first][0].offset  # a footnote mark glued in front ("58" before "↦")
    lead = [c for c, _ in chars[:first]]
    if len(lead) >= policy.MATH_WORD_LETTERS and all(c.text.isalpha() and not is_math_font(c.font) for c in lead):
        start = chars[first][0].offset
    tail = [c for c, _ in chars[last + 1:]]
    if len(tail) >= policy.MATH_WORD_LETTERS and all(c.text.isalpha() and not is_math_font(c.font) for c in tail):
        end = chars[last][0].offset + len(chars[last][0].text)
    return start, end


def _inline_spans(line, evidence) -> list[tuple[int, int]]:
    mono = sum(1 for c in line.chars if MONO_FONT.search(c.font))
    if mono >= policy.MATH_MONO_LINE_SHARE * max(1, len(line.chars)):
        return []  # a line of code
    tokens = _tokens(line, evidence)
    spans, run, depth = [], [], 0
    for token in tokens + [None]:
        text = line.text[token[0]:token[1]] if token else ""
        previous = line.text[run[-1][0]:run[-1][1]] if run else ""
        ends_item = previous.endswith(",") and depth <= 0 or previous.endswith(".") and not (token and token[2])
        if token and (token[2] or _compatible(text)) and not ends_item:
            run.append(token)
            depth += text.count("(") + text.count("[") + text.count("{") - text.count(")") - text.count("]")                 - text.count("}")
            continue
        # A short token joins only next to a strong one, or when it opens (closes) a bracket of the span.
        while run and not run[0][2] and not (len(run) > 1 and run[1][2]) and not _opens(line, run[0]):
            run.pop(0)
        while run and not run[-1][2] and not (len(run) > 1 and run[-2][2]) and not _closes(line, run[-1]):
            run.pop()
        if any(t[2] for t in run):
            start = _trim(run[0])[0] if run[0][2] else run[0][0]
            end = _trim(run[-1])[1] if run[-1][2] else run[-1][1]
            while end > start and line.text[end - 1] in EDGE_PUNCTUATION and not _strong_at(line, evidence, end - 1):
                end -= 1
            spans.append((start, end))
        run, depth = [], 0
        if token and (token[2] or _compatible(text)):  # the token that ended an item starts the next run
            run = [token]
            depth = text.count("(") - text.count(")")
    return spans


def _opens(line, token) -> bool:
    return any(b in line.text[token[0]:token[1]] for b in "([{")


def _closes(line, token) -> bool:
    return any(b in line.text[token[0]:token[1]] for b in ")]}")


def _strong_at(line, evidence, offset) -> bool:
    return any(e for c, e in zip(line.chars, evidence, strict=True) if c.offset == offset)


# --- regions ---------------------------------------------------------------------------------

def _block_region(lines, evidences) -> Region:
    text, ranges, boxes, cursor = "", [], [], 0
    for n, (line, evidence) in enumerate(zip(lines, evidences, strict=True)):
        if n:
            text += "\n"
            cursor = len(text)
        text += line.text
        for start, end in _inline_spans(line, evidence):
            ranges.append([cursor + start, cursor + end])
            boxes.append([round(v, 2) for v in _box([c for c in line.chars if start <= c.offset < end])])
    return Region(kind="block", lines=lines, bbox=_box(lines), text=text,
                  meta={"inline_math": ranges, "inline_boxes": boxes})


def classify_page(page) -> list[Region]:
    """The page's code blocks (C18.4), display math regions and the rest of its blocks, in reading order."""
    upright = [n for n in page.lines if n.upright]
    if not upright:
        return [Region(kind="block", lines=b.lines, bbox=[b.x0, b.top, b.x1, b.bottom],
                       text="\n".join(n.text for n in b.lines), meta={"inline_math": [], "inline_boxes": []})
                for b in page.blocks]
    regions = []
    for ids in code.code_groups(upright):  # code first: its lines are neither math nor prose
        lines = [upright[i] for i in ids]
        text, meta = code.rebuild(lines)
        meta["language_guess"] = code.guess_language(text)
        regions.append(Region(kind="code", lines=sorted(lines, key=lambda n: (n.top, n.x0)), bbox=_box(lines),
                              text=text, meta=meta))
    in_code = {id(n) for r in regions for n in r.lines}
    upright = [n for n in upright if id(n) not in in_code]
    evidences = {id(n): _evidence(n) for n in page.lines}
    column = _column(upright) if upright else (0.0, page.width)
    groups = _display_groups(upright, [evidences[id(n)] for n in upright], column)
    in_math = {id(upright[i]) for g in groups for i in g["ids"]} | in_code
    for group in groups:
        lines = sorted((upright[i] for i in group["ids"]), key=lambda n: (n.top, n.x0))
        meta = {"display": True, "clues": sorted(group["clues"])}
        if group.get("number"):
            meta["equation_number"] = group["number"]
        regions.append(Region(kind="math", lines=lines, bbox=_box(lines), text="\n".join(n.text for n in lines),
                              meta=meta))
    for block in page.blocks:  # the rest, split where code and display math were taken out
        run = []
        for line in block.lines + [None]:
            if line is not None and id(line) not in in_math:
                run.append(line)
                continue
            if run:
                regions.append(_block_region(run, [evidences[id(n)] for n in run]))
            run = []
    regions.sort(key=lambda r: (r.bbox[1], r.bbox[0]))
    return regions
