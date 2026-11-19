import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT, putFile, uploadBook } from './directUpload.js';

/** An XMLHttpRequest that answers `status` after reporting progress at 25, 50 and 100%. */
function fakeXhr(status = 200, responseText = '') {
  const made = [];
  class XHR {
    constructor() { this.headers = {}; this.upload = {}; made.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) {
      this.body = body;
      for (const loaded of [25, 50, 100]) this.upload.onprogress?.({ lengthComputable: true, loaded, total: 100 });
      this.status = status;
      this.responseText = responseText;
      if (status === 0) this.onerror(); else this.onload();
    }
  }
  return { XHR, made };
}

test('a PDF or EPUB is sent straight to Storage; Markdown and notebooks are not', () => {
  assert.deepEqual(DIRECT, ['pdf', 'epub']);
});

test('putFile sends the file with its type and no overwrite, and reports progress', async () => {
  const { XHR, made } = fakeXhr();
  const seen = [];
  const file = new Blob(['%PDF-1.7']);
  await putFile('https://storage.test/upload?token=t', file, { type: 'application/pdf', onProgress: (p) => seen.push(p), apikey: 'pk', XHR });
  assert.equal(made[0].method, 'PUT');
  assert.equal(made[0].url, 'https://storage.test/upload?token=t');
  assert.deepEqual(made[0].headers, { 'Content-Type': 'application/pdf', 'x-upsert': 'false', apikey: 'pk' });
  assert.equal(made[0].body, file);
  assert.deepEqual(seen, [25, 50, 100]);
});

test('putFile rejects with Storage\'s message, or says the connection dropped', async () => {
  const refused = fakeXhr(413, JSON.stringify({ message: 'The object exceeded the maximum allowed size' }));
  await assert.rejects(putFile('u', new Blob(['x']), { XHR: refused.XHR }), /maximum allowed size/);
  const dropped = fakeXhr(0);
  await assert.rejects(putFile('u', new Blob(['x']), { XHR: dropped.XHR }), /connection dropped/);
});

test('uploadBook asks for the URL, sends the file, registers it and keeps it under its sha256', async () => {
  const calls = [];
  const api = async (path, options) => {
    calls.push([path, JSON.parse(options.body)]);
    return path === '/books/upload-url'
      ? { book_id: 'b1', file_type: 'pdf', upload_url: 'https://storage.test/u?token=t' }
      : { book_id: 'b1', status: 'processing', author: null };
  };
  const file = new File(['%PDF-1.7 body'], 'Frankenstein.pdf');
  const sent = [];
  const kept = [];
  const made = await uploadBook(file, { title: 'Frankenstein', author: '' }, {
    api, put: async (url, body, options) => sent.push([url, body, options.type]),
    hash: async () => 'sha-1', keep: async (...args) => kept.push(args),
  });
  assert.deepEqual(calls, [
    ['/books/upload-url', { filename: 'Frankenstein.pdf', size: file.size }],
    ['/books/register', { book_id: 'b1', file_type: 'pdf', title: 'Frankenstein', author: '' }],
  ]);
  assert.deepEqual(sent, [['https://storage.test/u?token=t', file, 'application/pdf']]);
  assert.equal(made.book_id, 'b1');
  assert.equal(kept[0][0], 'b1');
  assert.equal(new TextDecoder().decode(kept[0][1]), '%PDF-1.7 body');
  assert.equal(kept[0][2], 'sha-1');
});

test('a failed upload never registers; a copy that cannot be kept never fails the upload', async () => {
  const paths = [];
  const api = async (path) => { paths.push(path); return { book_id: 'b1', file_type: 'epub', upload_url: 'u' }; };
  const file = new File(['PK'], 'a.epub');
  await assert.rejects(uploadBook(file, { title: 'A', author: '' }, {
    api, put: async () => { throw new Error('refused'); }, hash: async () => 's', keep: async () => {} }), /refused/);
  assert.deepEqual(paths, ['/books/upload-url']);
  const made = await uploadBook(file, { title: 'A', author: '' }, {
    api, put: async () => {}, hash: async () => { throw new Error('no crypto'); }, keep: async () => {} });
  assert.equal(made.book_id, 'b1');
});
