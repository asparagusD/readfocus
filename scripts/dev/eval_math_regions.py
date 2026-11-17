"""Precision and recall of math detection on the hand-labelled shelf pages (C18.3).

Reads backend/tests/fixtures/math_labels.json (built by build_math_labels.py),
classifies each page with backend.regions.classify, and matches predictions
to labels one to one, best overlap first: a pair is a hit when their boxes'
intersection over union is at least the threshold. Display regions and
inline spans are scored separately. Needs the shelf. Run from the repo root
with the virtualenv active:

    python scripts/dev/eval_math_regions.py [--iou 0.6] [--pages]
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.regions import classify, extract, policy

LABELS = ROOT / "backend" / "tests" / "fixtures" / "math_labels.json"
SHELF = ROOT / "samples" / "technical"


def predictions(regions) -> dict:
    """{"display": [bbox], "inline": [bbox]} from classified regions."""
    found = {"display": [], "inline": []}
    for region in regions:
        if region.kind == "math":
            found["display"].append(region.bbox)
        found["inline"] += region.meta.get("inline_boxes", [])
    return found


def match(predicted: list, labelled: list, threshold: float) -> int:
    """Hits in a one-to-one matching, best overlap first."""
    pairs = sorted(((classify.iou(p, t), i, j) for i, p in enumerate(predicted) for j, t in enumerate(labelled)),
                   reverse=True)
    used_p, used_t, hits = set(), set(), 0
    for score, i, j in pairs:
        if score < threshold:
            break
        if i not in used_p and j not in used_t:
            used_p.add(i)
            used_t.add(j)
            hits += 1
    return hits


def evaluate(pages: list, shelf: Path, threshold: float, per_page: list | None = None) -> dict:
    totals = {kind: {"hits": 0, "predicted": 0, "labelled": 0} for kind in ("display", "inline")}
    for page in pages:
        found = predictions(classify.classify_page(extract.page_chars(shelf / page["book"], page["page"])))
        row = {"book": page["book"], "page": page["page"]}
        for kind, total in totals.items():
            labelled = [r["bbox"] for r in page["regions"] if r["kind"] == kind]
            hits = match(found[kind], labelled, threshold)
            total["hits"] += hits
            total["predicted"] += len(found[kind])
            total["labelled"] += len(labelled)
            row[kind] = (hits, len(found[kind]), len(labelled))
        if per_page is not None:
            per_page.append(row)
    for total in totals.values():
        total["precision"] = total["hits"] / total["predicted"] if total["predicted"] else 1.0
        total["recall"] = total["hits"] / total["labelled"] if total["labelled"] else 1.0
    return totals


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--iou", type=float, default=policy.MATH_MATCH_IOU)
    parser.add_argument("--pages", action="store_true", help="also print each page's hits/predicted/labelled")
    args = parser.parse_args()
    rows = []
    totals = evaluate(json.loads(LABELS.read_text(encoding="utf-8"))["pages"], SHELF, args.iou, rows)
    if args.pages:
        for row in rows:
            print(f"{row['book']:38} p{row['page']:<4} display {row['display']}  inline {row['inline']}")
    for kind, t in totals.items():
        print(f"{kind}: precision {t['precision']:.2f} ({t['hits']}/{t['predicted']}), "
              f"recall {t['recall']:.2f} ({t['hits']}/{t['labelled']}) at IoU >= {args.iou}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
