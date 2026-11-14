import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGION_BATCH, batchOf, createRegionSource, toPagePoint } from './regions.js';

test('pages are asked for in batches of the regions job', () => {
  assert.equal(REGION_BATCH, 20);
  assert.deepEqual(batchOf(1), [1, 20]);
  assert.deepEqual(batchOf(20), [1, 20]);
  assert.deepEqual(batchOf(21), [21, 40]);
});

test('a screen point becomes PDF points from the page top-left', () => {
  const rect = { left: 100, top: 50 };
  assert.deepEqual(toPagePoint(rect, 1.5, 250, 200), { x: 100, y: 100 });
});

function fakeApi(regions) {
  const asked = [];
  const api = async (path) => { asked.push(path); return { regions }; };
  return { api, asked };
}

test('a point inside a math, code or figure box is skipped once its batch is loaded', async () => {
  const { api, asked } = fakeApi([{ page: 3, kind: 'math', bbox: [100, 200, 300, 220] }]);
  const source = createRegionSource(api, 'book-1');
  assert.equal(source.hits(3, 150, 210), false, 'nothing is skipped before the boxes are known');
  await source.load(3);
  await source.load(5); // same batch: asked once
  assert.deepEqual(asked, ['/books/book-1/regions?first=1&last=20']);
  assert.equal(source.hits(3, 150, 210), true);
  assert.equal(source.hits(3, 99, 210), false);
  assert.equal(source.hits(4, 150, 210), false);
});

test('a failed request skips nothing and is tried again later', async () => {
  let calls = 0;
  const source = createRegionSource(async () => { calls += 1; throw new Error('offline'); }, 'book-1');
  await source.load(1);
  assert.equal(source.hits(1, 10, 10), false);
  await source.load(1);
  assert.equal(calls, 2);
});

test('C20.8: whole regions with ids are found by point; inline math is not; listeners hear each batch', async () => {
  const { api } = fakeApi([
    { page: 2, kind: 'math', bbox: [100, 150, 300, 170], id: 'r-eq', inline: false },
    { page: 2, kind: 'math', bbox: [80, 100, 90, 112], id: 'r-block', inline: true },
    { page: 2, kind: 'code', bbox: [60, 200, 400, 260], id: 'r-code', inline: false },
  ]);
  const source = createRegionSource(api, 'book-1');
  let heard = 0;
  const off = source.subscribe(() => { heard += 1; });
  await source.load(2);
  assert.equal(heard, 1);
  assert.deepEqual(source.regionsOf(2).map((r) => r.id), ['r-eq', 'r-code']);
  assert.equal(source.regionAt(2, 150, 160).id, 'r-eq');
  assert.equal(source.regionAt(2, 85, 105), null); // inline math: lookup skips it, but it has no actions
  assert.equal(source.hits(2, 85, 105), true);
  assert.deepEqual(source.boxesOf(2).length, 3);
  off();
});
