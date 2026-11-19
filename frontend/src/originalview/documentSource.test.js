import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookSource, openedFirst } from './documentSource.js';

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

test('otherwise the signed URL from the server, and a way to renew it when it expires (C34.1)', async () => {
  let signed = 0;
  const source = await bookSource('b1', {
    loadDeviceFile: async () => null,
    fetchFile: async (id) => { signed += 1; return { url: `https://storage.test/sign/${id}?n=${signed}`, expires_in: 300 }; },
  });
  assert.equal(source.url, 'https://storage.test/sign/b1?n=1');
  assert.equal(await source.renew(), 'https://storage.test/sign/b1?n=2');
});

test('a device-only book with no copy here says so', async () => {
  await assert.rejects(
    bookSource('b1', { loadDeviceFile: async () => null, fetchFile: async () => { throw new Error('This book is only on the device it was added from.'); } }),
    /only on the device/,
  );
});

test('the URL /open gave is used for the first read; a renewal asks the server (C34.3)', async () => {
  const asked = [];
  const fetchFile = openedFirst({ url: 'https://storage.test/sign/b1?from=open', expires_in: 300 },
    async (id) => { asked.push(id); return { url: `https://storage.test/sign/${id}?from=file` }; });
  const source = await bookSource('b1', { loadDeviceFile: async () => null, fetchFile });
  assert.equal(source.url, 'https://storage.test/sign/b1?from=open');
  assert.deepEqual(asked, []);
  assert.equal(await source.renew(), 'https://storage.test/sign/b1?from=file');
  assert.deepEqual(asked, ['b1']);
});

test('with no URL from /open (an older server, a device-only book) the server is asked at once', async () => {
  const asked = [];
  const fetchFile = openedFirst(null, async (id) => { asked.push(id); return { url: 'https://storage.test/sign/b1' }; });
  assert.deepEqual(await fetchFile('b1'), { url: 'https://storage.test/sign/b1' });
  assert.deepEqual(asked, ['b1']);
});


test('C35.3c: a copy kept in this browser opens before the signed URL is ever read', async () => {
  const asked = [];
  const source = await bookSource('b1', {
    loadDeviceFile: async () => null,
    fetchFile: async () => ({ url: 'https://storage.test/b1.pdf', sha256: null }),
    cachedFile: async (bookId, sha256) => { asked.push([bookId, sha256]); return new Uint8Array([37, 80, 68, 70]); },
  });
  assert.deepEqual(source, { data: new Uint8Array([37, 80, 68, 70]) });
  assert.deepEqual(asked, [['b1', null]]);
});

test('C35.3c: without a kept copy the signed URL is used as before', async () => {
  const source = await bookSource('b1', {
    loadDeviceFile: async () => null,
    fetchFile: async () => ({ url: 'https://storage.test/b1.pdf', sha256: 'abc' }),
    cachedFile: async () => null,
  });
  assert.equal(source.url, 'https://storage.test/b1.pdf');
  assert.equal(source.sha256, 'abc');
});
