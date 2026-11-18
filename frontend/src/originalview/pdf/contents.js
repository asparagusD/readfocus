// A PDF's contents without walking its outline (C34.2, issue 12). Resolving every outline
// entry to a page in the browser reads the PDF's page tree, scattered through the file:
// 20 MB in about 300 range requests for a 771-page book. Ingestion already stored the
// same outline with its pages (`books.toc`, backend/services/book_structure.py
// pdf_contents), and GET /books/{id}/open returns it.

/**
 * The stored contents as [{ title, page }] (1-based pages), or null when they cannot stand in
 * for the outline: none stored, or headings found in the text (no pages) rather than the outline.
 */
export function storedOutline(toc) {
  if (!Array.isArray(toc) || toc.length === 0) return null;
  const usable = toc.every((entry) => typeof entry?.title === 'string' && Number.isInteger(entry.page) && entry.page >= 1);
  return usable ? toc.map(({ title, page }) => ({ title, page })) : null;
}

/** The page a saved place opens at: its page for a PDF place, else 1. */
export function startPage(anchor) {
  return anchor?.kind === 'pdf' && Number.isInteger(anchor.page) && anchor.page >= 1 ? anchor.page : 1;
}
