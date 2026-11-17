import { useCallback, useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';

/**
 * The book's body start (C23.1): asked once when the reader opens (the server detects and keeps it), and
 * `choose(body)` for "The book starts here" ({ page } or { spine_index }, and a title). A failed lookup leaves
 * it unknown, which locks nothing.
 */
export function useBodyStart(bookId, enabled = true) {
  const [found, setFound] = useState({ bodyStart: null, source: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    fetchApi(`/books/${bookId}/body-start`)
      .then((data) => { if (live) setFound({ bodyStart: data.body_start ?? null, source: data.source ?? null }); })
      .catch(() => {}); // unknown: no front-matter note, nothing locked
    return () => { live = false; };
  }, [bookId, enabled]);

  const choose = useCallback(async (body) => {
    const data = await fetchApi(`/books/${bookId}/body-start`, { method: 'PUT', body: JSON.stringify(body) });
    setFound({ bodyStart: data.body_start, source: data.source });
    return data.body_start;
  }, [bookId]);

  return { ...found, choose };
}
