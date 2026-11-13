"""Gate G5 (C18.G): compare PDF.js page renders with PDFium renders of the same pages.

scripts/dev/g5_render_pages.mjs saves "<book>-p<N>-pdfjs.png" (PDF.js in Edge,
as the original view draws a page); this renders the same page with
pypdfium2 (PDFium, an independent renderer; poppler's pdftoppm is not
installed here) at the same scale, white background, and compares them in
grey levels. Two renderers anti-alias glyph edges differently, so a raw
pixel diff outlines every letter; what counts is ink one render has and the
other lacks: a dark pixel (< INK) in one with no dark pixel within NEAR px
in the other. A lost element (a glyph, a rule, part of a figure) leaves a
connected blob of such ink; anti-aliasing leaves thin scattered pixels, and
a hairline rule drawn a pixel apart leaves a 1-2 px line. Inside raster
images (pdfplumber's image boxes) the two renderers resample to slightly
different greys, so those areas are left out. A page matches when no blob
either way is larger than MAX_BLOB px and at least MIN_SIDE px in both
directions (a full stop is about 3 x 3 px at scale 2), and the sizes agree
within a pixel. Checked by eye as well: the diff images and side-by-side crops.
The raw share past PIXEL_TOLERANCE is printed too. Writes a diff image per
page. Local files only.

    python scripts/dev/g5_page_diff.py <dir> <scale> <book.pdf:page> [...]
"""

import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
PIXEL_TOLERANCE = 64      # grey levels (0-255)
INK = 128                 # darker than this is ink
NEAR = 1                  # px: ink this close in the other render counts as present
MAX_BLOB = 9              # px: the largest connected patch of ink one render may lack
MIN_SIDE = 3              # px: a blob thinner than this either way is a hairline drawn apart


def image_mask(book: str, number: int, scale: float, size: tuple) -> np.ndarray:
    """True inside the page's raster images (pdfplumber boxes, points from the top-left, at `scale`)."""
    import pdfplumber

    mask = np.zeros((size[1], size[0]), dtype=bool)
    with pdfplumber.open(ROOT / "samples" / "technical" / book) as pdf:
        page = pdf.pages[number - 1]
        for image in page.images:
            x0, top, x1, bottom = (round(v * scale) for v in (image["x0"], image["top"], image["x1"], image["bottom"]))
            mask[max(top, 0):bottom, max(x0, 0):x1] = True
    return mask


def missing(a: Image.Image, b: Image.Image, skip: np.ndarray) -> tuple[float, int, tuple]:
    """Share of a's ink with no ink within NEAR px in b, the largest such blob (8-connected) and its place."""
    near = np.asarray(b.filter(ImageFilter.MinFilter(2 * NEAR + 1))) < INK
    ink = np.asarray(a) < INK
    lost = ink & ~near & ~skip
    todo, biggest, box = set(zip(*np.nonzero(lost))), 0, ()
    while todo:  # flood fill, 8-connected
        stack, blob = [todo.pop()], []
        while stack:
            y, x = stack.pop()
            blob.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if (y + dy, x + dx) in todo:
                        todo.remove((y + dy, x + dx))
                        stack.append((y + dy, x + dx))
        ys, xs = [q[0] for q in blob], [q[1] for q in blob]
        if len(blob) > biggest and max(xs) - min(xs) + 1 >= MIN_SIDE and max(ys) - min(ys) + 1 >= MIN_SIDE:
            biggest, box = len(blob), (int(min(xs)), int(min(ys)), int(max(xs)) + 1, int(max(ys)) + 1)
    return float(lost.sum() / max(ink.sum(), 1)), biggest, box


def main() -> int:
    out, scale, specs = Path(sys.argv[1]), float(sys.argv[2]), sys.argv[3:]
    failed = 0
    for spec in specs:
        book, number = spec.split(":")
        stem = f"{Path(book).stem}-p{number}"
        pdf = pdfium.PdfDocument(str(ROOT / "samples" / "technical" / book))
        reference = pdf[int(number) - 1].render(scale=scale, fill_color=(255, 255, 255, 255)).to_pil().convert("L")
        pdfjs = Image.open(out / f"{stem}-pdfjs.png").convert("RGBA")
        white = Image.new("RGBA", pdfjs.size, (255, 255, 255, 255))
        pdfjs = Image.alpha_composite(white, pdfjs).convert("L")
        same_size = abs(reference.width - pdfjs.width) <= 1 and abs(reference.height - pdfjs.height) <= 1
        sizes = (reference.size, pdfjs.size)
        w, h = min(reference.width, pdfjs.width), min(reference.height, pdfjs.height)
        reference, pdfjs = reference.crop((0, 0, w, h)), pdfjs.crop((0, 0, w, h))
        skip = image_mask(book, int(number), scale, (w, h))
        lost, extra = missing(reference, pdfjs, skip), missing(pdfjs, reference, skip)
        a = np.asarray(reference, dtype=np.int16)
        b = np.asarray(pdfjs, dtype=np.int16)
        diff = np.abs(a - b)
        share = float((diff > PIXEL_TOLERANCE).mean())
        ink = float((a < 128).mean())
        Image.fromarray((255 - np.clip(diff * 4, 0, 255)).astype(np.uint8)).save(out / f"{stem}-diff.png")
        reference.save(out / f"{stem}-pdfium.png")
        ok = max(lost[1], extra[1]) <= MAX_BLOB and same_size
        failed += not ok
        print(f"{stem}: {'match' if ok else 'DIFFER'}; size pdfium {sizes[0]} pdfjs {sizes[1]}; "
              f"ink missing from PDF.js {lost[0]:.3%} (largest blob {lost[1]} px at {lost[2]}), "
              f"extra in PDF.js {extra[0]:.3%} (largest {extra[1]} px at {extra[2]}); "
              f"raw pixels past tolerance {share:.3%}; ink {ink:.2%}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
