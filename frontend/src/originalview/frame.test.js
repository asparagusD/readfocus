import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocations, entryForPage, epubThemeCss, keyAction, locationAt, pdfFolio, pdfScale, spreadPages, stepSpread, timeAtProgress, zoomStep,
} from './frame.js';

test('PDF spreads: the first page alone on the right, then even pages on the left', () => {
  assert.deepEqual(spreadPages(1, 10, true), [1]);
  assert.deepEqual(spreadPages(2, 10, true), [2, 3]);
  assert.deepEqual(spreadPages(3, 10, true), [2, 3]);
  assert.deepEqual(spreadPages(10, 10, true), [10]);
  assert.deepEqual(spreadPages(7, 10, false), [7]);
  assert.deepEqual(spreadPages(44, 380, true), [44, 45]);
});

test('turning moves by a spread or a page and stops at the ends', () => {
  assert.equal(stepSpread(1, 10, true, 1), 2);
  assert.equal(stepSpread(2, 10, true, 1), 4);
  assert.equal(stepSpread(3, 10, true, -1), 1);
  assert.equal(stepSpread(10, 10, true, 1), 10);
  assert.equal(stepSpread(1, 10, true, -1), 1);
  assert.equal(stepSpread(5, 10, false, 1), 6);
  assert.equal(stepSpread(10, 10, false, 1), 10);
});

test('zoom: fit-page and fit-width from the frame; percentages are of the printed size', () => {
  const page = { width: 612, height: 792 }; // US Letter in points
  const frame = { width: 1200, height: 800 };
  assert.equal(pdfScale('fit-page', page, frame, 2), Math.min(600 / 612, 800 / 792));
  assert.equal(pdfScale('fit-width', page, frame, 1), 1200 / 612);
  assert.equal(pdfScale(1.5, page, frame, 2), 1.5 * 96 / 72);
  assert.ok(pdfScale('fit-page', page, { width: 0, height: 0 }, 1) > 0); // never zero or negative
});

test('zoom steps: fit-page, fit-width, then 125 to 200 %', () => {
  assert.equal(zoomStep('fit-page', 1), 'fit-width');
  assert.equal(zoomStep('fit-width', 1), 1.25);
  assert.equal(zoomStep(1.75, 1), 2);
  assert.equal(zoomStep(2, 1), 2);
  assert.equal(zoomStep(1.25, -1), 'fit-width');
  assert.equal(zoomStep('fit-page', -1), 'fit-page');
});

test('PDF folio: the page label when the PDF has one, else the number', () => {
  assert.equal(pdfFolio([5], 300, null), 'p. 5 of 300');
  assert.equal(pdfFolio([44, 45], 380, null), 'pp. 44–45 of 380');
  const labels = ['i', 'ii', 'iii', '1', '2'];
  assert.equal(pdfFolio([2], 5, labels), 'p. ii of 5');
  assert.equal(pdfFolio([4, 5], 5, labels), 'pp. 1–2 of 5');
});

test('EPUB locations: stable page numbers from character counts, computed once', () => {
  const locs = buildLocations([0, 3000, 1500, 4600], 1500);
  assert.deepEqual(locs.starts, [0, 0, 3000, 4500]);
  assert.equal(locs.total, 7); // ceil(9100 / 1500)
  assert.equal(locationAt(locs, 1, 0), 1);
  assert.equal(locationAt(locs, 1, 1499), 1);
  assert.equal(locationAt(locs, 1, 1500), 2);
  assert.equal(locationAt(locs, 3, 100), 4);
  assert.equal(locationAt(locs, 3, 99999), 7); // never past the last
  assert.equal(locationAt(null, 2, 10), null);
  assert.deepEqual(buildLocations([], 1500), { starts: [], chars: [], total: 1, perPage: 1500 });
});

test('keys: arrows, Page Up/Down, Space and Shift+Space turn; Home, End and B', () => {
  assert.equal(keyAction({ key: 'ArrowRight' }), 'next');
  assert.equal(keyAction({ key: 'PageDown' }), 'next');
  assert.equal(keyAction({ key: ' ' }), 'next');
  assert.equal(keyAction({ key: ' ', shiftKey: true }), 'prev');
  assert.equal(keyAction({ key: 'ArrowLeft' }), 'prev');
  assert.equal(keyAction({ key: 'PageUp' }), 'prev');
  assert.equal(keyAction({ key: 'Home' }), 'first');
  assert.equal(keyAction({ key: 'End' }), 'last');
  assert.equal(keyAction({ key: 'b' }), 'ribbon');
  assert.equal(keyAction({ key: 'ArrowRight', ctrlKey: true }), null); // the browser's own shortcuts stay
  assert.equal(keyAction({ key: 'x' }), null);
});

test('the contents entry for a page is the last one that starts on or before it', () => {
  const entries = [{ title: 'Preface', page: 3 }, { title: '1 Signals', page: 9 }, { title: '1.1 Noise', page: 12 }];
  assert.equal(entryForPage(entries, 1), null);
  assert.equal(entryForPage(entries, 9)?.title, '1 Signals');
  assert.equal(entryForPage(entries, 30)?.title, '1.1 Noise');
  assert.equal(entryForPage([], 4), null);
});

test('lamplight CSS recolours text and backgrounds but never images, figures drawn in SVG, or video', () => {
  const css = epubThemeCss({ background: '#231e19', foreground: '#eee5d5', link: '#eda77b', code: '#1a1612' });
  assert.match(css, /background(-color)?:\s*#231e19 !important/);
  assert.match(css, /color:\s*#eee5d5 !important/);
  assert.match(css, /:not\(img\)/);
  assert.match(css, /:not\(svg\)/);
  assert.match(css, /:not\(svg \*\)/);
  assert.doesNotMatch(css, /filter|invert/);
});

test('the turn happens when the leaf stands on edge: the time at half the rotation', () => {
  assert.ok(Math.abs(timeAtProgress([0, 0, 1, 1], 0.5) - 0.5) < 1e-6); // linear
  assert.ok(Math.abs(timeAtProgress([0.22, 0.61, 0.36, 1], 0.5) - 0.199) < 0.002); // --ease-settle front-loads it
});
