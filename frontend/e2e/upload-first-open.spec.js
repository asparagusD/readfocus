// C35.3c (issue 16): a book uploaded from this browser is kept here under its own sha256, so its first open
// reads nothing from the network, PDF or EPUB, also while the server has not hashed it yet (sha256 null).
// The upload itself is in library.spec.js; here the kept copy is put in place as the upload leaves it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect, openReader, BOOK, BOOKS } from './fixtures.js';

const keep = (page, bytes, sha) => page.evaluate(async ({ book, data, sha256 }) => {
  const cache = await caches.open('readfocus-book-files-v1');
  await cache.put(`https://book-files.readfocus.invalid/${book}/${sha256}`, new Response(new Uint8Array(data)));
}, { book: BOOK, data: [...bytes], sha256: sha });

for (const book of ['pdf', 'epub']) {
  test.describe(`a ${book} just uploaded`, () => {
    test.use({ book });

    for (const serverSha of [null, 'same']) {
      test(`opens from this browser with ${serverSha ? 'its hash' : 'no hash yet'} on the server`, async ({ page, api }) => {
        const bytes = readFileSync(new URL(`./fixtures/books/${BOOKS[book].file}`, import.meta.url));
        const sha = createHash('sha256').update(bytes).digest('hex');
        api.fileSha = serverSha && sha;
        await page.goto('/'); // an origin for Cache Storage
        await keep(page, bytes, sha);
        await openReader(page);
        expect(api.fileLoads).toBe(0);
      });
    }
  });
}
