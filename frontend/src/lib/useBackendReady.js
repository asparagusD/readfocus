import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from './api';
import { GIVE_UP_AFTER_MS, POLL_EVERY_MS, SHOW_AFTER_MS, start, step } from './backendReady';

const REQUEST_TIMEOUT_MS = 10_000; // a sleeping Render instance holds the first request

/**
 * Polls GET /health until the backend and its model are ready (C13.8a);
 * see lib/backendReady.js for the phases. Returns { phase, state, retry }.
 * The poll runs from app start on every route, so the backend is already
 * waking while the reader signs in.
 */
export function useBackendReady() {
  const [state, setState] = useState(() => start(Date.now()));
  const [run, setRun] = useState(0);
  const warmRetry = useRef(false);

  useEffect(() => {
    let live = true;
    let current = start(Date.now(), { warm: warmRetry.current });
    const dispatch = (event) => {
      if (!live) return;
      current = step(current, event);
      setState(current);
    };
    const tick = () => dispatch({ type: 'tick', now: Date.now() });
    const timers = [
      setTimeout(tick, SHOW_AFTER_MS),
      setTimeout(tick, GIVE_UP_AFTER_MS),
    ];
    let pollTimer;
    const poll = async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`${API_BASE_URL}/health`, { signal: abort.signal });
        const body = response.ok ? await response.json() : {};
        dispatch({ type: 'health', ok: response.ok, status: response.status, modelReady: body.model_ready === true });
      } catch {
        dispatch({ type: 'fail' });
      } finally {
        clearTimeout(timeout);
      }
      tick();
      if (live && (current.phase === 'checking' || current.phase === 'warming')) {
        pollTimer = setTimeout(poll, POLL_EVERY_MS);
      }
    };
    poll();
    return () => {
      live = false;
      timers.forEach(clearTimeout);
      clearTimeout(pollTimer);
    };
  }, [run]);

  const retry = useCallback(() => {
    warmRetry.current = true;
    setState(start(Date.now(), { warm: true }));
    setRun((n) => n + 1);
  }, []);

  return { phase: state.phase, state, retry };
}
