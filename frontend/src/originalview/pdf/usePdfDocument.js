import { useEffect, useMemo, useState } from 'react';
import { fromBook } from '../bookFile';
import { createPageCache } from './pageCache';
import { loadPdfjs, openPdf, releasePage, renderPage } from './pdfjs';

/**
 * The book's original PDF (C17.2): { status: 'loading' | 'ready' | 'error', doc, numPages, error }.
 * `load` gives the getDocument source; the default is this device's copy, else the signed URL.
 */
export function usePdfDocument(bookId, load = fromBook) {
  const [result, setResult] = useState(null); // { bookId, load, status, doc, numPages, error }
  useEffect(() => {
    let doc = null;
    let gone = false;
    loadPdfjs(); // the library and worker download while the URL is fetched, not after
    load(bookId)
      .then(openPdf)
      .then((opened) => {
        doc = opened;
        if (gone) return opened.destroy();
        setResult({ bookId, load, status: 'ready', doc: opened, numPages: opened.numPages, error: null });
      })
      .catch((error) => !gone && setResult({ bookId, load, status: 'error', doc: null, numPages: 0, error }));
    return () => {
      gone = true;
      doc?.destroy();
    };
  }, [bookId, load]);
  // A result for an earlier book (or source) means this one is still loading.
  if (!result || result.bookId !== bookId || result.load !== load) return LOADING;
  return { status: result.status, doc: result.doc, numPages: result.numPages, error: result.error };
}

const LOADING = Object.freeze({ status: 'loading', doc: null, numPages: 0, error: null });

/**
 * Rendered pages of `doc` at `scale` around `current` (two either side), released as the
 * reader moves on. A new scale, pixel ratio or lamplight colours start a new cache, so zoomed
 * pages are crisp and recoloured pages are never mixed with plain ones.
 */
export function usePageCache(doc, scale, current, colours = null) {
  const pixelRatio = globalThis.devicePixelRatio || 1;
  const key = colours && `${colours.foreground}/${colours.background}`; // new colours: render afresh
  const cache = useMemo(() => doc && createPageCache({
    render: (n) => renderPage(doc, n, scale, pixelRatio, key ? colours : null),
    release: releasePage,
  }), [doc, scale, pixelRatio, key]); // eslint-disable-line react-hooks/exhaustive-deps -- colours by value
  useEffect(() => () => cache?.clear(), [cache]);
  useEffect(() => { if (cache) cache.focus(current, doc.numPages); }, [cache, current, doc]);
  return cache;
}
