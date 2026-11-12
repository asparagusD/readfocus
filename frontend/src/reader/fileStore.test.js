import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetBookFile, loadBookFile, saveBookFile } from './fileStore.js';

// Node has no IndexedDB: the store must answer "not on this device", never throw.
test('without IndexedDB nothing throws and nothing is kept', async () => {
  assert.equal(await saveBookFile('b1', new Blob(['x']), undefined), false);
  assert.equal(await loadBookFile('b1', undefined), null);
  assert.equal(await forgetBookFile('b1', undefined), false);
});

test('a blocked IndexedDB (open throws) reads as not on this device', async () => {
  const blocked = { open() { throw new DOMException('blocked', 'SecurityError'); } };
  assert.equal(await saveBookFile('b1', new Blob(['x']), blocked), false);
  assert.equal(await loadBookFile('b1', blocked), null);
});

test('an IndexedDB that fails to open reads as not on this device', async () => {
  const failing = {
    open() {
      const request = { error: new Error('quota') };
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  };
  assert.equal(await loadBookFile('b1', failing), null);
  assert.equal(await saveBookFile('b1', new Blob(['x']), failing), false);
});
