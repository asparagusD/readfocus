/**
 * Where word lookup stays quiet on a PDF page (C18.6d): the boxes of its math, code, figures,
 * tables and inline math from GET /books/{id}/regions, in PDF points from the page's top-left
 * (ANCHORS A1), asked for REGION_BATCH pages at a time. Before a batch arrives, or if it fails,
 * nothing is skipped: the reader's lookup works as before the region map.
 */
export const REGION_BATCH = 20; // the regions job's batch, and the endpoint's limit

export const batchOf = (page) => {
  const first = Math.floor((page - 1) / REGION_BATCH) * REGION_BATCH + 1;
  return [first, first + REGION_BATCH - 1];
};

/** A client point as PDF points on a page drawn at `scale` CSS px per point, whose box is `rect`. */
export const toPagePoint = (rect, scale, x, y) => ({ x: (x - rect.left) / scale, y: (y - rect.top) / scale });

export function createRegionSource(api, bookId) {
  const boxes = new Map(); // page -> [[x0, top, x1, bottom]]
  const batches = new Map(); // first page -> promise

  function load(page) {
    const [first, last] = batchOf(page);
    if (!batches.has(first)) {
      const asked = api(`/books/${bookId}/regions?first=${first}&last=${last}`)
        .then(({ regions = [] } = {}) => {
          for (const { page: p, bbox } of regions) {
            if (!boxes.has(p)) boxes.set(p, []);
            boxes.get(p).push(bbox);
          }
        })
        .catch(() => { batches.delete(first); }); // asked again next time
      batches.set(first, asked);
    }
    return batches.get(first);
  }

  const hits = (page, x, y) => (boxes.get(page) ?? [])
    .some(([x0, top, x1, bottom]) => x >= x0 && x <= x1 && y >= top && y <= bottom);

  return { load, hits };
}

/** True when client point (x, y) is on a shown PDF page inside one of its skipped boxes. */
export function skipPdfPoint(source, x, y, doc = document) {
  for (const el of doc.querySelectorAll('.rf-pdf-page[data-scale]')) {
    const rect = el.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    const p = toPagePoint(rect, Number(el.dataset.scale), x, y);
    return source.hits(Number(el.dataset.page), p.x, p.y);
  }
  return false;
}
