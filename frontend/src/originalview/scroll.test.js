import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epubMain, holdOf, layoutPages, pageBox, pagesInView, rowsOf, scrollForHold, scrollToPage, stepScroll } from './scroll.js';
import { buildLocations } from './frame.js';

const letter = { width: 600, height: 800 };
const book = (n, size = letter) => Array.from({ length: n }, () => ({ ...size }));

test('rows: one page a row, pairs, or pairs after the cover alone', () => {
  assert.deepEqual(rowsOf(5), [[1], [2], [3], [4], [5]]);
  assert.deepEqual(rowsOf(5, { columns: 2 }), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(rowsOf(5, { columns: 2, cover: true }), [[1], [2, 3], [4, 5]]);
  assert.deepEqual(rowsOf(0, { columns: 2, cover: true }), []);
});

test('pages are laid out one under another with a gap, centred in the box', () => {
  const layout = layoutPages(book(3), { width: 1000, gap: 16 });
  assert.deepEqual(layout.rows.map((r) => r.top), [16, 832, 1648]);
  assert.equal(layout.height, 2464); // 3 x 800 + 4 gaps
  assert.deepEqual(pageBox(layout, 2), { page: 2, left: 200, top: 832, width: 600, height: 800 });
  // a narrower box than the page (a high zoom): the page starts at the gap and scrolls across
  assert.equal(layoutPages(book(1, { width: 1500, height: 2000 }), { width: 1000 }).rows[0].pages[0].left, 16);
});

test('two pages across sit side by side; a smaller page is centred in its row', () => {
  const sizes = [letter, { width: 600, height: 700 }, letter];
  const layout = layoutPages(sizes, { width: 1400, gap: 16, columns: 2 });
  const [a, b] = layout.rows[0].pages;
  assert.equal(a.left, 92); // (1400 - 1216) / 2
  assert.equal(b.left, 708);
  assert.equal(b.top, 66); // 16 + (800 - 700) / 2
  assert.equal(layout.rows[1].pages[0].page, 3);
});

test('the main page is the one with the most area in view, and every page with some in view is listed', () => {
  const layout = layoutPages(book(5), { width: 1000, gap: 16 });
  assert.deepEqual(pagesInView(layout, 0, 900), { pages: [1, 2], main: 1, atStart: true, atEnd: false });
  // page 1's bottom 300 px and page 2's top 584 px: page 2 is main
  assert.deepEqual(pagesInView(layout, 516, 900).pages, [1, 2]);
  assert.equal(pagesInView(layout, 516, 900).main, 2);
  // a page edge exactly at the view's top is not in view
  assert.deepEqual(pagesInView(layout, 816, 900).pages, [2, 3]);
  // a tie goes to the first
  assert.equal(pagesInView(layout, 424, 800).main, 1); // 392 px of each
});

test('at a tall zoom one page fills the view, and the view can be inside it', () => {
  const layout = layoutPages(book(4, { width: 1800, height: 2400 }), { width: 1200, gap: 16 });
  const here = pagesInView(layout, 2600, 900);
  assert.deepEqual(here.pages, [2]);
  assert.equal(here.main, 2);
});

test('two pages across: both of a row are in view and the main one is the first of the row', () => {
  const layout = layoutPages(book(6), { width: 1400, gap: 16, columns: 2, cover: true });
  const here = pagesInView(layout, layout.rows[1].top - 16, 900);
  assert.deepEqual(here.pages, [2, 3, 4, 5]);
  assert.equal(here.main, 2);
});

test('the end of the book: the last page is in view and atEnd holds; an empty book is at both ends', () => {
  const layout = layoutPages(book(3), { width: 1000, gap: 16 });
  const end = pagesInView(layout, layout.height - 900, 900);
  assert.deepEqual(end.pages, [2, 3]);
  assert.equal(end.main, 3);
  assert.equal(end.atEnd, true);
  assert.deepEqual(pagesInView(layoutPages([], {}), 0, 900), { pages: [], main: null, atStart: true, atEnd: true });
});

test('going to a page scrolls to its row, clamped to the content', () => {
  const layout = layoutPages(book(3), { width: 1000, gap: 16 });
  assert.equal(scrollToPage(layout, 1, 900), 0);
  assert.equal(scrollToPage(layout, 2, 900), 816);
  assert.equal(scrollToPage(layout, 3, 900), layout.height - 900); // the last page cannot reach the top
  assert.equal(scrollToPage(layout, 99, 900), layout.height - 900);
});

test('a zoom keeps the words at the top of the view where they were', () => {
  const small = layoutPages(book(10), { width: 1000, gap: 16 });
  const top = pageBox(small, 4).top + 200; // a quarter of the way down page 4
  const held = holdOf(small, top);
  assert.deepEqual(held, { page: 4, fraction: 0.25 });
  const big = layoutPages(book(10, { width: 900, height: 1200 }), { width: 1000, gap: 16 });
  assert.equal(scrollForHold(big, held, 900), pageBox(big, 4).top + 300);
  // in the gap above a page (C38.4a): just above the next page, kept through the change
  assert.deepEqual(holdOf(small, pageBox(small, 4).top - 8), { page: 4, fraction: -0.01 });
  assert.deepEqual(holdOf(small, 0), { page: 1, fraction: -16 / 800 });
  assert.equal(scrollForHold(big, holdOf(small, 0), 900), 0); // the top of the book stays the top
});

test('a step goes to the next page top, and back to this page top before the one above', () => {
  const layout = layoutPages(book(4), { width: 1000, gap: 16 });
  assert.equal(stepScroll(layout, 0, 900, 1), 816);
  assert.equal(stepScroll(layout, 816, 900, 1), 1632);
  assert.equal(stepScroll(layout, 1000, 900, -1), 816); // inside page 2: back to its top first
  assert.equal(stepScroll(layout, 816, 900, -1), 0);
  assert.equal(stepScroll(layout, 0, 900, -1), 0);
  assert.equal(stepScroll(layout, 2000, 900, 1), layout.height - 900); // the last page: to the end
});

test("an EPUB's main page is the location page covering the most visible characters", () => {
  const locations = buildLocations([4000, 6000], 1500); // section 1 starts at 4000
  assert.equal(epubMain(locations, 0, 0, 1200), 1);
  assert.equal(epubMain(locations, 0, 1000, 2600), 2); // 500 on page 1, 1100 on page 2
  assert.equal(epubMain(locations, 1, 0, 400), 3); // characters 4000-4400
  assert.equal(epubMain(locations, 1, 500, 500), 4); // nothing visible yet: the page holding its start
  assert.equal(epubMain(null, 0, 0, 10), null);
  assert.equal(epubMain(locations, 5, 0, 10), null);
});
