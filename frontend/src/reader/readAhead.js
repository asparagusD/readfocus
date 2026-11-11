/**
 * Read-ahead cache (C12.4): the chunk after today's reading, fetched from
 * GET /books/{id}/pages before the reader reaches the last page, once per
 * book and chunk. `null` means the book has no such chunk; a failed fetch
 * is forgotten so a later attempt asks again. Nothing here counts as
 * reading: no session, timer or pacing is touched.
 */
export function createReadAhead(fetcher) {
  const cache = new Map();
  const key = (bookId, index) => `${bookId}:${index}`;
  const settled = new Map();
  return {
    load(bookId, index) {
      const k = key(bookId, index);
      if (!cache.has(k)) {
        const request = fetcher(`/books/${bookId}/pages?start=${index}`)
          .then((data) => {
            const chunk = data?.chunks?.[0] ?? null;
            settled.set(k, chunk);
            return chunk;
          })
          .catch(() => {
            cache.delete(k);
            return null;
          });
        cache.set(k, request);
      }
      return cache.get(k);
    },
    /** The chunk if it has arrived, null if the book has none, undefined if not fetched yet. */
    peek(bookId, index) {
      return settled.get(key(bookId, index));
    },
  };
}
