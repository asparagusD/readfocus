import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { degrees, PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EncryptedPdfError, markedCopy, pdfMarks, quadPoints, rgbOf, toUser, userMatrix } from './saveCopy.js';

const colours = { highlight: (c) => ({ honey: '#f4e2a8', sky: '#d5e2ec' }[c] ?? '#000000'), underline: () => 'rgb(152 129 55)' };
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

async function book({ rotate = 0, crop = null, pages = 2 } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([612, 792]);
    if (crop) page.setCropBox(...crop);
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}
const pdfjsPage = async (bytes, n = 1) => (await getDocument({ data: bytes.slice(), verbosity: 0 }).promise).getPage(n);

test("userMatrix undoes PDF.js's viewport on a cropped page at every rotation", async () => {
  for (const rotate of [0, 90, 180, 270]) {
    const page = await pdfjsPage(await book({ rotate, crop: [10, 20, 500, 700] }));
    const view = page.getViewport({ scale: 1 });
    const m = userMatrix(page.view, page.rotate);
    for (const point of [[0, 0], [37, 120], [view.width, view.height]]) {
      const [ux, uy] = toUser(m, point);
      const [vx, vy] = view.convertToViewportPoint(ux, uy);
      close(vx, point[0]);
      close(vy, point[1]);
    }
  }
});

test('a quad becomes QuadPoints top-left, top-right, bottom-left, bottom-right in user space', () => {
  const m = userMatrix([0, 0, 612, 792], 0);
  assert.deepEqual(quadPoints(m, [72, 100, 172, 112]), [72, 692, 172, 692, 72, 680, 172, 680]);
});

test('colours from hex or rgb(), mid grey for anything else', () => {
  assert.deepEqual(rgbOf('#ff0000'), [1, 0, 0]);
  assert.deepEqual(rgbOf(' rgb(0 51 255) '), [0, 0.2, 1]);
  assert.deepEqual(rgbOf('rgba(255, 255, 0, 0.5)'), [1, 1, 0]);
  assert.deepEqual(rgbOf('var(--x)'), [0.5, 0.5, 0.5]);
});

test('only PDF anchors on pages the book has, with quads; the first carries the comment', () => {
  const marks = pdfMarks([
    { id: 'a', anchors: [{ kind: 'pdf', page: 1, quads: [[0, 0, 1, 1]] }, { kind: 'pdf', page: 2, quads: [[0, 0, 1, 1]] }] },
    { id: 'b', anchors: [{ kind: 'epub', cfi: 'x' }] },
    { id: 'c', anchors: [{ kind: 'pdf', page: 9, quads: [[0, 0, 1, 1]] }, { kind: 'pdf', page: 1, quads: [] }] },
  ], 2);
  assert.deepEqual(marks.map((m) => [m.annotation.id, m.anchor.page, m.first]), [['a', 1, true], ['a', 2, false]]);
});

const highlight = { id: 'h1', style: 'highlight', color: 'honey', comment: 'Worth a second look',
  anchors: [{ kind: 'pdf', page: 1, quads: [[72, 100, 300, 112], [72, 114, 200, 126]], text: 'the lamp' }], created_at: '2026-11-22T10:00:00Z' };
const underline = { id: 'u1', style: 'underline', color: 'sky', comment: null,
  anchors: [{ kind: 'pdf', page: 2, quads: [[72, 200, 150, 212]], text: 'light' }] };

test('highlights and underlines are written as annotations with their own appearance; a comment gets a popup', async () => {
  const bytes = await markedCopy(await book(), { annotations: [highlight, underline], colours });
  const doc = await PDFDocument.load(bytes);
  const [one, two] = doc.getPages();
  const annots = (page) => page.node.Annots()?.asArray().map((ref) => doc.context.lookup(ref)) ?? [];
  const [mark, popup] = annots(one);
  assert.equal(mark.get(PDFName.of('Subtype')).toString(), '/Highlight');
  assert.deepEqual(mark.get(PDFName.of('QuadPoints')).asArray().map((n) => n.asNumber()),
    [72, 692, 300, 692, 72, 680, 300, 680, 72, 678, 200, 678, 72, 666, 200, 666]);
  assert.deepEqual(mark.get(PDFName.of('C')).asArray().map((n) => Math.round(n.asNumber() * 255)), [244, 226, 168]);
  assert.equal(mark.get(PDFName.of('Contents')).decodeText(), 'Worth a second look');
  const appearance = doc.context.lookup(doc.context.lookup(mark.get(PDFName.of('AP'))).get(PDFName.of('N')));
  assert.equal(appearance.dict.get(PDFName.of('Subtype')).toString(), '/Form');
  assert.equal(popup.get(PDFName.of('Subtype')).toString(), '/Popup');
  assert.equal(popup.get(PDFName.of('Parent')).toString(), one.node.Annots().get(0).toString());
  const [rule] = annots(two);
  assert.equal(rule.get(PDFName.of('Subtype')).toString(), '/Underline');
  assert.equal(rule.get(PDFName.of('Contents')), undefined);

  // PDF.js, as a viewer, reads them back where they were drawn
  const page = await pdfjsPage(bytes);
  const [seen] = (await page.getAnnotations()).filter((a) => a.subtype === 'Highlight');
  assert.equal(seen.contentsObj.str, 'Worth a second look');
  const [x0, y0, x1, y1] = seen.rect;
  assert.ok(x0 <= 72 && x1 >= 300 && y0 <= 666 && y1 >= 692);
});

test('a turned page gets its marks where the reader saw them', async () => {
  const bytes = await markedCopy(await book({ rotate: 90, pages: 1 }), { annotations: [highlight], colours });
  const page = await pdfjsPage(bytes);
  const view = page.getViewport({ scale: 1 });
  const [seen] = (await page.getAnnotations()).filter((a) => a.subtype === 'Highlight');
  const corners = [0, 2, 4, 6].map((i) => view.convertToViewportPoint(seen.quadPoints[i], seen.quadPoints[i + 1])
    .map((n) => Math.round(n)).join(',')).sort();
  assert.deepEqual(corners, ['300,100', '300,112', '72,100', '72,112']); // the first line's corners, as drawn
});

test('the marks already in the file are kept, and an encrypted file is refused', async () => {
  const once = await markedCopy(await book(), { annotations: [underline], colours });
  const twice = await PDFDocument.load(await markedCopy(once, { annotations: [highlight], colours }));
  assert.equal(twice.getPages()[1].node.Annots().size(), 1); // the first copy's underline
  assert.equal(twice.getPages()[0].node.Annots().size(), 2);

  const plain = Buffer.from(await (await PDFDocument.load(await book())).save({ useObjectStreams: false })).toString('latin1');
  const locked = Buffer.from(plain.replace('trailer\n<<', 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 >>'), 'latin1');
  await assert.rejects(markedCopy(locked, { annotations: [highlight], colours }), EncryptedPdfError);
});
