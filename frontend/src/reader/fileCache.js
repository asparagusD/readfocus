// A stored book's file kept in this browser after its first open (C34.7, issue 15). An EPUB
// is read whole (foliate needs the zip), and the signed URL is new on every open, so the
// browser's own cache never helped: every open downloaded the whole file again. Here the
// bytes go into Cache Storage, keyed by the book and its sha256 (from GET /books/{id}/open
// or /file), so the next open reads them from disk and a changed file is fetched afresh.
//
// PDFs are not kept: they open from byte ranges (C34.1), a page after about 0.6 MB, and
// keeping one would mean downloading all of it. Device-only books stay in fileStore.js.
// Cache Storage can be missing or full (private windows, quotas): then nothing is kept and
// the file is downloaded as before. Signing out forgets every kept file.

export const CACHE_NAME = 'readfocus-book-files-v1';
const ORIGIN = 'https://book-files.readfocus.invalid'; // a key, never fetched
const prefix = (bookId) => `${ORIGIN}/${encodeURIComponent(bookId)}/`;
const keyFor = (bookId, sha256) => `${prefix(bookId)}${sha256 || 'unhashed'}`;

async function open(caches) {
  return caches ? caches.open(CACHE_NAME) : null;
}

async function dropBook(cache, bookId) {
  for (const request of await cache.keys()) {
    if (request.url.startsWith(prefix(bookId))) await cache.delete(request);
  }
}

/** The kept bytes of this version of the book's file, or null. Never throws. */
export async function cachedBookFile(bookId, sha256, caches = globalThis.caches) {
  try {
    const cache = await open(caches);
    const found = cache && await cache.match(keyFor(bookId, sha256));
    return found ? new Uint8Array(await found.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Keep `bytes` as this book's file, in place of any other version; true when kept. Never throws. */
export async function keepBookFile(bookId, sha256, bytes, caches = globalThis.caches) {
  try {
    const cache = await open(caches);
    if (!cache) return false;
    await dropBook(cache, bookId);
    await cache.put(keyFor(bookId, sha256), new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
    return true;
  } catch {
    return false;
  }
}

/** Forget the book's kept file (the book was removed). Never throws. */
export async function forgetCachedBookFile(bookId, caches = globalThis.caches) {
  try {
    const cache = await open(caches);
    if (cache) await dropBook(cache, bookId);
  } catch { /* nothing kept, or storage gone: nothing to forget */ }
}

/** Forget every kept file (signing out). Never throws. */
export async function forgetCachedBookFiles(caches = globalThis.caches) {
  try {
    await caches?.delete(CACHE_NAME);
  } catch { /* as above */ }
}

/**
 * `source` ({ url, sha256 } or { data }) as { data }: the kept copy when there is one, else the
 * file downloaded once and kept for next time. A { data } source is returned as it is.
 */
export async function keptSource(bookId, source, { fetch: get = globalThis.fetch, caches = globalThis.caches } = {}) {
  if (source.data || !source.url) return source;
  const kept = await cachedBookFile(bookId, source.sha256, caches);
  if (kept) return { data: kept };
  const response = await get(source.url);
  if (!response.ok) throw new Error(`The book's file could not be read (HTTP ${response.status}).`);
  const data = new Uint8Array(await response.arrayBuffer());
  keepBookFile(bookId, source.sha256, data, caches); // not awaited: the book opens while it is stored
  return { data };
}
