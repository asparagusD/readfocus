// The place in a scrolled book (C38.1, issue 22): pages laid out one under another, as Edge's PDF viewer does, and
// what is in view. No DOM, so it runs under node --test; the PDF surface (C38.2) feeds it page sizes and its scroll.
//
// A layout is { rows, height, numPages }: rows from the top, each { top, height, pages }, each page
// { page, left, top, width, height } in CSS pixels from the top of the scrolled content. Rows are one page, or two
// side by side (Page view, C38.4), page 1 alone first when the cover is shown alone.

/** The page numbers in each row: one a row, or pairs, the first page alone when `cover`. */
export function rowsOf(numPages, { columns = 1, cover = false } = {}) {
  const rows = [];
  let page = 1;
  if (columns === 2 && cover && numPages > 0) rows.push([page++]);
  while (page <= numPages) {
    const row = [page++];
    if (columns === 2 && page <= numPages) row.push(page++);
    rows.push(row);
  }
  return rows;
}

/**
 * Lays the pages out. `sizes[i]` is page i + 1's { width, height } in CSS pixels at the zoom shown; `gap` is the space
 * above the first row, between rows and pages, and below the last row; `width` is the scroll box's, for centring.
 */
export function layoutPages(sizes, { width = 0, gap = 16, columns = 1, cover = false } = {}) {
  const rows = [];
  let top = gap;
  for (const numbers of rowsOf(sizes.length, { columns, cover })) {
    const across = numbers.reduce((sum, n) => sum + sizes[n - 1].width, 0) + gap * (numbers.length - 1);
    const height = Math.max(...numbers.map((n) => sizes[n - 1].height));
    let left = Math.max(gap, (width - across) / 2);
    const pages = numbers.map((n) => {
      const { width: w, height: h } = sizes[n - 1];
      const placed = { page: n, left, top: top + (height - h) / 2, width: w, height: h };
      left += w + gap;
      return placed;
    });
    rows.push({ top, height, pages });
    top += height + gap;
  }
  return { rows, height: top, numPages: sizes.length };
}

/** The index of the last row whose top is at or above `y` (0 above the first). */
function rowAt(layout, y) {
  let lo = 0;
  let hi = layout.rows.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (layout.rows[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * What is in view with the box scrolled to `top` and `view` pixels high: `pages`, every page with some of it in
 * view, in order; `main`, the one with the most area in view (the first on a tie), which focus counts as the page
 * (D3, issue 22); and whether the first page's top or the last page's bottom is in view.
 */
export function pagesInView(layout, top, view) {
  const bottom = top + view;
  const pages = [];
  let main = null;
  let most = -1;
  if (!layout.rows.length) return { pages, main, atStart: true, atEnd: true };
  for (let i = rowAt(layout, top); i < layout.rows.length && layout.rows[i].top < bottom; i += 1) {
    for (const p of layout.rows[i].pages) {
      const seen = Math.min(bottom, p.top + p.height) - Math.max(top, p.top);
      if (seen <= 0) continue;
      pages.push(p.page);
      const area = seen * p.width;
      if (area > most) { most = area; main = p.page; }
    }
  }
  const first = layout.rows[0].pages[0];
  const last = layout.rows.at(-1);
  return { pages, main, atStart: top <= first.top, atEnd: bottom >= last.top + last.height };
}

/** The placed page `page`, or null. */
export function pageBox(layout, page) {
  for (const row of layout.rows) for (const p of row.pages) if (p.page === page) return p;
  return null;
}

/** The scroll that puts page `page`'s top at the top of the view (less the gap above it), clamped to the content. */
export function scrollToPage(layout, page, view = 0) {
  const box = pageBox(layout, Math.min(layout.numPages, Math.max(1, page)));
  if (!box) return 0;
  const row = layout.rows.find((r) => r.pages.includes(box));
  return clamp(layout, row.top - (layout.rows[0]?.top ?? 0), view);
}

const clamp = (layout, top, view) => Math.max(0, Math.min(top, layout.height - view));

/**
 * The point held while the zoom, the window or Page view changes: the page at the top of the view and how far down
 * it the view's top is (0 at its top, 1 at its bottom; below 0 in the gap above it, C38.4a), so the same words stay
 * at the top after the layout changes, and a view resting on the gap above a page keeps it.
 */
export function holdOf(layout, top) {
  if (!layout.rows.length) return { page: 1, fraction: 0 };
  const i = rowAt(layout, top);
  const row = layout.rows[i];
  const below = top > row.top + row.height ? layout.rows[i + 1] : null; // in the gap: the next row
  const at = below ?? row;
  const p = at.pages[0];
  return { page: p.page, fraction: Math.min(1, (top - p.top) / p.height) };
}

/** The scroll that puts a held point back at the top of the view in a new layout. */
export function scrollForHold(layout, { page, fraction }, view = 0) {
  const box = pageBox(layout, page);
  return box ? clamp(layout, box.top + fraction * box.height, view) : 0;
}

/**
 * The scroll for one step (Arrow keys, Page Up and Down, issue 22): forward, the next row's top below the view's
 * top; back, the top of the row the view starts in, else the row before. Edge does this at fit-page.
 */
export function stepScroll(layout, top, view, dir) {
  const gap = layout.rows[0]?.top ?? 0;
  const at = (i) => clamp(layout, layout.rows[i].top - gap, view);
  if (!layout.rows.length) return 0;
  const i = rowAt(layout, top + gap);
  if (dir > 0) return i + 1 < layout.rows.length ? at(i + 1) : clamp(layout, layout.height, view);
  if (at(i) < top - 1) return at(i);
  return i > 0 ? at(i - 1) : 0;
}

/**
 * An EPUB's main page in a scrolled section (D3): of the stable location pages (frame.js buildLocations) that the
 * visible characters `charStart`-`charEnd` of section `index` cover, the one with the most of them; the first on a
 * tie. Null before the locations exist.
 */
export function epubMain(locations, index, charStart, charEnd) {
  const base = locations?.starts?.[index];
  if (base === undefined) return null;
  const from = base + Math.max(0, charStart);
  const to = Math.max(from + 1, base + charEnd);
  const per = locations.perPage;
  let main = null;
  let most = 0;
  for (let page = Math.floor(from / per); page * per < to; page += 1) {
    const covered = Math.min(to, (page + 1) * per) - Math.max(from, page * per);
    if (covered > most) { most = covered; main = page + 1; }
  }
  return main === null ? null : Math.min(locations.total, main);
}
