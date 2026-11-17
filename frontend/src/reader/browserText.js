// Books over 50 MB stay on this device (C26.7): the browser reads each page's text (pdf.js for a PDF, an EPUB's
// spine documents through foliate-js) and sends only that, in batches, to POST /books/{id}/pages. The server
// never holds the file. pdf.js and foliate-js are loaded only when such a book is added.

export const SERVER_MAX_BYTES = 50 * 1024 * 1024; // backend policy.MAX_BOOK_FILE_BYTES
export const DEVICE_MAX_BYTES = 300 * 1024 * 1024; // backend policy.MAX_DEVICE_BOOK_FILE_BYTES
export const MAX_PAGE_CHARS = 60_000; // backend policy.BROWSER_TEXT_MAX_PAGE_CHARS

/** True for a file the server does not take whole: its text is read here instead. */
export const isBig = (file) => file.size > SERVER_MAX_BYTES;

/** The file's SHA-256 as hex, as the server records for an uploaded file. */
export async function sha256Hex(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** One PDF page's text from pdf.js text items: each item's string, a line break where a line ends. */
export function itemsText(items) {
  return (items ?? []).map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join('').trim();
}

/** Each page's text of a PDF, in order; `pages(total)` is told the page count first. */
export async function* pdfTexts(file, { open, pages = () => {} } = {}) {
  const openPdf = open ?? (await import('../originalview/pdf/pdfjs')).openPdf;
  const doc = await openPdf({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    pages(doc.numPages);
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      yield itemsText((await page.getTextContent()).items);
      page.cleanup();
    }
  } finally {
    doc.destroy?.();
  }
}

/** Each spine document's text of an EPUB, in order; `pages(total)` is told the count first. */
export async function* epubTexts(file, { make, pages = () => {} } = {}) {
  const makeBook = make ?? (await import('../vendor/foliate-js/view.js')).makeBook;
  const book = await makeBook(file);
  pages(book.sections.length);
  for (const section of book.sections) {
    const doc = await section.createDocument();
    yield (doc.body?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    section.unload?.();
  }
}

/**
 * Send `texts` (an async iterable of page texts) in batches of `perBatch` through `post(body)`, where body is
 * { first, texts, last }. The last batch says so (the server then reads the book); a book with no pages still
 * sends one empty page. `progress(sent)` after each batch. Resolves the number of pages sent.
 */
export async function sendTexts(texts, { post, perBatch, progress = () => {} }) {
  let first = 1;
  let held = null; // a full batch is sent once the next page shows it is not the last
  let batch = [];
  const send = async (pages, last) => {
    await post({ first, texts: pages, last });
    first += pages.length;
    progress(first - 1);
  };
  for await (const text of texts) {
    batch.push((text ?? '').slice(0, MAX_PAGE_CHARS));
    if (batch.length === perBatch) {
      if (held) await send(held, false);
      held = batch;
      batch = [];
    }
  }
  if (batch.length) {
    if (held) await send(held, false);
    await send(batch, true);
  } else if (held) await send(held, true);
  else await send([''], true);
  return first - 1;
}
