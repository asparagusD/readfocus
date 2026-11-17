import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPageCache, pageWindow } from './pageCache.js';

test('the window is the current page and two either side, clamped to the book', () => {
  assert.deepEqual(pageWindow(1, 300), [1, 2, 3]);
  assert.deepEqual(pageWindow(10, 300), [8, 9, 10, 11, 12]);
  assert.deepEqual(pageWindow(300, 300), [298, 299, 300]);
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(5, 300, 1), [4, 5, 6]);
});

function fakes() {
  const rendered = [];
  const released = [];
  const cache = createPageCache({
    render: async (n) => { rendered.push(n); return { page: n }; },
    release: (entry) => released.push(entry.page),
  });
  return { cache, rendered, released };
}

test('focus renders the window once and get reuses it', async () => {
  const { cache, rendered } = fakes();
  cache.focus(10, 300);
  assert.deepEqual((await cache.get(10)).page, 10);
  await cache.get(12);
  cache.focus(10, 300);
  assert.deepEqual(rendered, [10, 11, 9, 12, 8]); // current first, then outward
  assert.deepEqual(cache.held(), [8, 9, 10, 11, 12]);
});

test('turning a page renders the new edge and releases the page that left the window', async () => {
  const { cache, rendered, released } = fakes();
  cache.focus(10, 300);
  await cache.get(12);
  cache.focus(11, 300);
  await cache.get(13);
  assert.equal(rendered.at(-1), 13);
  assert.deepEqual(released, [8]);
  assert.deepEqual(cache.held(), [9, 10, 11, 12, 13]);
});

test('a jump releases everything outside the new window', async () => {
  const { cache, released } = fakes();
  cache.focus(10, 300);
  await cache.get(10);
  cache.focus(200, 300);
  await cache.get(200);
  assert.deepEqual(released.sort((a, b) => a - b), [8, 9, 10, 11, 12]);
  assert.deepEqual(cache.held(), [198, 199, 200, 201, 202]);
});

test('a page asked for outside the window is rendered on demand and released at the next focus', async () => {
  const { cache, released } = fakes();
  cache.focus(10, 300);
  await cache.get(50);
  assert.ok(cache.held().includes(50));
  cache.focus(10, 300);
  await Promise.resolve();
  assert.deepEqual(released, [50]);
});

test('clear releases every page (a new zoom renders afresh)', async () => {
  const { cache, released } = fakes();
  cache.focus(1, 300);
  await cache.get(3);
  cache.clear();
  await Promise.resolve();
  assert.deepEqual(released.sort(), [1, 2, 3]);
  assert.deepEqual(cache.held(), []);
});

test('a page released before its render finished is released once it does', async () => {
  const finish = new Map();
  const released = [];
  const cache = createPageCache({
    render: (n) => new Promise((resolve) => { finish.set(n, () => resolve({ page: n })); }),
    release: (entry) => released.push(entry.page),
    radius: 0,
  });
  cache.focus(1, 10);
  const first = cache.get(1);
  cache.focus(5, 10);
  assert.deepEqual(released, []);
  finish.get(1)();
  await first;
  await Promise.resolve();
  assert.ok(released.includes(1));
});
