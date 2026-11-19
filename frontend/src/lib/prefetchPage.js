// C35.5d (issue 20): a page's code and data before the reader gets there. Pointing at a nav link (hover or
// focus) loads that page's chunk and asks for its data (read-only GETs, unlike a book's /open); once the
// browser is idle the three tab pages' code is loaded too, so a first visit does not wait for it either.

import { load } from './pageData.js'; // with its extension, for Node's test runner

const PAGES = {
  '/': { code: () => import('../pages/Library'), data: ['/books'] },
  '/dashboard': { code: () => import('../pages/Dashboard'), data: ['/dashboard', '/badges'] },
  '/league': { code: () => import('../pages/League'), data: ['/leagues/current'] },
};

/** Load `to`'s code and data now; never throws (the page loads them itself anyway). */
export function prefetchPage(to, { pages = PAGES, get = load } = {}) {
  const page = pages[to];
  if (!page) return;
  page.code().catch(() => {});
  for (const path of page.data) get(path).catch(() => {}); // still on its way, the page shares it; answered, it shows at once
}

/** Props for a link to `to`: prefetch on hover or focus. */
export function prefetchProps(to) {
  return { onPointerEnter: () => prefetchPage(to), onFocus: () => prefetchPage(to) };
}

/** When the browser is idle, load every tab page's code (not their data). */
export function prefetchCodeWhenIdle({ pages = PAGES, idle = globalThis.requestIdleCallback } = {}) {
  const run = () => Object.values(pages).forEach((page) => page.code().catch(() => {}));
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 1000);
}
