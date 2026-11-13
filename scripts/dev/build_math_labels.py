"""Build backend/tests/fixtures/math_labels.json from the hand labels below (C18.3).

The labels were made by reading each page (rendered, with its extracted
lines numbered) and deciding which lines are display math and which
stretches of a prose line are inline math. Rules:

- Display math: a run of display material (equations, matrices, systems,
  their brackets, limits and row-operation arrows) not interrupted by a
  line of prose; one region per run. A right-margin equation number
  belongs to its display.
- Inline math: an expression in a prose line with an operator or relation,
  a sub- or superscript, a function application or a math symbol. A bare
  single-letter variable is not labelled (it reads as a word). Figure
  labels and code are not math.

Boxes come from the extracted lines (display: their union; inline: the
characters of the labelled stretch), in points from the crop box's
top-left. Needs the shelf (scripts/fetch_test_shelf.py). Run from the repo
root with the virtualenv active:

    python scripts/dev/build_math_labels.py
"""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.regions import extract

SHELF = ROOT / "samples" / "technical"
OUT = ROOT / "backend" / "tests" / "fixtures" / "math_labels.json"
ILA, LEC = "interactive-linear-algebra.pdf", "lessons-in-electric-circuits-dc.pdf"

# (book, page): {"display": [[line ids], ...] or ([ids], equation number), "inline": {line: [stretch, ...]}}
LABELS = {
    ("sicp.pdf", 50): {"display": [[12]], "inline": {}},
    ("sicp.pdf", 76): {"display": [[1], [24, 25]], "inline": {
        21: ["Fib(n + 1)"], 22: ["Fib(n)", "pn"], 23: ["Fib(n)", "ϕn= 5"]}},
    ("sicp.pdf", 92): {"display": [], "inline": {
        9: ["n (cid:21) Fib(k) (cid:25) ϕk = 5"], 10: ["ϕ"], 11: ["Θ(log n)"],
        14: ["(ak ; bk )", "ak (cid:21) bk"], 15: ["(ak +1; bk +1) ! (ak ; bk ) !"],
        16: ["(ak (cid:0)1; bk (cid:0)1)"], 17: ["bk +1 (cid:21) bk + bk (cid:0)1"],
        18: ["ak (cid:0)1 = bk ; bk (cid:0)1 =", "ak", "bk"], 19: ["ak = qbk + bk (cid:0)1"],
        20: ["ak = qbk + bk (cid:0)1 (cid:21) bk + bk (cid:0)1"],
        21: ["bk +1 = ak", "bk +1 = ak (cid:21) bk +bk (cid:0)1"], 23: ["k = 1"], 24: ["Fib(1) = 1"],
        25: ["k + 1", "(ak +1; bk +1) ! (ak ; bk ) ! (ak (cid:0)1; bk (cid:0)1)"],
        27: ["bk (cid:0)1 (cid:21) Fib(k (cid:0) 1)", "bk (cid:21) Fib(k)"],
        28: ["bk +1 (cid:21) bk + bk (cid:0)1 (cid:21) Fib(k) + Fib(k (cid:0)"], 29: ["1) = Fib(k + 1)"]}},
    ("sicp.pdf", 121): {"display": [], "inline": {
        8: ["y2 = x", "y = x=y"], 10: ["y 7! x=y"], 15: ["y1", "y2 = x=y1", "y3 ="], 16: ["x=y2 = x=(x=y1) = y1"],
        17: ["y1", "y2"], 20: ["x=y", "x=y"], 21: ["x=y", "12 (y + x=y)"], 22: ["x=y"], 23: ["y 7! 12 (y + x=y)"],
        27: ["7!", "y 7! x=y"], 28: ["x=y"]}},
    (ILA, 30): {"display": [list(range(8, 14)), list(range(16, 22)), list(range(23, 28)), list(range(30, 51))],
                "inline": {}},
    (ILA, 31): {"display": [list(range(8, 13)), list(range(18, 23)), list(range(28, 32)), list(range(36, 40)),
                            list(range(41, 45))], "inline": {
        3: ["10z = 30", "z = 3"], 4: ["y + 2 · 3 = 4", "y = −2"],
        5: ["x + 2 · (−2) + 3 · 3 = 6", "x = 3", "(x, y, z) = (1, −2, 3)"], 6: ["(x, y, z) = (1, −2, 3)"],
        14: ["="], 32: ["R1", "R2", "R3"]}},
    (ILA, 236): {"display": [(list(range(3, 11)), "4.2.1"), list(range(13, 20)), list(range(25, 28)),
                             list(range(29, 38))], "inline": {
        2: ["n × n", "Ci j"], 12: ["adj(A)"], 20: ["(i, j)", "Ci j", "( j, i)"], 21: ["(i, j)"],
        22: ["A · adj(A) = adj(A) · A = det(A)In"], 24: ["A−1"]}},
    (ILA, 287): {"display": [[18]], "inline": {
        15: ["A(cid:48)", "R2"], 16: ["[x]B(cid:48)"],
        19: ["A = C BC−1", "v1 = (cid:0)21(cid:1)", "v2 = 12 (cid:0)−11(cid:1)"], 20: ["B = {v1, v2}", "R2"],
        21: ["90◦"]}},
    (LEC, 85): {"display": [], "inline": {92: ["I=E/R"]}},
    (LEC, 304): {"display": [[14, 15, 16], [20]], "inline": {
        11: ["Rm/Rn", "RM /RN", "Ra"], 12: ["Ra/Rx", "RM /RN"], 13: ["Rx"], 17: ["Rwire"], 18: ["Ra"], 19: ["Rx"],
        21: ["RM", "RN", "Rm", "Rn"], 22: ["Rx/Ra"], 23: ["RN /RM"], 24: ["Rx", "Ra", "RM", "RN"],
        25: ["RM =Rm", "RN =Rn"], 26: ["Rm", "Rn"], 29: ["Rm", "Rn"], 30: ["RM", "RN"], 31: ["Rm", "Rn"],
        32: ["Rm", "Rn", "Ra", "Rx"]}},
}


