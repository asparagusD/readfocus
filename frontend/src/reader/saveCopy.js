/**
 * Save a copy with my marks (C40.4, issue 24, D2): a copy of the book's PDF with the reader's highlights, underlines
 * and comments written in as real PDF annotations, made in the browser with pdf-lib (loaded only when a copy is
 * made). Each annotation carries its own appearance stream, so every viewer draws and prints it as ReadFocus does.
 *
 * Our marks are in PDF points from the page's top-left as PDF.js shows it (ANCHORS A1: its viewport at scale 1, the
 * crop box turned by the page's /Rotate); `userMatrix` inverts that viewport, so a mark lands where it was drawn on
 * a turned page too.
 */
export class EncryptedPdfError extends Error {
  constructor() { super('This PDF is encrypted, so a copy with marks cannot be written.'); this.name = 'EncryptedPdfError'; }
}

/**
 * The matrix [a, b, c, d, e, f] taking viewport points (vx, vy) to PDF user space: x = a*vx + c*vy + e,
 * y = b*vx + d*vy + f, for a crop box [x0, y0, x1, y1] turned by `rotate` (0, 90, 180 or 270), as PDF.js's
 * PageViewport lays it out.
 */
export function userMatrix([x0, y0, x1, y1], rotate = 0) {
  switch (((rotate % 360) + 360) % 360) {
    case 90: return [0, 1, 1, 0, x0, y0];
    case 180: return [-1, 0, 0, 1, x1, y0];
    case 270: return [0, -1, -1, 0, x1, y1];
    default: return [1, 0, 0, -1, x0, y1];
  }
}
export const toUser = ([a, b, c, d, e, f], [vx, vy]) => [a * vx + c * vy + e, b * vx + d * vy + f];

/** A quad [x0, top, x1, bottom] (viewport) as PDF QuadPoints: top-left, top-right, bottom-left, bottom-right. */
export function quadPoints(m, [x0, top, x1, bottom]) {
  return [[x0, top], [x1, top], [x0, bottom], [x1, bottom]].flatMap((p) => toUser(m, p));
}

/** The user-space rectangle [llx, lly, urx, ury] around viewport points, grown by `pad`. */
export function rectAround(m, points, pad = 0) {
  const user = points.map((p) => toUser(m, p));
  const xs = user.map(([x]) => x);
  const ys = user.map(([, y]) => y);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** "#f4e2a8" or "rgb(244 226 168)" as pdf-lib's 0-1 components; mid grey for anything else. */
export function rgbOf(colour) {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(colour ?? '').trim());
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(String(colour ?? '').trim());
  if (fn) return [fn[1], fn[2], fn[3]].map((n) => Math.min(255, Number(n)) / 255);
  return [0.5, 0.5, 0.5];
}

/** The PDF anchors of the annotations, page by page: [{ annotation, anchor, first }] (`first`: carries the comment). */
export function pdfMarks(annotations, pageCount) {
  return (annotations ?? []).flatMap((annotation) => (annotation.anchors ?? [])
    .filter((a) => a?.kind === 'pdf' && a.page >= 1 && a.page <= pageCount && a.quads?.length)
    .map((anchor, i) => ({ annotation, anchor, first: i === 0 })));
}

/**
 * A copy of `bytes` (the book's PDF) with `annotations` (ANCHORS A1 rows: style, color, anchors, comment) written in.
 * `colours` resolves our colour names: { highlight(name), underline(name) } give CSS colours (Paper's: a published
 * page is light). Throws EncryptedPdfError for an encrypted file. Returns the new file's bytes.
 */
export async function markedCopy(bytes, { annotations = [], colours, now = new Date() } = {}) {
  const lib = await import('pdf-lib');
  const { PDFDocument, PDFName, PDFHexString, PDFString } = lib;
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error?.name === 'EncryptedPDFError' || /encrypt/i.test(error?.message ?? '')) throw new EncryptedPdfError();
    throw error;
  }
  const { context } = pdf;
  const pages = pdf.getPages();
  const multiply = context.obj({ Type: 'ExtGState', BM: 'Multiply' });
  const text = (s) => PDFHexString.fromText(s);

  for (const { annotation, anchor, first } of pdfMarks(annotations, pages.length)) {
    const page = pages[anchor.page - 1];
    const box = page.getCropBox();
    const m = userMatrix([box.x, box.y, box.x + box.width, box.y + box.height], page.getRotation().angle);
    const underline = annotation.style === 'underline';
    const colour = rgbOf(underline ? colours.underline(annotation.color) : colours.highlight(annotation.color));
    const corners = anchor.quads.flatMap(([x0, top, x1, bottom]) => [[x0, top], [x1, bottom]]);
    const rect = rectAround(m, corners, 1);
    const ops = [lib.pushGraphicsState()];
    if (!underline) ops.push(lib.setGraphicsState('GS0'));
    ops.push(lib.concatTransformationMatrix(...m), lib.setFillingRgbColor(...colour));
    for (const [x0, top, x1, bottom] of anchor.quads) { // a highlight fills each line; an underline rules under it
      const thick = Math.max(0.75, (bottom - top) * 0.08);
      ops.push(underline ? lib.rectangle(x0, bottom - thick, x1 - x0, thick) : lib.rectangle(x0, top, x1 - x0, bottom - top), lib.fill());
    }
    ops.push(lib.popGraphicsState());
    const appearance = context.register(context.formXObject(ops, {
      BBox: rect, Resources: underline ? {} : { ExtGState: { GS0: multiply } },
    }));
    const comment = first ? annotation.comment : null;
    const dict = context.obj({
      Type: 'Annot', Subtype: underline ? 'Underline' : 'Highlight', Rect: rect,
      QuadPoints: anchor.quads.flatMap((q) => quadPoints(m, q)), C: colour, F: 4,
      T: text('ReadFocus'), NM: text(`readfocus-${annotation.id ?? ''}-${anchor.page}`),
      M: PDFString.fromDate(new Date(annotation.updated_at ?? annotation.created_at ?? now)),
      AP: { N: appearance },
    });
    if (comment) dict.set(PDFName.of('Contents'), text(comment));
    const ref = context.register(dict);
    if (comment) { // Acrobat opens a comment in its popup; Edge reads Contents
      const [, , urx, ury] = rect;
      const popup = context.register(context.obj({
        Type: 'Annot', Subtype: 'Popup', Rect: [urx, ury - 96, urx + 192, ury], Parent: ref, Open: false, F: 28,
      }));
      dict.set(PDFName.of('Popup'), popup);
      page.node.addAnnot(ref);
      page.node.addAnnot(popup);
    } else page.node.addAnnot(ref);
  }
  return pdf.save();
}
