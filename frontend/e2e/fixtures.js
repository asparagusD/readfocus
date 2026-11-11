// Offline fixtures for the reader e2e (C12.10): a stored Supabase session that never refreshes,
// and every backend call answered from the Walden fixture. Nothing leaves the machine; any call
// that is not mocked fails the test that made it.
import { test as base, expect } from '@playwright/test';
import { WALDEN_BLOCKS } from '../src/gallery/readerFixture.js';

export const BOOK = 'e2e-book';
const API = 'http://localhost:8000';
const SUPABASE_REF = 'lvfhuszvuiowyeizstru'; // frontend/.env's project, as baked into the build
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

export const LOOKUPS = {
  woods: { term: 'woods', phonetic: '/wʊdz/', audio_url: null, source: 'dictionary', found: true, ambiguous: false, url: null, wiki: null,
    meanings: [{ part_of_speech: 'noun', definitions: ['A dense collection of trees covering a relatively small area.'], example: 'A walk in the woods.' }] },
  Concord: { term: 'Concord', phonetic: null, audio_url: null, source: 'wikipedia', found: true, ambiguous: false, meanings: [],
    url: 'https://en.wikipedia.org/wiki/Concord,_Massachusetts',
    wiki: { title: 'Concord, Massachusetts', description: 'Town in Massachusetts, United States',
      extract: 'Concord is a town in Middlesex County, Massachusetts. Thoreau was born there in 1817.',
      url: 'https://en.wikipedia.org/wiki/Concord,_Massachusetts', thumbnail_url: null } },
};

/** Today's three chunks, as /sessions/start returns them (blocks grouped by their chunk). */
function chunks() {
  const byChunk = new Map();
  for (const block of WALDEN_BLOCKS) {
    const index = Number(block.id.split('.')[0]);
    byChunk.set(index, [...(byChunk.get(index) ?? []), block]);
  }
  return [...byChunk].map(([chunk_index, blocks]) => ({
    id: `chunk-${chunk_index}`, chunk_index, blocks, content: blocks.map((b) => b.text).join('\n\n'),
  }));
}

const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Routes for one page: the API remembers the saved position across reloads, like the server. */
async function mockBackend(page, api) {
  await page.route(/supabase\.co/, (route) => { api.unmocked.push(route.request().url()); return route.abort(); });
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/auth/profile') return json(route, { id: 'e2e-reader', is_calibrated: true, wpm: 240 });
    if (path === '/books' && request.method() === 'GET') return json(route, []);
    if (path === '/dashboard') return json(route, { book_progress: [], score_over_time: [], reading_streak: 0, words_this_week: 0, recent_feedback: [] });
    if (path === '/sessions/start') {
      api.starts += 1;
      return json(route, {
        session_id: 'e2e-session', chunks: chunks(), chunk_indices: [0, 1, 2], position: api.position,
        focus_duration_minutes: 20, reason: 'A steady pace for this book.', chapter_before: '',
        book: { title: 'Walden', author: 'Henry David Thoreau' },
      });
    }
    if (path === '/sessions/e2e-session/position') {
      api.position = JSON.parse(request.postData() || 'null');
      api.saves += 1;
      return json(route, { position: api.position });
    }
    if (path === `/books/${BOOK}/contents`) return json(route, { toc: [], toc_source: 'none', total_chunks: 3 });
    if (path === `/books/${BOOK}/pages`) return json(route, { chunks: [] });
    if (path === '/lookup') {
      const term = url.searchParams.get('term');
      api.lookups.push({ term, proper: url.searchParams.get('proper') === '1' });
      return json(route, LOOKUPS[term] ?? { term, found: false, meanings: [], wiki: null, ambiguous: false });
    }
    api.unmocked.push(`${request.method()} ${path}`);
    return json(route, { detail: 'not mocked' }, 404);
  });
}

/** A signed-in reader for the app: a session in Supabase's storage that is far from expiring. */
async function signIn(page) {
  const session = {
    access_token: 'e2e-token', refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
    user: { id: 'e2e-reader', aud: 'authenticated', role: 'authenticated', email: 'reader@e2e.test', app_metadata: {}, user_metadata: {} },
  };
  await page.addInitScript(([key, value]) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
  }, [`sb-${SUPABASE_REF}-auth-token`, JSON.stringify(session)]);
}

export const test = base.extend({
  // A spec that starts signed out (the sign-in page) sets test.use({ signedIn: false }).
  signedIn: [true, { option: true }],
  // auto: every test gets the mocks and the session, whether or not it reads `api`.
  api: [async ({ page, signedIn }, use, info) => {
    const api = { position: null, saves: 0, starts: 0, lookups: [], unmocked: [] };
    const trail = []; // printed when a test fails: what the page said and asked for
    page.on('console', (m) => trail.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    if (process.env.E2E_TRACE) page.on('console', (m) => console.log('PAGE', m.type(), m.text().slice(0, 300)));
    if (process.env.E2E_TRACE) page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV', f.url()); });
    page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4174')) trail.push(`${r.method()} ${r.url().slice(0, 120)}`); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) trail.push(`navigated ${f.url()}`); });
    await mockBackend(page, api);
    if (signedIn) await signIn(page);
    await use(api);
    if (info.status !== info.expectedStatus) console.log([`--- ${info.title}`, ...trail].join(String.fromCharCode(10)));
    expect(api.unmocked, 'calls the e2e fixtures do not answer').toEqual([]);
  }, { auto: true }],
});
export { expect };

/** Open today's reading and wait for the book and its fonts. */
export async function openReader(page) {
  await page.goto(`/read/${BOOK}`);
  await page.locator('.rf-viewport .rf-flow p').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300); // the first pagination after fonts
}

/** The polite page announcement, e.g. "Pages 3 and 4 of 9". */
export const spoken = (page) => page.locator('.rf-live').first();

/** The centre of the first visible occurrence of a word in the book's text. */
export async function wordPoint(page, word) {
  return page.evaluate((w) => {
    const flow = document.querySelector('.rf-viewport .rf-flow');
    const vp = document.querySelector('.rf-viewport').getBoundingClientRect();
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      let i = -1;
      while ((i = node.data.indexOf(w, i + 1)) >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + w.length);
        const r = range.getClientRects()[0];
        if (r && r.left >= vp.left && r.right <= vp.right && r.top >= vp.top && r.bottom <= vp.bottom) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom };
        }
      }
    }
    return null;
  }, word);
}

/**
 * Milliseconds from the pointer reaching (x, y) to a card of `kind` in the page, measured inside the
 * page (pointermove to the DOM change), so Playwright's own polling does not count.
 */
export async function timeToCard(page, { x, y }, kind = 'definition') {
  await page.evaluate((k) => {
    window.__cardTime = new Promise((resolve) => {
      let start = null;
      const onMove = () => { start ??= performance.now(); };
      document.addEventListener('pointermove', onMove, { capture: true });
      const seen = () => {
        if (start === null || !document.querySelector(`.rf-wordcard[data-kind="${k}"]`)) return;
        observer.disconnect();
        document.removeEventListener('pointermove', onMove, { capture: true });
        resolve(Math.round(performance.now() - start));
      };
      const observer = new MutationObserver(seen);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-kind'] });
    });
  }, kind);
  await page.mouse.move(x, y);
  return page.evaluate(() => window.__cardTime);
}
