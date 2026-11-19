// C35.8c (issue 19): the next book's file is put in the CDN's cache before the reader opens it.
//
// Supabase Storage serves signed URLs through a CDN whose cache key includes the URL's token. On a miss the CDN
// fetches the whole file from Storage first (0.3 to 2 MB/s measured) and answers a range only when that fetch has
// reached it, so a 16 MB PDF that keeps its cross-reference table at its end waited 5 to 20 s for its first page.
// Since C35.8a the server hands out the same URL for a book for up to an hour; asking that URL for one byte starts
// the CDN's fetch, from this reader's own edge, so the open that follows reads from the cache (about 50 ms a range).
// Only the shelf's next book, and at most once in ten minutes: each warm costs the CDN a whole download of the file.

export const WARM_EVERY_MS = 10 * 60_000; // well inside the 15 minutes a kept URL still lives at least
const warmed = new Map(); // book id -> when

const askFile = (bookId) => import('../lib/api').then((mod) => mod.fetchApi(`/books/${bookId}/file`)); // loaded in the app

/**
 * Warm `book`'s stored PDF ({ id, file_type, storage_mode }); an EPUB is read whole and kept in this browser after
 * its first open, and a device-only book has no stored file. Resolves when the one byte has come; never rejects.
 */
export function warmBookFile(book, { api = askFile, fetch: get = globalThis.fetch, now = Date.now, memo = warmed } = {}) {
  if (!book?.id || book.file_type !== 'pdf' || book.storage_mode === 'device') return Promise.resolve(false);
  const at = memo.get(book.id);
  if (at != null && now() - at < WARM_EVERY_MS) return Promise.resolve(false);
  memo.set(book.id, now());
  return api(book.id)
    .then(({ url } = {}) => (url ? get(url, { headers: { Range: 'bytes=0-0' } }) : null))
    .then((res) => { res?.body?.cancel?.(); return Boolean(res?.ok); })
    .catch(() => false); // kept in `memo` all the same: a failing book is not asked again on every render
}
