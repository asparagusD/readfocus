"""Write backend/tests/fixtures/code_sample.pdf, the C18.4 code fixture.

A one-page PDF drawn with pdfium's standard fonts (Times-Roman for prose,
Courier for code, nothing embedded): a paragraph, a Python function (nested
indentation, a blank line, spaces lined up before a comment), a sentence,
then a C program with a right-aligned line-number gutter and a numbered
blank line, then a closing sentence. The code is ours, written for the
test. The tests rebuild both listings from the PDF and compare them with
PYTHON and C below, character for character.

Run from the repo root with the virtualenv active:

    python scripts/dev/make_code_fixture.py
"""

import ctypes
from pathlib import Path

import pypdfium2 as pdfium
from pypdfium2 import raw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "backend" / "tests" / "fixtures" / "code_sample.pdf"

PYTHON = '''def fib(n):
    """Return the n-th Fibonacci number."""
    if n < 2:
        return n

    a, b = 0, 1
    for _ in range(n - 1):
        a, b = b, a + b    # step
    return b'''

C = '''#include <stdio.h>

int main(void) {
    for (int i = 0; i < 3; i++) {
        printf("%d\\n", i);
    }
    return 0;
}'''

PROSE_BEFORE = ["The function below computes Fibonacci numbers one step at a time,",
                "keeping only the last two values instead of the whole sequence."]
PROSE_BETWEEN = ["The same loop in C, printed with the line numbers of the listing:"]
PROSE_AFTER = ["Both listings keep their indentation exactly as they were written."]

LEFT, TOP, WIDTH, HEIGHT = 72.0, 72.0, 612.0, 792.0
PROSE_SIZE, CODE_SIZE = 11.0, 9.0
PROSE_LEADING, CODE_LEADING = 14.0, 11.0
COURIER_ADVANCE = 0.6  # Courier's advance is 600/1000 em


def text_object(doc, font, size, text, x, y_top):
    obj = raw.FPDFPageObj_CreateTextObj(doc, font, ctypes.c_float(size))
    encoded = (text + "\x00").encode("utf-16-le")
    buffer = ctypes.create_string_buffer(encoded, len(encoded))
    raw.FPDFText_SetText(obj, ctypes.cast(buffer, ctypes.POINTER(raw.FPDF_WCHAR)))
    baseline = HEIGHT - y_top - size * 0.8  # PDF space grows upwards
    raw.FPDFPageObj_Transform(obj, 1, 0, 0, 1, x, baseline)
    return obj


def build() -> None:
    pdf = pdfium.PdfDocument.new()
    page = pdf.new_page(WIDTH, HEIGHT)
    times = raw.FPDFText_LoadStandardFont(pdf.raw, b"Times-Roman")
    courier = raw.FPDFText_LoadStandardFont(pdf.raw, b"Courier")
    y = TOP

    def prose(lines):
        nonlocal y
        for line in lines:
            raw.FPDFPage_InsertObject(page.raw, text_object(pdf.raw, times, PROSE_SIZE, line, LEFT, y))
            y += PROSE_LEADING
        y += 8

    def code(listing, x, gutter=False):
        nonlocal y
        char = COURIER_ADVANCE * CODE_SIZE
        for number, line in enumerate(listing.split("\n"), start=1):
            if gutter:
                label = f"{number:>2}"
                raw.FPDFPage_InsertObject(page.raw, text_object(pdf.raw, courier, CODE_SIZE, label, x, y))
            if line.strip():
                indent = len(line) - len(line.lstrip(" "))
                start = x + (4 * char if gutter else 0) + indent * char
                raw.FPDFPage_InsertObject(page.raw, text_object(pdf.raw, courier, CODE_SIZE, line.lstrip(" "), start, y))
            y += CODE_LEADING
        y += 10

    prose(PROSE_BEFORE)
    code(PYTHON, LEFT + 18)
    prose(PROSE_BETWEEN)
    code(C, LEFT + 18, gutter=True)
    prose(PROSE_AFTER)
    page.gen_content()
    pdf.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
