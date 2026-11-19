// C35.3d (issue 16): a PDF or EPUB goes from this browser straight to Storage. Before, the file went
// browser -> our server -> Supabase, checked step by step on 0.1 CPU (33 s for 29 MB). Now:
// POST /books/upload-url (type, size and shelf checked) gives a signed upload URL for the reader's
// own path; the file is sent there with progress; POST /books/register checks what arrived and
// starts the book's processing. The file is then kept in this browser under its own sha256, so its
// first open reads nothing from the network (fileCache.js).

const MIME = { pdf: 'application/pdf', epub: 'application/epub+zip' };

/** The file types sent this way; Markdown, a .zip and notebooks are converted on the server (/books/upload). */
export const DIRECT = Object.keys(MIME);

/**
 * PUT `file` to the signed upload `url`, calling `onProgress(0-100)` as it goes. Resolves when Storage
 * has it; rejects with Storage's message otherwise. XHR, since fetch reports no upload progress.
 */
export function putFile(url, file, { type, onProgress = () => {}, apikey, XHR = globalThis.XMLHttpRequest } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XHR();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    if (apikey) xhr.setRequestHeader('apikey', apikey); // the publishable key: the URL's token is the permission
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100))); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `the upload failed (HTTP ${xhr.status})`;
      try { message = JSON.parse(xhr.responseText).message || message; } catch { /* not JSON */ }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('the connection dropped during the upload'));
    xhr.send(file);
  });
}

/**
 * Add `file` to the shelf the direct way: { book_id, author, ... } from POST /books/register.
 * `keep(bookId, bytes, sha256)` keeps the file in this browser; it never makes the upload fail.
 */
export async function uploadBook(file, { title, author }, { api, put = putFile, hash, keep, onProgress, apikey }) {
  const ext = file.name.split('.').pop().toLowerCase();
  const signed = await api('/books/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, size: file.size }) });
  await put(signed.upload_url, file, { type: MIME[signed.file_type] || MIME[ext], onProgress, apikey });
  const made = await api('/books/register', { method: 'POST', body: JSON.stringify({
    book_id: signed.book_id, file_type: signed.file_type, title, author }) });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await keep(made.book_id, bytes, await hash(bytes));
  } catch { /* not kept: the first open downloads it, as before */ }
  return made;
}
