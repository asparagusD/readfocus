import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookSource } from './documentSource.js';

const file = new Blob(['%PDF-1.7 device copy']);

test('a copy on this device is used first, without asking the server', async () => {
  let asked = 0;
  const source = await bookSource('b1', {
    loadDeviceFile: async () => file,
    fetchFile: async () => { asked += 1; return { url: 'https://x/sign' }; },
  });
  assert.equal(asked, 0);
  assert.ok(source.data instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(source.data), '%PDF-1.7 device copy');
});

test('otherwise the signed URL from the server', async () => {
  const source = await bookSource('b1', {
    loadDeviceFile: async () => null,
    fetchFile: async (id) => ({ url: `https://storage.test/sign/${id}`, expires_in: 300 }),
  });
  assert.deepEqual(source, { url: 'https://storage.test/sign/b1' });
});

test('a device-only book with no copy here says so', async () => {
  await assert.rejects(
    bookSource('b1', { loadDeviceFile: async () => null, fetchFile: async () => { throw new Error('This book is only on the device it was added from.'); } }),
    /only on the device/,
  );
});
