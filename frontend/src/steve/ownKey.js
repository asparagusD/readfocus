/**
 * The reader's own Gemini key (C20.3): the pure parts of the form, so Node's runner can test them.
 * The key itself is sent once to PUT /steve/key and then dropped; the server only ever returns
 * {has_key, last4}.
 */

export const AI_STUDIO_KEYS_URL = 'https://aistudio.google.com/apikey';

/** A pasted key without the spaces and line breaks copying adds; '' when nothing is left. */
export function cleanKey(raw) {
  return String(raw ?? '').replace(/\s+/g, '');
}

/** Whether the cleaned key is worth sending: the server and Google decide the rest. */
export function canSend(raw) {
  return /^[A-Za-z0-9_-]{30,100}$/.test(cleanKey(raw));
}

/** How a saved key is named on screen: its last four characters only. */
export function savedKeyLabel(last4) {
  return last4 ? `Key ending in ${last4}` : 'No key saved';
}

/** The server's word for a refused key, else a plain fallback (never the key). */
export function saveError(error) {
  const detail = error && typeof error.message === 'string' ? error.message : '';
  return detail && detail !== 'API request failed' ? detail : 'The key could not be saved. Try again in a minute.';
}
