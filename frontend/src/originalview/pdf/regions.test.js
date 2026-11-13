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
