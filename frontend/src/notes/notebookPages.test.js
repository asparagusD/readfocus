import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openingPage, pageHere, pageKey, pagesOf, pageStatus } from './notebookPages.js';

const P = 1e6;
const page = (id, start, end = start, extra = {}) => ({ id, kind: 'drawing', position_start: start, position_end: end, ...extra });
const p12 = page('a', 12 * P, 12 * P + 300);
const p40 = page('b', 40 * P, 41 * P + 900);
const p40b = page('c', 40 * P + 500, 40 * P + 800);
const pages = [p12, p40, p40b];
const onPages = (from, to = from) => ({ start: from * P, end: to * P + P - 1 });

test('the pages are the drawing notes, in the order the notes come in', () => {
  const notes = [p12, { id: 't', kind: 'text', position_start: 20 * P }, p40, { id: 'e', kind: 'equation', position_start: 41 * P }];
  assert.deepEqual(pagesOf(notes).map((n) => n.id), ['a', 'b']);
  assert.deepEqual(pagesOf(null), []);
});

test("a page's key is the one it was made with while pending, else its id", () => {
  assert.equal(pageKey({ id: 'x', key: 'pending-1' }), 'pending-1');
  assert.equal(pageKey({ id: 'x' }), 'x');
});

test("this place's page is the last one made on the pages shown", () => {
  assert.equal(pageHere(pages, onPages(40)), 'c');
  assert.equal(pageHere(pages, onPages(41)), 'b'); // b runs onto p. 41
  assert.equal(pageHere(pages, onPages(12)), 'a');
  assert.equal(pageHere(pages, onPages(30)), null);
  assert.equal(pageHere(pages, null), null);
});

test('the notebook opens where it was left, else here, else the page before, else the first', () => {
  assert.equal(openingPage(pages, onPages(12), 'b'), 'b');
  assert.equal(openingPage(pages, onPages(12), 'gone'), 'a');
  assert.equal(openingPage(pages, onPages(40)), 'c');
  assert.equal(openingPage(pages, onPages(30)), 'a'); // nothing on p. 30: the last page made before it
  assert.equal(openingPage(pages, onPages(5)), 'a'); // nothing before p. 5: the first
  assert.equal(openingPage(pages, null), 'a');
  assert.equal(openingPage([], onPages(40), 'b'), null);
});

test("the page's save line", () => {
  assert.equal(pageStatus(undefined), 'Saved');
  assert.equal(pageStatus('unsaved'), 'Saving…');
  assert.match(pageStatus('offline'), /^Offline/);
  assert.equal(pageStatus('conflict'), 'This page is not saved');
  assert.equal(pageStatus('saved', true), '');
});
