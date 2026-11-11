// Pure page geometry of the paginated reader (C12.3). Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SPREAD_MIN_WIDTH, clampPage, firstPageOfView, lineHeight, pageCount, pageGeometry, pageOfX,
} from './geometry.js';

test('a spread from 1024 px, one page below', () => {
  assert.equal(pageGeometry({ width: SPREAD_MIN_WIDTH, height: 800 }).spread, true);
  assert.equal(pageGeometry({ width: SPREAD_MIN_WIDTH - 1, height: 800 }).spread, false);
  assert.equal(pageGeometry({ width: 1440, height: 800 }).perView, 2);
  assert.equal(pageGeometry({ width: 375, height: 700 }).perView, 1);
});

test('symmetric margins make every column stride exactly one page', () => {
  for (const size of [{ width: 1440, height: 820 }, { width: 1024, height: 700 }, { width: 375, height: 700 }]) {
    const g = pageGeometry(size);
    assert.equal(g.column + g.gap, g.pageWidth);
    assert.equal(g.stride, g.pageWidth);
    assert.ok(g.perView * g.pageWidth <= size.width, 'the book fits the width');
  }
});

test('pages keep a book measure and never stretch on wide screens', () => {
  const wide = pageGeometry({ width: 2560, height: 1300, fontSize: 18 });
  assert.ok(wide.column / (18 * 0.5) <= 72, 'about 70 characters at most');
  const desk = pageGeometry({ width: 1440, height: 820, fontSize: 18 });
  assert.ok(desk.column / (18 * 0.5) >= 50, 'about 50 characters at least on a desktop spread');
  assert.ok(wide.pageHeight <= wide.pageWidth * 1.6, 'not taller than a book page');
});

test('the text area is a whole number of lines', () => {
  for (const fontSize of [16.5, 18, 19.5]) {
    const g = pageGeometry({ width: 1440, height: 820, fontSize });
    const lines = g.textHeight / lineHeight(fontSize);
    assert.ok(Math.abs(lines - Math.round(lines)) < 1e-9, `${fontSize}: ${lines} lines`);
    assert.ok(lines >= 12);
  }
});

test('page count from the flow width', () => {
  const g = pageGeometry({ width: 1440, height: 820 });
  assert.equal(pageCount(g.column, g), 1);
  assert.equal(pageCount(g.column + g.stride, g), 2);
  assert.equal(pageCount(g.column + 9 * g.stride + 0.4, g), 10);
  assert.equal(pageCount(0, g), 1);
});

test('the page holding a point, the view a page sits in, and clamping', () => {
  const g = pageGeometry({ width: 375, height: 700 });
  assert.equal(pageOfX(0, g), 0);
  assert.equal(pageOfX(g.stride - 1, g), 0);
  assert.equal(pageOfX(g.stride, g), 1);
  assert.equal(pageOfX(-3, g), 0);
  assert.equal(firstPageOfView(5, 2), 4);
  assert.equal(firstPageOfView(5, 1), 5);
  assert.equal(clampPage(9, 7, 2), 6);
  assert.equal(clampPage(-1, 7, 2), 0);
  assert.equal(clampPage(3, 7, 1), 3);
});
