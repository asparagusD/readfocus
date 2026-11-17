/**
 * Close an open PDF.js document (DEBUG_LOG 2026-11-15 C23.6b). PDF.js 6 documents have no destroy() of their
 * own; their loading task closes them and the worker's copy. An older document's destroy() is used when present.
 */
export function closePdf(doc) {
  if (!doc) return undefined;
  if (typeof doc.destroy === 'function') return doc.destroy();
  return doc.loadingTask?.destroy?.();
}
