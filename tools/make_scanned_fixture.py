"""Write frontend/e2e/fixtures/books/scanned.pdf, a scanned book for the OCR e2e (C19.4).

Run from the repo root with the virtualenv: python tools/make_scanned_fixture.py

Pages 3 and 4 of sample.pdf (tools/make_reader_fixtures.py: "Chapter 1 Signals", lines about a
lamp) drawn with pypdfium2 at 150 dpi into greyscale pictures, each page of the new PDF holding
only its picture: no text layer, as a scanner makes. Deterministic: a re-run changes nothing.
"""

import zlib
from pathlib import Path

import pypdfium2

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "frontend" / "e2e" / "fixtures" / "books"
DPI = 150


def scans() -> list[tuple[int, int, bytes, float, float]]:
    """(pixel width, pixel height, grey pixels, page width pt, page height pt) for pages 3 and 4."""
    doc = pypdfium2.PdfDocument(str(BOOKS / "sample.pdf"))
    out = []
    for index in (2, 3):
        page = doc[index]
        width, height = page.get_size()
        bitmap = page.render(scale=DPI / 72, grayscale=True)
        pixels = bitmap.to_numpy()
        out.append((pixels.shape[1], pixels.shape[0], pixels.astype("uint8").tobytes(), width, height))
    return out


def pdf(pages) -> bytes:
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", None]
    kids = []
    for px_w, px_h, grey, width, height in pages:
        image = zlib.compress(grey, 9)
        first = len(objects) + 1  # image, contents, page
        objects.append(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray "
                       b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % (px_w, px_h, len(image))
                       + image + b"\nendstream")
        draw = b"q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q" % (width, height)
        objects.append(b"<< /Length %d >>\nstream\n" % len(draw) + draw + b"\nendstream")
        objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Contents %d 0 R "
                       b"/Resources << /XObject << /Im0 %d 0 R >> >> >>" % (width, height, first + 1, first))
        kids.append(first + 2)
    objects[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


if __name__ == "__main__":
    target = BOOKS / "scanned.pdf"
    target.write_bytes(pdf(scans()))
    print(f"{target.relative_to(ROOT)}: {target.stat().st_size} bytes")