def union(boxes):
    return [round(min(b[0] for b in boxes), 2), round(min(b[1] for b in boxes), 2),
            round(max(b[2] for b in boxes), 2), round(max(b[3] for b in boxes), 2)]


def stretch_box(line, start, end):
    chars = [c for c in line.chars if start <= c.offset < end]
    assert chars, (line.text, start, end)
    return union([(c.x0, c.top, c.x1, c.bottom) for c in chars])


def build() -> dict:
    pages = []
    for (book, page_no), label in LABELS.items():
        page = extract.page_chars(SHELF / book, page_no)
        regions = []
        for entry in label["display"]:
            ids, number = entry if isinstance(entry, tuple) else (entry, None)
            box = union([(page.lines[i].x0, page.lines[i].top, page.lines[i].x1, page.lines[i].bottom) for i in ids])
            regions.append({"kind": "display", "bbox": box, "equation_number": number, "lines": ids})
        for line_id, stretches in label["inline"].items():
            line, cursor = page.lines[line_id], 0
            for stretch in stretches:
                start = line.text.index(stretch, cursor)
                cursor = start + len(stretch)
                regions.append({"kind": "inline", "bbox": stretch_box(line, start, cursor), "line": line_id})
        digest = hashlib.sha256((SHELF / book).read_bytes()).hexdigest()
        pages.append({"book": book, "sha256": digest, "page": page_no, "regions": regions})
    return {"about": "Hand labels for C18.3; see scripts/dev/build_math_labels.py for the rules.",
            "pages": pages}


if __name__ == "__main__":
    data = build()
    OUT.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    counts = {k: sum(r["kind"] == k for p in data["pages"] for r in p["regions"]) for k in ("display", "inline")}
    print(f"wrote {OUT.relative_to(ROOT)}: {len(data['pages'])} pages, {counts}")
