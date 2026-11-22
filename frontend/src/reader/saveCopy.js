/**
 * Save a copy with my marks (C40.4, issue 24, D2): a copy of the book's PDF with the reader's highlights, underlines,
 * comments, ink and text boxes written in as real PDF annotations, made in the browser with pdf-lib (loaded only when a copy is
 * made). Each annotation carries its own appearance stream, so every viewer draws and prints it as ReadFocus does.
 *
 * Our marks are in PDF points from the page's top-left as PDF.js shows it (ANCHORS A1: its viewport at scale 1, the
 * crop box turned by the page's /Rotate); `userMatrix` inverts that viewport, so a mark lands where it was drawn on
 * a turned page too.
 */
import { strokePath } from '../annotations/ink.js';

const LINE = 1.25; // a text box's line height, as .rf-textbox's

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

/**
 * C40.8: the colours the marks use as plain tables { highlight, underline, mark } (name -> CSS colour), resolved on the
 * page through `colours` (it reads CSS tokens) for the worker, which has no CSS.
 */
export function colourTables(colours, annotations, marks) {
  const table = (names, of) => Object.fromEntries([...new Set(names)].map((name) => [name, of(name)]));
  const used = (annotations ?? []).map((a) => a.color).filter(Boolean);
  return {
    highlight: table(used, colours.highlight),
    underline: table(used, colours.underline),
    mark: table((marks ?? []).map((m) => m.color).filter(Boolean), colours.mark),
  };
}

/** The PDF anchors of the annotations, page by page: [{ annotation, anchor, first }] (`first`: carries the comment). */
export function pdfMarks(annotations, pageCount) {
  return (annotations ?? []).flatMap((annotation) => (annotation.anchors ?? [])
    .filter((a) => a?.kind === 'pdf' && a.page >= 1 && a.page <= pageCount && a.quads?.length)
    .map((anchor, i) => ({ annotation, anchor, first: i === 0 })));
}

/**
 * A text box's lines (ANCHORS A12: `width` and `size` in points), wrapped as the reader saw it: its own line breaks,
 * then words, a word too long for the box broken anywhere; `measure(text)` gives a run's width at the box's size.
 */
export function wrapLines(text, width, measure) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/(?<=\s)/)) { // each word keeps its trailing space
      if (measure(line + word.trimEnd()) <= width || !line) line += word;
      else { lines.push(line.trimEnd()); line = word; }
      while (measure(line.trimEnd()) > width && line.length > 1) { // a word wider than the box
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > width) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Page marks (ANCHORS A12) on pages the book has, with something to draw. */
export const drawnMarks = (marks, pageCount) => (marks ?? []).filter((m) => m?.page >= 1 && m.page <= pageCount
  && ((m.kind === 'ink' && m.data?.points?.length) || (m.kind === 'text' && String(m.data?.text ?? '').trim())));

/**
 * A copy of `bytes` (the book's PDF) with `annotations` (ANCHORS A1 rows: style, color, anchors, comment) written in.
 * `colours` resolves our colour names: { highlight(name), underline(name), mark(name) } give CSS colours (Paper's: a
 * published page is light). `marks` (C40.4b) are the page marks: ink strokes as Ink annotations drawn as the reader
 * drew them (a filled outline, pressure and all), text boxes as FreeText in Helvetica. Throws EncryptedPdfError for an encrypted file. Returns the new file's bytes.
 */
export async function markedCopy(bytes, { annotations = [], marks = [], colours, now = new Date() } = {}) {
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
  const matrixOf = (page) => {
    const box = page.getCropBox();
    return userMatrix([box.x, box.y, box.x + box.width, box.y + box.height], page.getRotation().angle);
  };
  const flipped = ([a, b, c, d, e, f]) => [a, b, -c, -d, e, f]; // viewport drawing with y up: upright text, SVG paths
  const dated = (row) => PDFString.fromDate(new Date(row.updated_at ?? row.created_at ?? now));

  for (const { annotation, anchor, first } of pdfMarks(annotations, pages.length)) {
    const page = pages[anchor.page - 1];
    const m = matrixOf(page);
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
      M: dated(annotation),
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

  let font = null; // Helvetica, embedded once a text box needs it
  for (const mark of drawnMarks(marks, pages.length)) {
    const page = pages[mark.page - 1];
    const m = matrixOf(page);
    const colour = rgbOf(colours.mark(mark.color));
    const common = { Type: 'Annot', F: 4, T: text('ReadFocus'), NM: text(`readfocus-${mark.id ?? ''}`), M: dated(mark), C: colour };
    if (mark.kind === 'ink') {
      const { points, width } = mark.data;
      const rect = rectAround(m, points.map(([x, y]) => [x, y]), width);
      const ops = [lib.pushGraphicsState(), lib.concatTransformationMatrix(...flipped(m)),
        ...lib.drawSvgPath(strokePath(mark.data), { x: 0, y: 0, color: lib.rgb(...colour) }), lib.popGraphicsState()];
      const appearance = context.register(context.formXObject(ops, { BBox: rect }));
      page.node.addAnnot(context.register(context.obj({
        ...common, Subtype: 'Ink', Rect: rect, BS: { W: width },
        InkList: [points.flatMap(([x, y]) => toUser(m, [x, y]))], AP: { N: appearance },
      })));
    } else {
      font ??= await pdf.embedFont(lib.StandardFonts.Helvetica);
      const { x, y, width, size } = mark.data;
      const known = new Set(font.getCharacterSet());
      const drawable = [...String(mark.data.text)].map((ch) => (ch === '\n' || known.has(ch.codePointAt(0)) ? ch : '?')).join('');
      const lines = wrapLines(drawable, width, (run) => font.widthOfTextAtSize(run, size));
      const rect = rectAround(m, [[x, y], [x + width, y + lines.length * size * LINE]], 1);
      const ops = [lib.pushGraphicsState(), lib.concatTransformationMatrix(...flipped(m)), lib.setFillingRgbColor(...colour)];
      lines.forEach((line, i) => {
        if (!line) return;
        ops.push(lib.beginText(), lib.setFontAndSize('Helv', size), lib.moveText(x, -(y + i * size * LINE + size)),
          lib.showText(font.encodeText(line)), lib.endText());
      });
      ops.push(lib.popGraphicsState());
      const appearance = context.register(context.formXObject(ops, { BBox: rect, Resources: { Font: { Helv: font.ref } } }));
      page.node.addAnnot(context.register(context.obj({
        ...common, Subtype: 'FreeText', Rect: rect, Contents: text(mark.data.text), BS: { W: 0 },
        DA: PDFString.of(`/Helv ${size} Tf ${colour.map((n) => n.toFixed(3)).join(' ')} rg`), AP: { N: appearance },
      })));
    }
  }
  return pdf.save();
}
