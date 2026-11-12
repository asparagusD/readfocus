// Read-ahead cache for the next chunk (C12.4). Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadAhead } from './readAhead.js';

test('the next chunk is fetched once and kept', async () => {
  const calls = [];
  const readAhead = createReadAhead(async (path) => { calls.push(path); return { chunks: [{ chunk_index: 3 }] }; });
  const [a, b] = await Promise.all([readAhead.load('book-1', 3), readAhead.load('book-1', 3)]);
  assert.deepEqual(a, { chunk_index: 3 });
  assert.equal(a, b);
  assert.deepEqual(calls, ['/books/book-1/pages?start=3']);
  assert.deepEqual(readAhead.peek('book-1', 3), { chunk_index: 3 });
  assert.equal(readAhead.peek('book-1', 4), undefined);
});

test('past the last chunk there is nothing, and that is remembered', async () => {
  let calls = 0;
  const readAhead = createReadAhead(async () => { calls += 1; return { chunks: [] }; });
  assert.equal(await readAhead.load('book-1', 9), null);
  assert.equal(await readAhead.load('book-1', 9), null);
  assert.equal(calls, 1);
});

test('a failed fetch is not kept, so the next attempt asks again', async () => {
  let fail = true;
  const readAhead = createReadAhead(async () => { if (fail) throw new Error('offline'); return { chunks: [{ chunk_index: 2 }] }; });
  assert.equal(await readAhead.load('book-1', 2), null);
  fail = false;
  assert.deepEqual(await readAhead.load('book-1', 2), { chunk_index: 2 });
});
