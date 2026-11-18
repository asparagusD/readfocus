// Where a book's original file comes from (C17.2; shared with EPUB in C17.3): the
// copy kept in this browser (device-only books, C17.1b) if there is one, else a
// short-lived signed URL from GET /books/{id}/file. For a PDF the URL is read in byte
// ranges (C34.1), so the first page shows before the whole file has arrived; the URL
// expires after five minutes, so `renew` asks the server for a fresh one.

/** { data } for a device copy, { url, renew } for the stored file. */
export async function bookSource(bookId, { loadDeviceFile, fetchFile }) {
  const file = await loadDeviceFile(bookId);
  if (file) return { data: new Uint8Array(await file.arrayBuffer()) };
  const { url } = await fetchFile(bookId);
  return { url, renew: () => fetchFile(bookId).then((fresh) => fresh.url) };
}

/**
 * C34.3: a fetchFile that gives `opened` (the { url } GET /books/{id}/open already signed) the first
 * time and asks `fetchFile` after that: for a renewal, a retry or a book that came with none.
 */
export function openedFirst(opened, fetchFile) {
  let given = opened?.url ? opened : null;
  return (bookId) => {
    const first = given;
    given = null;
    return first ? Promise.resolve(first) : fetchFile(bookId);
  };
}
