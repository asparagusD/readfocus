// A real PDF over 50 MB for C26.7's e2e: `pages` pages of text (Helvetica, one line each) and one unused stream
// of `padBytes` spaces that makes it big. pdf.js reads objects lazily through the cross-reference table, so the
// padding is never parsed. Built in memory: nothing is written to disk.

/** The text on page `n` (1-based), as the e2e expects to receive it. */
export const bigPdfLine = (n) => `Page ${n}: the lamp threw a small circle of light.`;

export function bigPdf({ pages = 12, padBytes = 60 * 1024 * 1024 } = {}) {
  const parts = [];
  const offsets = [];
  let size = 0;
  const push = (chunk) => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk;
    parts.push(buffer);
    size += buffer.length;
  };
  const object = (id, body) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    for (const piece of [].concat(body)) push(piece);
    push('\nendobj\n');
  };
  const firstPage = 5;
  const kids = Array.from({ length: pages }, (_, i) => `${firstPage + 2 * i} 0 R`).join(' ');
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R /RFPadding 4 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  object(4, [`<< /Length ${padBytes} >>\nstream\n`, Buffer.alloc(padBytes, 0x20), '\nendstream']);
  for (let n = 1; n <= pages; n += 1) {
    const id = firstPage + 2 * (n - 1);
    const content = `BT /F1 12 Tf 72 720 Td (${bigPdfLine(n)}) Tj ET`;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
  }
  const count = firstPage + 2 * pages;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
