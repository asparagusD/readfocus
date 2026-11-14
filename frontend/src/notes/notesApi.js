import { fetchApi } from '../lib/api';

/** The note blocks API (C22.1, backend/routers/notes.py). A failed call throws with `status` and `detail`. */
export const notesApi = {
  list: (bookId) => fetchApi(`/books/${bookId}/notes`).then((data) => data.notes ?? []),
  create: (bookId, body) => fetchApi(`/books/${bookId}/notes`, { method: 'POST', body: JSON.stringify(body) }),
  /** A change made on `version`: 409 (detail.version) when another tab saved first. */
  save: (id, change, version) => fetchApi(`/notes/${id}`, {
    method: 'PATCH', body: JSON.stringify(change), headers: { 'If-Match': `"${version}"` },
  }),
  remove: (id) => fetchApi(`/notes/${id}`, { method: 'DELETE' }),
};
