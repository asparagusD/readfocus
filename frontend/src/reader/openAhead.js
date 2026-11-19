// C35.4 (issue 19): a book starts opening before the reader's page has loaded. After C34 the first page of a
// 15.9 MB PDF came 2.8 s after the click, mostly steps waiting for each other: the reader's code, then
// GET /books/{id}/open, then PDF.js and its worker, then the file's first bytes.
//
// - Pointing at a book (hover or focus) loads the reader's code, and for a PDF PDF.js with its worker. Nothing is asked
//   of the server: /open makes the reader's progress row, which marks a book as begun (C32), so pointing at
//   a book must not open it.
// - Clicking it does the same and starts /open; the reader takes that request instead of making its own.

const fetchOpen = (path) => import('../lib/api').then((mod) => mod.fetchApi(path)); // already loaded in the app
const FRESH_MS = 30_000; // the signed file URL in /open's answer lives 300 s; the reader takes it far sooner
const pending = new Map(); // book id -> { promise, at }
const warmed = new Map(); // 'reader' | 'pdf' -> promise

const LOADERS = {
  reader: () => import('../pages/ReadingSession'),
  pdf: () => import('../originalview/pdf/pdfjs').then((mod) => mod.loadPdfjs()), // with its one worker
};

/**
 * Load the reader's page now, and PDF.js with its worker for a PDF (an EPUB never needs them); each part
 * once. Never rejects: a failed load is tried again next time, and the reader loads what it needs anyway.
 */
export function warmReader(kind, { loaders = LOADERS, memo = warmed } = {}) {
  const parts = kind === 'pdf' ? ['reader', 'pdf'] : ['reader'];
  return Promise.all(parts.map((part) => {
    if (!memo.has(part)) memo.set(part, loaders[part]().catch(() => { memo.delete(part); }));
    return memo.get(part);
  }));
}

/** The book was chosen: warm the reader and start GET /books/{id}/open. */
export function openAhead(bookId, kind, { api = fetchOpen, now = Date.now, warm = warmReader } = {}) {
  warm(kind);
  const kept = pending.get(bookId);
  if (kept && now() - kept.at < FRESH_MS) return kept.promise;
  const promise = api(`/books/${bookId}/open`);
  promise.catch(() => pending.delete(bookId)); // a failure is asked again by the reader, not kept
  pending.set(bookId, { promise, at: now() });
  return promise;
}

/** The /open already under way for this book (once), or null: the reader then asks itself. */
export function takeOpened(bookId, { now = Date.now } = {}) {
  const kept = pending.get(bookId);
  pending.delete(bookId);
  return kept && now() - kept.at < FRESH_MS ? kept.promise : null;
}

/**
 * Props for a link to a book in the reader (`kind` 'pdf' or 'epub'): warm on hover or focus, open ahead on
 * click (mouse, touch or Enter). Not on pointerdown: a press dragged away would open a book never gone to.
 */
export function openAheadProps(bookId, kind) {
  return {
    onPointerEnter: () => warmReader(kind),
    onFocus: () => warmReader(kind),
    onClick: () => openAhead(bookId, kind),
  };
}
