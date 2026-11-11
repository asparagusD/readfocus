import { useCallback, useEffect, useRef } from 'react';
import { fetchApi } from '../lib/api';

const DELAY_MS = 1000;

/**
 * Saves the reader's place for a session (PUT /sessions/{id}/position, C12.2),
 * debounced: at most one request a second while pages turn, and the last
 * place is sent with keepalive when the page is hidden or closed. A failed
 * save is dropped quietly; the next turn sends a newer place anyway.
 * Returns { save, saveNow }; saveNow skips the wait (the ribbon).
 */
export function usePlaceSaver(sessionId) {
  const pending = useRef(null);
  const timer = useRef(null);

  const flush = useCallback((keepalive = false) => {
    clearTimeout(timer.current);
    timer.current = null;
    const place = pending.current;
    if (!place || !sessionId) return;
    pending.current = null;
    const [chunk] = place.block_id.split('.');
    fetchApi(`/sessions/${sessionId}/position`, {
      method: 'PUT',
      keepalive,
      body: JSON.stringify({ chunk_index: Number(chunk), block_id: place.block_id, char_offset: place.char_offset }),
    }).catch(() => {});
  }, [sessionId]);

  const save = useCallback((place) => {
    pending.current = place;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(false), DELAY_MS);
  }, [flush]);

  // The ribbon bookmark (C12.5b): save this place now, not after the debounce.
  const saveNow = useCallback((place) => {
    pending.current = place;
    flush(false);
  }, [flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flush(true); // leaving the reader (finish, abandon, back) keeps the last place
    };
  }, [flush]);

  return { save, saveNow };
}
