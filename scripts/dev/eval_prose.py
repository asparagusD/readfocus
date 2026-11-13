"""How well prose-only text lines up with the region map on the technical shelf (C18.6).

For pages spread through each shelf PDF: regions from backend.regions (as the
regions job stores them), pypdf's page text (as ingestion reads it), then
backend.regions.prose.page_spans. Reports, per book:

- prose kept: share of prose-region lines (at least 12 non-space characters)
  whose text is still in the page's prose text;
- non-prose out: share of math, code, figure and table lines (at least 6)
  whose text is no longer in it;
- garbled sentences left in the prose text.

Reads only local files; touches no database. From the repo root:

    python scripts/dev/eval_prose.py [--pages 30] [--shelf samples/technical]
"""

import argparse
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def page_result(text: str, number: int, regions: list[dict]) -> dict:
    from backend.regions import prose

    spans = prose.page_spans(text, number, regions)
    out, _ = prose.apply(text, 0, spans)
    kept_skeleton = prose.skeleton(prose.PLACEHOLDER.sub(" ", out))
    result = {"prose": [0, 0], "other": [0, 0], "garbled": prose.sentence_counts(out)["garbled"]}
    for region in regions:
        lines, start, inline = [], 0, (region["meta"] or {}).get("inline_math") or []
        for line in (region["text"] or "").split("\n"):  # a line that held inline math lost it: not counted
            end = start + len(line)
            if region["kind"] not in prose.PROSE_KINDS or not any(s < end and e > start for s, e in inline):
                lines.append(prose.skeleton(line))
            start = end + 1
        if region["kind"] in prose.PROSE_KINDS:
            for line in (n for n in lines if len(n) >= 12):
                result["prose"][0] += line in kept_skeleton
                result["prose"][1] += 1
        elif region["kind"] in prose.NON_PROSE:
            for line in (n for n in lines if len(n) >= 6):
                result["other"][0] += line not in kept_skeleton
                result["other"][1] += 1
    return result


def main() -> int:
    from pypdf import PdfReader

    from backend.regions import extract
    from backend.services.region_job import block_rows

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pages", type=int, default=30)
    parser.add_argument("--shelf", default=str(ROOT / "samples" / "technical"))
    args = parser.parse_args()
    for path in sorted(Path(args.shelf).glob("*.pdf")):
        data = path.read_bytes()
        reader = PdfReader(io.BytesIO(data))
        total = len(reader.pages)
        numbers = sorted({1 + round(i * (total - 1) / max(args.pages - 1, 1)) for i in range(args.pages)})
        sums = {"prose": [0, 0], "other": [0, 0], "garbled": 0}
        for number in numbers:
            page = extract.page_chars(data, number)
            rows = block_rows({"id": "b", "user_id": "u"}, page)
            text = (reader.pages[number - 1].extract_text() or "").replace("\x00", "")
            result = page_result(text, number, rows)
            for key in ("prose", "other"):
                sums[key] = [a + b for a, b in zip(sums[key], result[key])]
            sums["garbled"] += result["garbled"]
        share = {key: (sums[key][0] / sums[key][1] if sums[key][1] else 1.0) for key in ("prose", "other")}
        print(f"{path.name}: {len(numbers)} pages; prose kept {share['prose']:.3f} ({sums['prose'][0]}/{sums['prose'][1]}), "
              f"non-prose out {share['other']:.3f} ({sums['other'][0]}/{sums['other'][1]}), "
              f"garbled sentences left {sums['garbled']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
