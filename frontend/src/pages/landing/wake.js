// Starts waking the backend from the landing page (C13.10a). Render Free
// sleeps after idle, so one GET /health while a visitor reads the landing
// page shortens the wait after they sign in. Fire and forget: no retries,
// errors ignored, and at most once per page load (StrictMode runs effects
// twice in development).
let sent = false;

export function wakeBackend(baseUrl, fetchImpl = globalThis.fetch) {
  if (sent || typeof fetchImpl !== 'function') return false;
  sent = true;
  Promise.resolve()
    .then(() => fetchImpl(`${baseUrl}/health`, { method: 'GET', mode: 'cors', keepalive: true }))
    .catch(() => {});
  return true;
}

/** For tests only: forget that the call was sent. */
export function resetWake() {
  sent = false;
}
