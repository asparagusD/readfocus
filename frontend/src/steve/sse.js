/**
 * Server-Sent Events from POST /steve/ask (C20.6, docs/STEVE.md S12): `start`, `token`, `done`, `error`.
 * EventSource only does GET, so the stream is read from fetch's body and parsed here. A refusal before the
 * stream (consent, quota, size...) arrives as JSON with a status, and becomes a SteveError.
 */

/** A stateful parser: feed it text as it arrives; it returns the complete events seen so far. */
export function createEventParser() {
  let buffer = '';
  return function feed(chunk) {
    buffer += chunk.replace(/\r\n/g, '\n');
    const events = [];
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let name = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      try {
        events.push({ name, data: JSON.parse(data.join('\n')) });
      } catch {
        events.push({ name: 'error', data: { code: 'unavailable', message: 'Steve sent something unreadable.' } });
      }
    }
    return events;
  };
}

/** A refusal with its typed code (no_consent, paused_quota, ...) and, for pauses, when Steve is back. */
export class SteveError extends Error {
  constructor(code, message, status, until = null) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.until = until;
  }
}

/** The SteveError for a non-2xx answer's JSON body (FastAPI puts ours in `detail`). */
export function errorFrom(status, body) {
  const detail = body?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.code) {
    return new SteveError(detail.code, detail.message, status, detail.until ?? null);
  }
  if (status === 422) return new SteveError('invalid', 'Steve could not read that question.', status);
  if (status === 401) return new SteveError('signed_out', 'Your sign-in has ended.', status);
  return new SteveError('unavailable', 'Steve cannot answer right now. Try again soon.', status);
}

/**
 * Ask Steve: POST the request and call onEvent({name, data}) for each event until the stream ends.
 * `fetchImpl` and `token` are passed in so this stays testable; `signal` stops the stream (Stop).
 */
export async function askSteve({ url, token, body, signal, onEvent, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let parsed = null;
    try { parsed = await response.json(); } catch { /* not JSON */ }
    throw errorFrom(response.status, parsed);
  }
  const feed = createEventParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const event of feed(decoder.decode(value, { stream: true }))) onEvent(event);
  }
  for (const event of feed(decoder.decode() + '\n\n')) onEvent(event);
}

/** POST JSON to a /steve endpoint with the reader's token; the parsed answer, or a typed SteveError (C20.8). */
export async function postSteve({ url, token, body, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { /* not JSON */ }
  if (!response.ok) throw errorFrom(response.status, parsed);
  return parsed;
}
