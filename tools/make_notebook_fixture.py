"""Write backend/tests/fixtures/sources/sample.ipynb, the notebook fixture for C19.2b.

Run from the repo root: python tools/make_notebook_fixture.py

An nbformat 4 notebook written here, byte for byte (no Jupyter, no matplotlib
installed): markdown cells with inline and display math, a table and an
attachment image; code cells with a stream, a plot shown the way matplotlib's
inline backend stores it (image/png plus a "<Figure ...>" text/plain), an
SVG result, a traceback with ANSI colours, a table result with text/html and
text/plain, and a cell never run. The PNGs are generated gradients, not real
plots. Deterministic: a re-run changes nothing.
"""

import base64
import json
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "backend" / "tests" / "fixtures" / "sources" / "sample.ipynb"


def png(w, h):
    def chunk(k, d): return struct.pack(">I", len(d)) + k + d + struct.pack(">I", zlib.crc32(k + d))
    rows = b"".join(b"\x00" + b"".join(bytes((min(255, x * 4), 90, max(0, 255 - y * 5))) for x in range(w)) for y in range(h))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")
b64 = lambda b: base64.b64encode(b).decode()
svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60" viewBox="0 0 160 60">\n',
       ' <rect width="160" height="60" fill="#e8dcc4"/>\n', ' <circle cx="30" cy="30" r="20" fill="#5a3e2b"/>\n', '</svg>']
md = lambda src, **extra: {"cell_type": "markdown", "metadata": {}, "source": src, **extra}
code = lambda n, src, outputs: {"cell_type": "code", "execution_count": n, "metadata": {}, "source": src, "outputs": outputs}
nb = {"nbformat": 4, "nbformat_minor": 5,
      "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                   "language_info": {"name": "python", "version": "3.11.9"}},
      "cells": [
    md(["# Fourier basics\n", "\n", "The transform $\\hat{x}(f)$ splits a signal into frequencies.\n", "\n",
        "![A sketch of a wave](attachment:wave.png)\n"], attachments={"wave.png": {"image/png": b64(png(20, 10))}}),
    code(1, ["import numpy as np\n", "\n", "x = np.linspace(0, 1, 5)\n", "print(x)"],
         [{"output_type": "stream", "name": "stdout", "text": ["[0.   0.25 0.5  0.75 1.  ]\n"]}]),
    code(2, ["import matplotlib.pyplot as plt\n", "\n", "plt.plot(x, x ** 2)\n", "plt.show()"],
         [{"output_type": "display_data", "metadata": {},
           "data": {"image/png": b64(png(64, 48)) + "\n", "text/plain": ["<Figure size 640x480 with 1 Axes>"]}}]),
    md(["## A table and a formula\n", "\n", "| f | power |\n", "|---|---|\n", "| 1 | 0.5 |\n", "| 2 | 0.25 |\n", "\n",
        "$$\n", "E = \\sum_n |x_n|^2\n", "$$\n"]),
    code(3, ["from IPython.display import SVG\n", "\n", "SVG(filename='mark.svg')"],
         [{"output_type": "execute_result", "execution_count": 3, "metadata": {},
           "data": {"image/svg+xml": svg, "text/plain": ["<IPython.core.display.SVG object>"]}}]),
    code(4, ["1 / 0"],
         [{"output_type": "error", "ename": "ZeroDivisionError", "evalue": "division by zero",
           "traceback": ["\u001b[0;31m---------------------------------------------------------------------------\u001b[0m",
                         "\u001b[0;31mZeroDivisionError\u001b[0m                         Traceback (most recent call last)",
                         "\u001b[0;31mZeroDivisionError\u001b[0m: division by zero"]}]),
    md(["# Results\n", "\n", "The table below came from pandas.\n"]),
    code(5, ["{'a': [1, 3], 'b': [2, 4]}"], [{"output_type": "execute_result", "execution_count": 5, "metadata": {},
                      "data": {"text/html": ["<table><tr><td>1</td></tr></table>"],
                               "text/plain": ["   a  b\n", "0  1  2\n", "1  3  4"]}}]),
    code(None, ["# not run yet"], []),
]}
OUT.write_text(json.dumps(nb, indent=1) + "\n", encoding="utf-8", newline="\n")
