// Where a book's original file comes from (C17.2; shared with EPUB in C17.3): the
// copy kept in this browser (device-only books, C17.1b) if there is one, else a
// short-lived signed URL from GET /books/{id}/file. For a PDF the URL is read in byte
// ranges (C34.1), so the first page shows before the whole file has arrived; the URL
// expires after five minutes, so `renew` asks the server for a fresh one.

/**
 * { data } for a device copy or a copy kept in this browser, { url, renew } for the stored file. C35.3c:
 * `cachedFile` finds the file this browser uploaded (also before the server has hashed it, sha256 null),
 * so a book's first open after its upload reads nothing from the network, PDF or EPUB.
 */
export async function bookSource(bookId, { loadDeviceFile, fetchFile, cachedFile = async () => null }) {
  const file = await loadDeviceFile(bookId);
  if (file) return { data: new Uint8Array(await file.arrayBuffer()) };
  const { url, sha256 = null } = await fetchFile(bookId); // C34.7: sha256 names the version kept in the browser
  const kept = await cachedFile(bookId, sha256);
  if (kept) return { data: kept };
  return { url, sha256, renew: () => fetchFile(bookId).then((fresh) => fresh.url) };
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
