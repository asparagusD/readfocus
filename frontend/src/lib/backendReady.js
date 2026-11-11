// The backend readiness state machine (C13.8a), pure so node --test can drive it.
// Render Free sleeps the backend; a cold start takes 30-60 s before /health
// answers, and the embedding model loads after that. The app polls
// GET /health and moves through these phases:
//
//   checking  the first 1.5 s: show nothing extra (a warm start ends here)
//   warming   not ready after 1.5 s: the warm-up screen
//   ready     /health said model_ready (or answered but the model is still
//             loading after 90 s: the backend is up, only grading waits)
//   down      /health never answered in 90 s: the error screen

export const SHOW_AFTER_MS = 1500;
export const GIVE_UP_AFTER_MS = 90_000;
export const POLL_EVERY_MS = 2000;

/** A fresh check that starts at `now`; `warm` skips the quiet 1.5 s (after Try again). */
export function start(now, { warm = false } = {}) {
  return { phase: warm ? 'warming' : 'checking', startedAt: now, reachable: false, status: null };
}

/**
 * One event:
 *   { type: 'health', ok, status, modelReady }  a /health response (ok = 2xx)
 *   { type: 'fail' }                            no response (network error or timeout)
 *   { type: 'tick', now }                       the clock moved on
 */
export function step(state, event) {
  if (state.phase === 'ready' || state.phase === 'down') return state;
  switch (event.type) {
    case 'health':
      if (event.ok && event.modelReady) return { ...state, phase: 'ready', status: event.status };
      return { ...state, reachable: state.reachable || event.ok, status: event.status ?? null };
    case 'fail':
      return { ...state, status: null };
    case 'tick': {
      const waited = event.now - state.startedAt;
      if (waited >= GIVE_UP_AFTER_MS) return { ...state, phase: state.reachable ? 'ready' : 'down' };
      if (state.phase === 'checking' && waited >= SHOW_AFTER_MS) return { ...state, phase: 'warming' };
      return state;
    }
    default:
      return state;
  }
}

/** The monospace line on the error screen, e.g. "Error 503 · GET /health". */
export function errorLine(state) {
  return state.status ? `Error ${state.status} · GET /health` : 'No response · GET /health';
}
