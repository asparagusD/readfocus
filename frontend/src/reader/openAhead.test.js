import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAhead, takeOpened, warmReader } from './openAhead.js';

function loaders() {
  const loaded = [];
  return { loaded, loaders: { reader: async () => loaded.push('reader'), pdf: async () => loaded.push('pdf') } };
}

test('pointing at a PDF loads the reader and PDF.js once each; an EPUB never loads PDF.js', async () => {
  const { loaded, loaders: l } = loaders();
  const memo = new Map();
  await warmReader('epub', { loaders: l, memo });
  assert.deepEqual(loaded, ['reader']);
  await warmReader('pdf', { loaders: l, memo });
  await warmReader('pdf', { loaders: l, memo });
  assert.deepEqual(loaded, ['reader', 'pdf']);
});

test('a click starts /open once; the reader takes that request, then asks itself', async () => {
  const asked = [];
  const api = async (path) => { asked.push(path); return { book_id: 'b1' }; };
  const warm = () => {};
  const first = openAhead('b1', 'pdf', { api, warm });
  const again = openAhead('b1', 'pdf', { api, warm }); // pointer and keyboard both firing: one request
  assert.equal(first, again);
  assert.deepEqual(asked, ['/books/b1/open']);
  assert.equal(takeOpened('b1'), first);
  assert.equal(takeOpened('b1'), null); // taken once: a later open asks the server again
});

test('an /open older than 30 s is not used: its signed URL may be stale', () => {
  let clock = 0;
  const now = () => clock;
  const api = async () => ({});
  openAhead('b2', 'pdf', { api, now, warm: () => {} });
  clock = 31_000;
  assert.equal(takeOpened('b2', { now }), null);
});

test('a failed /open is not kept, so the reader asks again', async () => {
  const promise = openAhead('b3', 'epub', { api: () => Promise.reject(new Error('down')), warm: () => {} });
  await assert.rejects(promise);
  assert.equal(takeOpened('b3'), null);
});

test('a failed load is tried again next time', async () => {
  let tries = 0;
  const memo = new Map();
  const flaky = { reader: async () => { tries += 1; if (tries === 1) throw new Error('offline'); }, pdf: async () => {} };
  await warmReader('epub', { loaders: flaky, memo });
  await warmReader('epub', { loaders: flaky, memo });
  await warmReader('epub', { loaders: flaky, memo });
  assert.equal(tries, 2);
});
