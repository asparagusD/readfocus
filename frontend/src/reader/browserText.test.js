import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epubTexts, isBig, itemsText, MAX_PAGE_CHARS, pdfTexts, sendTexts, SERVER_MAX_BYTES, sha256Hex } from './browserText.js';

async function* pages(texts) {
  for (const text of texts) yield text;
}

async function sent(texts, perBatch) {
  const posts = [];
  const progress = [];
  const total = await sendTexts(pages(texts), { post: async (body) => posts.push(body), perBatch, progress: (n) => progress.push(n) });
  return { posts, progress, total };
}

test('a book over 50 MB is read on the device', () => {
  assert.equal(isBig({ size: SERVER_MAX_BYTES }), false);
  assert.equal(isBig({ size: SERVER_MAX_BYTES + 1 }), true);
});

test('pages go in batches and only the last says so', async () => {
  const { posts, progress, total } = await sent(['a', 'b', 'c', 'd', 'e'], 2);
  assert.deepEqual(posts, [
    { first: 1, texts: ['a', 'b'], last: false },
    { first: 3, texts: ['c', 'd'], last: false },
    { first: 5, texts: ['e'], last: true },
  ]);
  assert.deepEqual(progress, [2, 4, 5]);
  assert.equal(total, 5);
});

test('a book that fills its last batch exactly ends on it', async () => {
  const { posts } = await sent(['a', 'b', 'c', 'd'], 2);
  assert.deepEqual(posts.map((p) => [p.first, p.texts.length, p.last]), [[1, 2, false], [3, 2, true]]);
});

test('a book with no pages still tells the server it is done', async () => {
  const { posts, total } = await sent([], 50);
  assert.deepEqual(posts, [{ first: 1, texts: [''], last: true }]);
  assert.equal(total, 1);
});

test('a page over the server limit is cut to it', async () => {
  const { posts } = await sent(['x'.repeat(MAX_PAGE_CHARS + 10)], 50);
  assert.equal(posts[0].texts[0].length, MAX_PAGE_CHARS);
});

test('a failed post stops the sending', async () => {
  const post = async (body) => { if (body.first === 3) throw new Error('offline'); };
  await assert.rejects(sendTexts(pages(['a', 'b', 'c', 'd', 'e']), { post, perBatch: 2 }), /offline/);
});

test("a PDF page's text joins its items and breaks lines where pdf.js says", () => {
  assert.equal(itemsText([{ str: 'The lamp', hasEOL: true }, { str: 'threw', hasEOL: false }, { str: ' light.' }]), 'The lamp\nthrew light.');
  assert.equal(itemsText(null), '');
});

test('PDF and EPUB texts come page by page from their readers', async () => {
  const doc = { numPages: 2, destroyed: false, destroy() { this.destroyed = true; },
    getPage: async (n) => ({ getTextContent: async () => ({ items: [{ str: `page ${n}` }] }), cleanup() {} }) };
  let total = null;
  const pdf = [];
  for await (const t of pdfTexts({ arrayBuffer: async () => new ArrayBuffer(4) }, { open: async () => doc, pages: (n) => { total = n; } })) pdf.push(t);
  assert.deepEqual(pdf, ['page 1', 'page 2']);
  assert.equal(total, 2);
  assert.equal(doc.destroyed, true);
  const book = { sections: [1, 2].map((n) => ({ createDocument: async () => ({ body: { textContent: `  Chapter ${n}\n\n  text  ` } }) })) };
  const epub = [];
  for await (const t of epubTexts({}, { make: async () => book })) epub.push(t);
  assert.deepEqual(epub, ['Chapter 1\ntext', 'Chapter 2\ntext']);
});

test('the hash is the hex SHA-256 of the file', async () => {
  const bytes = new TextEncoder().encode('abc');
  assert.equal(await sha256Hex({ arrayBuffer: async () => bytes.buffer }),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
