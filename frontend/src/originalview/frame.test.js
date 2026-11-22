import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocations, entryForPage, fontStep, keyAction, locationAt, locationPlace, pdfFolio, readerShortcut, pdfScale, timeAtProgress, zoomStep,
} from './frame.js';

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

test("C38.9: Edge's shortcuts: find, next and previous, go to page, fit, zoom; the browser's zoom left alone", () => {
  assert.equal(readerShortcut({ key: 'f', code: 'KeyF', ctrlKey: true }), 'find');
  assert.equal(readerShortcut({ key: 'g', code: 'KeyG', ctrlKey: true }), 'find-next');
  assert.equal(readerShortcut({ key: 'G', code: 'KeyG', ctrlKey: true, shiftKey: true }), 'find-prev');
  assert.equal(readerShortcut({ key: 'g', code: 'KeyG', ctrlKey: true, altKey: true }), 'go-to-page');
  assert.equal(readerShortcut({ key: '\\', code: 'Backslash', ctrlKey: true }), 'fit');
  assert.equal(readerShortcut({ key: '=', code: 'Equal', ctrlKey: true }), 'zoom-in');
  assert.equal(readerShortcut({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }), 'zoom-in');
  assert.equal(readerShortcut({ key: '+', code: 'NumpadAdd', metaKey: true }), 'zoom-in'); // Cmd on a Mac
  assert.equal(readerShortcut({ key: '-', code: 'Minus', ctrlKey: true }), 'zoom-out');
  assert.equal(readerShortcut({ key: '0', code: 'Digit0', ctrlKey: true }), null); // the browser's reset
  assert.equal(readerShortcut({ key: 'g', code: 'KeyG' }), null); // no Ctrl: a plain key
  assert.equal(readerShortcut({ key: 'f', code: 'KeyF', ctrlKey: true, altKey: true }), null);
  assert.equal(readerShortcut({}), null);
});

test("C40.2c: Ctrl+Shift+U reads aloud, as Edge's; Ctrl+U alone stays the browser's", () => {
  assert.equal(readerShortcut({ key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true }), 'read-aloud');
  assert.equal(readerShortcut({ key: 'U', code: 'KeyU', metaKey: true, shiftKey: true }), 'read-aloud');
  assert.equal(readerShortcut({ key: 'u', code: 'KeyU', ctrlKey: true }), null);
  assert.equal(readerShortcut({ key: 'U', code: 'KeyU', shiftKey: true }), null);
  assert.equal(readerShortcut({ key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true, altKey: true }), null);
});

test("C40.4c: Ctrl+S saves a copy and Ctrl+Shift+S saves it as, as Edge's", () => {
  assert.equal(readerShortcut({ key: 's', code: 'KeyS', ctrlKey: true }), 'save');
  assert.equal(readerShortcut({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }), 'save-as');
  assert.equal(readerShortcut({ key: 's', code: 'KeyS', metaKey: true }), 'save');
  assert.equal(readerShortcut({ key: 's', code: 'KeyS' }), null);
  assert.equal(readerShortcut({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true }), null);
});

test('C40.5: Ctrl+P prints the book', () => {
  assert.equal(readerShortcut({ key: 'p', code: 'KeyP', ctrlKey: true }), 'print');
  assert.equal(readerShortcut({ key: 'p', code: 'KeyP', metaKey: true }), 'print');
  assert.equal(readerShortcut({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }), null); // the browser's own
  assert.equal(readerShortcut({ key: 'p', code: 'KeyP' }), null);
});

test("C38.9: an EPUB's text size steps through its sizes and stops at the ends", () => {
  assert.equal(fontStep(18, 1), 20);
  assert.equal(fontStep(18, -1), 16);
  assert.equal(fontStep(24, 1), 24);
  assert.equal(fontStep(14, -1), 14);
  assert.equal(fontStep(17, 1), 20); // a size not in the list steps from the default
});

test('C38.7b: a location page back to its section and character, for the page box', () => {
  const locs = buildLocations([0, 3000, 1500, 4600], 1500);
  assert.deepEqual(locationPlace(locs, 1), { index: 1, char: 0 }); // the empty first section is skipped
  assert.deepEqual(locationPlace(locs, 2), { index: 1, char: 1500 });
  assert.deepEqual(locationPlace(locs, 3), { index: 2, char: 0 });
  assert.deepEqual(locationPlace(locs, 4), { index: 3, char: 0 });
  assert.deepEqual(locationPlace(locs, 7), { index: 3, char: 4500 });
  assert.deepEqual(locationPlace(locs, 99), { index: 3, char: 4500 }); // clamped to the last page
  assert.equal(locationAt(locs, ...Object.values(locationPlace(locs, 5))), 5); // and back again
  assert.equal(locationPlace(null, 2), null);
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
  // C21.2: Shift with an arrow extends a selection; it never turns the page
  assert.equal(keyAction({ key: 'ArrowRight', shiftKey: true }), null);
  assert.equal(keyAction({ key: 'ArrowLeft', shiftKey: true }), null);
});

test('the contents entry for a page is the last one that starts on or before it', () => {
  const entries = [{ title: 'Preface', page: 3 }, { title: '1 Signals', page: 9 }, { title: '1.1 Noise', page: 12 }];
  assert.equal(entryForPage(entries, 1), null);
  assert.equal(entryForPage(entries, 9)?.title, '1 Signals');
  assert.equal(entryForPage(entries, 30)?.title, '1.1 Noise');
  assert.equal(entryForPage([], 4), null);
});

test('the turn happens when the leaf stands on edge: the time at half the rotation', () => {
  assert.ok(Math.abs(timeAtProgress([0, 0, 1, 1], 0.5) - 0.5) < 1e-6); // linear
  assert.ok(Math.abs(timeAtProgress([0.22, 0.61, 0.36, 1], 0.5) - 0.199) < 0.002); // --ease-settle front-loads it
});
