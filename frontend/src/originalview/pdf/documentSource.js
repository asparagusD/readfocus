// Where a book's original PDF comes from (C17.2): the copy kept in this browser
// (device-only books, C17.1b) if there is one, else a short-lived signed URL from
// GET /books/{id}/file. A URL lets PDF.js fetch byte ranges, so the first page
// shows before the whole file has arrived.

/** A PDF.js getDocument source: { data } for a device copy, { url } for the stored file. */
export async function bookSource(bookId, { loadDeviceFile, fetchFile }) {
  const file = await loadDeviceFile(bookId);
  if (file) return { data: new Uint8Array(await file.arrayBuffer()) };
  const { url } = await fetchFile(bookId);
  return { url };
}
