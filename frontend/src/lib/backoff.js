// C35.6 (issue 17): ask again later and later. While a book was processed the reader asked GET /books/{id}/status
// every 5 s (and the Library every 3 s) for as long as it ran, many minutes on Render's 0.1 CPU, which the same
// process shares with the ingestion. Now: after 5 s, then 10, 20, 40 and every 60 s.

export const FIRST_MS = 5000;
export const MAX_MS = 60000;

/**
 * Run `check` after FIRST_MS, then after twice the last wait, up to MAX_MS, until the returned stop() is called.
 * A check that throws is waited out like any other; checks never overlap.
 */
export function pollWithBackoff(check, { first = FIRST_MS, max = MAX_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let wait = first;
  let timer = null;
  let stopped = false;
  const next = () => {
    if (stopped) return;
    timer = setTimer(async () => {
      try { await check(); } catch { /* the next check may do better */ }
      wait = Math.min(max, wait * 2);
      next();
    }, wait);
  };
  next();
  return () => { stopped = true; clearTimer(timer); };
}
