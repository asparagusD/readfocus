"""Measure pdfplumber's memory and speed on the technical test shelf (C18.2).

In one fresh process: RSS before anything is imported, after importing
backend.regions.extract (pdfplumber, pdfminer.six, pypdfium2), then for each
shelf PDF the seconds per page and the peak RSS while reading pages with
extract.iter_pages (file opened once, each page closed after use, as the
regions job does). Reads only local files; touches no database.

Run from the repo root with the virtualenv active:

    python scripts/dev/measure_regions.py [--pages 40 | --all [--batch 20]] [--shelf samples/technical]

--pages N reads N pages spread evenly through each book, opening the file
for each; --all reads every page in order, opening the file once, or once
per --batch pages as the regions job does.
"""

import argparse
import os
import sys
import time
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[2]
MB = 1024 * 1024
PROCESS = psutil.Process(os.getpid())


def rss() -> float:
    return PROCESS.memory_info().rss / MB


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pages", type=int, default=40)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--batch", type=int, default=0, help="with --all: reopen the file every N pages")
    parser.add_argument("--shelf", default=str(ROOT / "samples" / "technical"))
    args = parser.parse_args()
    before = rss()
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from backend.regions import extract  # imported here so its memory is measured
    after = rss()
    print(f"import: before {before:.1f} MB, after {after:.1f} MB, delta {after - before:.1f} MB")
    peak_all = after
    for path in sorted(Path(args.shelf).glob("*.pdf")):
        data = path.read_bytes()
        total = extract.page_count(data)
        wanted = list(range(1, total + 1)) if args.all else sorted(
            {1 + i * (total - 1) // max(1, args.pages - 1) for i in range(min(args.pages, total))})
        peak, lines, started = rss(), 0, time.perf_counter()
        for page_no in wanted:
            for page in extract.iter_pages(data, page_no, page_no) if not args.all else ():
                lines += len(page.lines)
                peak = max(peak, rss())
        if args.all:
            step = args.batch or total
            for first in range(1, total + 1, step):
                for page in extract.iter_pages(data, first, first + step - 1):
                    lines += len(page.lines)
                    peak = max(peak, rss())
        seconds = time.perf_counter() - started
        peak_all = max(peak_all, peak)
        print(f"{path.name}: {len(wanted)} of {total} pages, {seconds / len(wanted):.3f} s/page, "
              f"{lines} lines, peak RSS {peak:.1f} MB, after {rss():.1f} MB")
        del data
    print(f"peak RSS over the run {peak_all:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
