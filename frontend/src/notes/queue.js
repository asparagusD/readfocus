/**
 * The notepad's offline queue (C22.2): note changes that could not reach the server, one entry per note (the
 * latest), kept in IndexedDB so they survive a closed tab, and sent again when the reader is back online. Every
 * IndexedDB call is wrapped: a private window, blocked storage or no IndexedDB at all falls back to memory for
 * the visit. Entries are { id, change, version }: the PATCH body and the version it was made on.
 */

const DB = 'rf-notes';
const STORE = 'queue';

export function memoryStore() {
  const map = new Map();
  return {
    put: async (entry) => { map.set(entry.id, entry); },
    all: async () => [...map.values()],
    drop: async (id) => { map.delete(id); },
  };
}

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** An IndexedDB store, or memory if `factory` (window.indexedDB) is missing or refuses. */
export function idbStore(factory = globalThis.indexedDB) {
  const memory = memoryStore();
  let opened = null;
  const open = () => {
    if (!opened) {
      opened = (async () => {
        if (!factory) return null;
        const request = factory.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
        return done(request);
      })().catch(() => null);
    }
    return opened;
  };
  const run = async (mode, act, fallback) => {
    try {
      const db = await open();
      if (!db) return fallback();
      return await done(act(db.transaction(STORE, mode).objectStore(STORE)));
    } catch {
      return fallback();
    }
  };
  return {
    put: (entry) => run('readwrite', (s) => s.put(entry), () => memory.put(entry)),
    all: () => run('readonly', (s) => s.getAll(), () => memory.all()),
    drop: (id) => run('readwrite', (s) => s.delete(id), () => memory.drop(id)),
  };
}

export function createQueue(store) {
  return {
    put: (entry) => store.put(JSON.parse(JSON.stringify(entry))),
    all: async () => ((await store.all()) ?? []).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    drop: (id) => store.drop(id),
  };
}
