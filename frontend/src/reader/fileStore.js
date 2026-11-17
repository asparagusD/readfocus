// Original book files kept in this browser (C17.1): a device-only book's file
// lives only here. IndexedDB can be missing, blocked or wiped (private windows,
// cleared site data), so every call resolves instead of throwing: null or false
// means "not on this device".

const DB_NAME = 'readfocus-books';
const STORE = 'files';

function open(idb) {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run(idb, mode, action) {
  return open(idb).then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

/** Keep `file` (a File or Blob) for `bookId`. Resolves true when it was saved. */
export async function saveBookFile(bookId, file, idb = globalThis.indexedDB) {
  try {
    if (!idb) return false;
    await run(idb, 'readwrite', (store) => store.put(file, bookId));
    return true;
  } catch {
    return false;
  }
}

/** The file kept for `bookId`, or null when this device does not have it. */
export async function loadBookFile(bookId, idb = globalThis.indexedDB) {
  try {
    if (!idb) return null;
    return (await run(idb, 'readonly', (store) => store.get(bookId))) ?? null;
  } catch {
    return null;
  }
}

/** Forget the file kept for `bookId` (after the book is removed). */
export async function forgetBookFile(bookId, idb = globalThis.indexedDB) {
  try {
    if (!idb) return false;
    await run(idb, 'readwrite', (store) => store.delete(bookId));
    return true;
  } catch {
    return false;
  }
}
