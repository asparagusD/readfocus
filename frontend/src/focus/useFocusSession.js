import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from '../lib/api';
import { HEARTBEAT_MS, SYNC_MS, answerLapsed, idleDue, pageKey, placePosition } from './clock';

const OPEN = new Set(['active', 'paused']);
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-0000-4000-8000-000000000000`.slice(0, 36));

/**
 * A focus session on the reader's side (C23.6, docs/FOCUS_RULES.md). The tab reports and the server times:
 * a heartbeat every 30 s while the page is visible (carrying whether the reader scrolled, typed or pointed since
 * the last one the server kept), hidden and visible as the tab changes, a page turn on each move, the idle
 * prompt and its answer. The display is the server's last answer, read again every minute. `restored` is true
 * once the reader's open session in this book (if any) has been looked up, so a reload carries on; `wanted` is the
 * reader's toggle, and a live session keeps focus mode on whatever it says.
 */
export function useFocusSession({ bookId, place, reader, wanted }) {
  const [session, setSession] = useState(null);
  const [readAt, setReadAt] = useState(() => Date.now());
  const [restored, setRestored] = useState(false);
  const [idle, setIdle] = useState(null); // { at } while "Still with the book?" is up
  const [error, setError] = useState(null);
  const input = useRef({ last: 0, since: false }); // `since`: input since the last heartbeat kept
  const prompted = useRef(null); // the idle prompt's time while it is up
  const sid = session?.id;
  const open = Boolean(session && OPEN.has(session.status));
  const active = session?.status === 'active';
  const live = Boolean(session && (OPEN.has(session.status) || session.status === 'awaiting_quiz'));
  const enabled = Boolean(wanted) || live; // an open session keeps focus mode on, even after a reload

  const take = useCallback((view) => {
    if (!view) return;
    setSession(view);
    setReadAt(Date.now());
  }, []);

  const send = useCallback(async (kind, extra = {}) => {
    if (!sid) return null;
    try {
      const body = { kind, client_event_id: uuid(), client_ts: new Date().toISOString(), ...extra };
      const reply = await fetchApi(`/focus/${sid}/event`, { method: 'POST', body: JSON.stringify(body) });
      take(reply.session);
      return reply;
    } catch (err) {
      if (err.status === 409) take(await fetchApi(`/focus/${sid}`).catch(() => null)); // ended or capped meanwhile
      return null;
    }
  }, [sid, take]);

  const beat = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const reply = await send('heartbeat', { had_input: input.current.since });
    if (reply?.accepted) input.current.since = false; // a heartbeat the server ignored keeps its input
  }, [send]);

  // A reload finds the session where it was left.
  useEffect(() => {
    let live = true;
    fetchApi(`/focus/current?book_id=${encodeURIComponent(bookId)}`)
      .then((data) => { if (live) take(data.session); })
      .catch(() => {})
      .finally(() => { if (live) setRestored(true); });
    return () => { live = false; };
  }, [bookId, take]);

  const answerIdle = useCallback(() => {
    input.current = { last: Date.now(), since: true };
    if (!prompted.current) return;
    prompted.current = null;
    setIdle(null);
    send('idle_confirm');
  }, [send]);

  // Input, for the heartbeat's flag and the idle prompt (any input while it is up answers it).
  useEffect(() => {
    if (!enabled) return undefined;
    input.current = { last: Date.now(), since: true }; // turning focus mode on is input
    const seen = () => {
      input.current = { last: Date.now(), since: true };
      if (prompted.current) answerIdle();
    };
    const kinds = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
    kinds.forEach((k) => window.addEventListener(k, seen, { capture: true, passive: true }));
    return () => kinds.forEach((k) => window.removeEventListener(k, seen, { capture: true }));
  }, [enabled, answerIdle]);

  // Heartbeats while active, the idle check, and the server's time every minute.
  useEffect(() => {
    if (!enabled || !active) return undefined;
    const heart = setInterval(beat, HEARTBEAT_MS);
    const watch = setInterval(() => {
      if (!prompted.current && document.visibilityState === 'visible' && idleDue(input.current.last, Date.now())) {
        prompted.current = { at: Date.now() };
        setIdle(prompted.current);
        send('idle_prompt');
      }
    }, 5_000);
    return () => { clearInterval(heart); clearInterval(watch); };
  }, [enabled, active, beat, send]);

  useEffect(() => {
    if (!enabled || !sid || !session || !['active', 'paused', 'awaiting_quiz'].includes(session.status)) return undefined;
    const sync = setInterval(() => { fetchApi(`/focus/${sid}`).then(take).catch(() => {}); }, SYNC_MS);
    return () => clearInterval(sync);
  }, [enabled, sid, session, take]);

  // The tab hidden pauses the clock (F5); visible again resumes it with a heartbeat at once.
  useEffect(() => {
    if (!enabled || !open) return undefined;
    const changed = () => {
      if (document.visibilityState === 'hidden') send('hidden');
      else send('visible').then(beat);
    };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, [enabled, open, send, beat]);

  // A page turn is an event and an input.
  const key = pageKey(place);
  const turned = useRef(key);
  useEffect(() => {
    if (!enabled || !active || !key || key === turned.current) return;
    turned.current = key;
    input.current = { last: Date.now(), since: true };
    send('page_turn', { page_key: key, position: placePosition(place) });
  }, [enabled, active, key, place, send]);

  const act = useCallback(async (path, body) => {
    setError(null);
    try {
      const view = await fetchApi(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      take(view);
      return view;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [take]);

  const start = useCallback(async () => {
    const anchor = reader.current?.anchor();
    if (!anchor) return null;
    try {
      const view = await act('/focus/start', { book_id: bookId, anchor, page_key: key });
      turned.current = key;
      input.current = { last: Date.now(), since: true };
      await fetchApi(`/focus/${view.id}/event`, { method: 'POST', body: JSON.stringify({
        kind: 'heartbeat', had_input: true, client_event_id: uuid(), client_ts: new Date().toISOString() }) })
        .then((reply) => take(reply.session)).catch(() => {});
      return view;
    } catch (err) {
      const other = err.detail?.session_id;
      if (err.status === 409 && other) take(await fetchApi(`/focus/${other}`));
      return null;
    }
  }, [act, bookId, key, reader, take]);

  return {
    session, readAt, restored, idle, error, live, enabled,
    idleLapsed: (now) => Boolean(idle && answerLapsed(idle.at, now)),
    start,
    pause: () => act(`/focus/${sid}/pause`),
    resume: async () => { const view = await act(`/focus/${sid}/resume`); beat(); return view; },
    discard: async () => { const view = await act(`/focus/${sid}/discard`); prompted.current = null; setIdle(null); return view; },
    end: (bookmark) => act(`/focus/${sid}/end`, { bookmark_anchor: bookmark }),
    answerIdle,
    clear: () => { prompted.current = null; setSession(null); setIdle(null); },
  };
}
