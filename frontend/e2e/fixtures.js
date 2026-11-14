// Offline fixtures for the reader e2e (C12.10; the original view since C17.5): a stored Supabase
// session that never refreshes, and every backend call answered from a fixture book in
// e2e/fixtures/books, a PDF or an illustrated EPUB (the `book` option). Nothing leaves the
// machine; any call that is not mocked fails the test that made it.
import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';

export const BOOK = 'e2e-book';
export const GOOD_KEY = 'AIzaSyReaderOwnKey-not-real-abcdefghij12'; // a made-up Gemini key (C20.3)
export const STEVE_NOTICE = { version: '2026-11-14', terms_url: 'https://aistudio.google.com/docs/terms',
  text: "Steve is a study assistant built on Google's Gemini.\n\nYou can turn Steve off at any time in his settings." };

/** A whole /steve/ask stream (C20.7b): start, the text in a few tokens, done with the checked text and citations. */
export function steveStream(text, citations = [], { pages = ['p. 1', 'p. 2'], tokens = 3, finalText = null } = {}) {
  const size = Math.ceil(text.length / tokens);
  const events = [['start', { thread_id: 'thread-1', pages }]];
  for (let i = 0; i < text.length; i += size) events.push(['token', { text: text.slice(i, i + size) }]);
  events.push(['done', { message_id: 'm-1', thread_id: 'thread-1', text: finalText ?? text, citations,
    usage: { model: 'gemini-test', tokens_in: 100, tokens_out: 20, cached: false } }]);
  return { sse: events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('') };
}

const API = 'http://localhost:8000';
const SUPABASE_REF = 'lvfhuszvuiowyeizstru'; // frontend/.env's project, as baked into the build
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

export const LOOKUPS = {
  lamp: { term: 'lamp', phonetic: '/læmp/', audio_url: null, source: 'dictionary', found: true, ambiguous: false, url: null, wiki: null,
    meanings: [{ part_of_speech: 'noun', definitions: ['A device for giving light.'], example: 'A lamp on the desk.' }] },
  Signals: { term: 'Signals', phonetic: null, audio_url: null, source: 'wikipedia', found: true, ambiguous: false, meanings: [],
    url: 'https://en.wikipedia.org/wiki/Signal',
    wiki: { title: 'Signal', description: 'Function that conveys information',
      extract: 'A signal is a function that conveys information about a phenomenon.',
      url: 'https://en.wikipedia.org/wiki/Signal', thumbnail_url: null } },
};

// The fixture books (tools/make_reader_fixtures.py) and the chunks the server would have cut from them.
const PDF_TITLES = ['Preface', 'A second front page', 'Chapter 1 Signals', 'More on signals', 'Chapter 2 Noise', 'The end'];
const pdfPage = (n) => [PDF_TITLES[n - 1], ...Array.from({ length: 14 }, (_, r) => `Line ${r + 1} of page ${n}: the lamp threw a small circle of light.`)].join('\n');
const PARA = 'The lamp on the desk threw a small circle of light, and inside it the page was the only thing that mattered. '.repeat(6).trim();
const epubChapter = (n) => `Chapter ${n}\n\n${PARA}\n\n${PARA}`;
export const BOOKS = {
  // Today: pages 1-5 (chunks 0-2); the next chunk starts on page 6.
  pdf: { file: 'sample.pdf', type: 'application/pdf', today: [0, 1, 2],
    chunks: [pdfPage(1) + pdfPage(2), pdfPage(3) + pdfPage(4), pdfPage(5), pdfPage(6)] },
  // Today: chapters 1 and 2 (after the cover); the next chunk is chapter 3.
  epub: { file: 'reflow.epub', type: 'application/epub+zip', today: [0, 1], chunks: [epubChapter(1), epubChapter(2), epubChapter(3)] },
};
const FILES = new URL('./fixtures/books/', import.meta.url);
const chunk = (book, chunk_index) => ({ id: `chunk-${chunk_index}`, chunk_index, content: BOOKS[book].chunks[chunk_index], blocks: null });

const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Routes for one page: the API remembers the saved position across reloads, like the server. */
async function mockBackend(page, api, book) {
  const { file, type, today, chunks } = BOOKS[book];
  await page.route(/supabase\.co/, (route) => { api.unmocked.push(route.request().url()); return route.abort(); });
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/health') return json(route, { status: 'ok', model_ready: true, timestamp: '2026-11-11T20:00:00' });
    if (path === '/auth/profile') return json(route, { id: 'e2e-reader', is_calibrated: true, wpm: 240 });
    if (path === '/books' && request.method() === 'GET') return json(route, []);
    if (path === '/dashboard') return json(route, { book_progress: [], score_over_time: [], reading_streak: 0, words_this_week: 0, recent_feedback: [] });
    if (path === '/sessions/start') {
      api.starts += 1;
      if (BOOKS[book].pagesOnly) { // C19.4: a fully scanned book with no chunks opens pages-only
        return json(route, { session_id: null, pages_only: true, chunk_indices: [], chunks: [], position: null,
          focus_duration_minutes: 0, reason: '', chapter_before: null, scanned_pages: BOOKS[book].scanned,
          book: { title: 'Scanned', author: 'A Scanner', toc: [], format: 'pdf', storage_mode: 'cloud' } });
      }
      return json(route, {
        session_id: 'e2e-session', chunks: today.map((i) => chunk(book, i)), chunk_indices: today, position: api.position,
        focus_duration_minutes: 20, reason: 'A steady pace for this book.', chapter_before: '',
        book: { title: 'Walden', author: 'Henry David Thoreau', toc: [], format: BOOKS[book].format ?? book, storage_mode: 'cloud' },
      });
    }
    if (path === '/sessions/e2e-session/position') {
      api.position = JSON.parse(request.postData() || 'null');
      api.saves += 1;
      return json(route, { position: api.position });
    }
    if (path === `/books/${BOOK}/contents`) return json(route, { toc: [], toc_source: 'none', total_chunks: 3 });
    if (path === `/books/${BOOK}/pages`) {
      const start = Number(url.searchParams.get('start'));
      return json(route, { chunks: start < chunks.length ? [chunk(book, start)] : [] });
    }
    if (path === `/books/${BOOK}/file`) return json(route, { url: `${API}/e2e-files/${file}` });
    if (path === `/e2e-files/${file}`) {
      api.fileLoads += 1;
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': type }, body: readFileSync(BOOKS[book].source ?? new URL(file, FILES)) });
    }
    if (path === `/books/${BOOK}/regions`) { // C18.6d: boxes word lookup skips; none unless a test sets them
      api.regionAsks += 1;
      return json(route, { regions: api.regions });
    }
    if (path === `/books/${BOOK}/ocr`) { // C19.4: scanned pages, as a book's BOOKS entry lists them
      const scanned = BOOKS[book].scanned ?? [];
      if (request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        api.ocrPosts.push({ ...body, at: Date.now() });
        api.ocr.set(body.page, (body.words ?? []).filter((w) => w.c >= 60).map(({ t, b, c }) => ({ t, b, c })));
        const reingest = scanned.every((p) => api.ocr.has(p)) && Boolean(BOOKS[book].pagesOnly);
        return json(route, { page: body.page, words: api.ocr.get(body.page).length, dropped: 0, done: api.ocr.size, scanned: scanned.length, reingest });
      }
      const first = Number(url.searchParams.get('first'));
      const last = Number(url.searchParams.get('last'));
      const pages = first ? [...api.ocr].filter(([p]) => p >= first && p <= last).map(([p, words]) => ({ page: p, words })) : undefined;
      return json(route, { scanned_pages: scanned, done: [...api.ocr.keys()], ...(pages ? { pages } : {}) });
    }
    if (path === `/books/${BOOK}/status`) return json(route, { status: 'processing', total_chunks: 0 });
    if (path === '/lookup') {
      const term = url.searchParams.get('term');
      api.lookups.push({ term, proper: url.searchParams.get('proper') === '1' });
      return json(route, LOOKUPS[term] ?? { term, found: false, meanings: [], wiki: null, ambiguous: false });
    }
    if (path === '/steve/settings') { // C20.7b: consent and the off switch, as the server keeps them
      if (request.method() === 'PUT') {
        const change = request.postDataJSON();
        api.steve.puts.push(change);
        if ('enabled' in change) api.steve.enabled = change.enabled;
        if (change.consent === true) api.steve.consented = true;
        if (change.consent === false) api.steve.consented = false;
      }
      return json(route, { enabled: api.steve.enabled, consent: { given: api.steve.consented, current: api.steve.consented,
        at: null, version: api.steve.consented ? STEVE_NOTICE.version : null }, notice: STEVE_NOTICE });
    }
    if (path === '/steve/ask') { // C20.7b: the next queued reply, as SSE text or a refusal {status, detail}
      api.steve.asks.push(request.postDataJSON());
      const reply = api.steve.replies.shift() ?? steveStream('He counts twice [p. 2].', [{ label: 'p. 2', anchor: { kind: 'pdf', page: 2 } }]);
      if (reply.status) return json(route, { detail: reply.detail }, reply.status);
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'text/event-stream' }, body: reply.sse });
    }
    if (path === '/steve/latex') { // C20.8: a PDF equation as LaTeX, or the queued refusal
      api.steve.latexAsks.push(request.postDataJSON());
      const reply = api.steve.latexReplies.shift() ?? { latex: String.raw`a_n = \frac{1}{\pi}`, cached: false, model: 'gemini-test' };
      if (reply.status) return json(route, { detail: reply.detail }, reply.status);
      return json(route, reply);
    }
    if (path === `/books/${BOOK}/region-at`) { // C20.8c: an EPUB region by section and element path
      const detail = api.regionAt[`${url.searchParams.get('spine_index')}:${url.searchParams.get('path')}`];
      api.regionAtAsks.push(`${url.searchParams.get('spine_index')}:${url.searchParams.get('path')}`);
      return detail ? json(route, detail) : json(route, { detail: 'Region not found' }, 404);
    }
    if (path.startsWith(`/books/${BOOK}/regions/`)) { // C20.8: one region's details
      const detail = api.regionDetails[path.split('/').pop()];
      return detail ? json(route, detail) : json(route, { detail: 'Region not found' }, 404);
    }
    if (path === `/books/${BOOK}/annotations`) { // C21.2: highlights and underlines, kept like the server keeps them
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        api.annotationPosts.push(body);
        if (api.annotationFail) return json(route, { detail: 'Not saved' }, api.annotationFail);
        const row = { id: `ann-${api.annotations.length + 1}`, ...body, orphaned: false,
          text_snapshot: body.anchors.map((a) => a.text).join(' ') };
        api.annotations.push(row);
        return json(route, row, 201);
      }
      return json(route, { annotations: api.annotations });
    }
    if (path === '/steve/key') { // C20.3: GOOD_KEY is accepted, anything else is what Google refuses
      if (request.method() === 'PUT') {
        const { key } = request.postDataJSON();
        api.steveKeyPuts.push(key);
        if (key !== GOOD_KEY) return json(route, { detail: 'Google did not accept this key. Check that you copied all of it, from Google AI Studio.' }, 400);
        api.steveKey = key.slice(-4);
      }
      if (request.method() === 'DELETE') api.steveKey = null;
      return json(route, { has_key: api.steveKey !== null, last4: api.steveKey });
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
  // The book the reading page opens: 'pdf' (sample.pdf) or 'epub' (reflow.epub, illustrated).
  book: ['pdf', { option: true }],
  // auto: every test gets the mocks and the session, whether or not it reads `api`.
  api: [async ({ page, signedIn, book }, use, info) => {
    const api = { position: null, saves: 0, starts: 0, lookups: [], unmocked: [], fileLoads: 0, regions: [], regionAsks: 0, ocr: new Map(), ocrPosts: [], steveKey: null, steveKeyPuts: [],
      steve: { consented: false, enabled: true, puts: [], asks: [], replies: [], latexAsks: [], latexReplies: [] },
      regionDetails: {}, regionAt: {}, regionAtAsks: [], annotations: [], annotationPosts: [], annotationFail: null };
    const trail = []; // printed when a test fails: what the page said and asked for
    page.on('console', (m) => trail.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    if (process.env.E2E_TRACE) page.on('console', (m) => console.log('PAGE', m.type(), m.text().slice(0, 300)));
    if (process.env.E2E_TRACE) page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV', f.url()); });
    page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4174')) trail.push(`${r.method()} ${r.url().slice(0, 120)}`); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) trail.push(`navigated ${f.url()}`); });
    await mockBackend(page, api, book);
    if (signedIn) await signIn(page);
    await use(api);
    if (info.status !== info.expectedStatus) console.log([`--- ${info.title}`, ...trail].join(String.fromCharCode(10)));
    expect(api.unmocked, 'calls the e2e fixtures do not answer').toEqual([]);
  }, { auto: true }],
});
export { expect };

/** Open today's reading and wait until the book stands at its first place. */
export async function openReader(page) {
  await page.goto(`/read/${BOOK}`);
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300); // an EPUB lays out again once its fonts are in
}

/** The polite page announcement, e.g. "pp. ii–1 of 6" or "End of today's reading". */
export const spoken = (page) => page.locator('.rf-ov-live');

/** The book on the page: focus it before keys. */
export const book = (page) => page.locator('.rf-ov-stage');

/** The place shown: { start, end } as the frame reports them ("5", or "2:340" for an EPUB). */
export const shown = (page) => page.locator('.rf-ov').evaluate((el) => ({ start: el.dataset.start, end: el.dataset.end }));

/**
 * The place shown once a turn has landed (DEBUG_LOG C17.6): no leaf turning and the same place on two
 * reads 300 ms apart, different from `away` when given. A place read at the first change can be one
 * the renderer moves past a moment later.
 */
export async function settled(page, away = null) {
  let last = null;
  await expect.poll(async () => {
    const leaves = await page.locator('.rf-ov-leaf').count();
    const now = JSON.stringify(await shown(page));
    const ok = leaves === 0 && now === last && now !== JSON.stringify(away);
    last = now;
    return ok;
  }, { intervals: [300], timeout: 10_000 }).toBe(true);
  return JSON.parse(last);
}

/** The boxes of every whole-word occurrence of `w` in a document's book text (the PDF's spread, or a section's body). */
function wordBoxes(w) {
  const root = document.querySelector('.rf-pdf-spread') ?? (document.querySelector('.rf-ov') ? null : document.body);
  if (!root) return [];
  const boxes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const pattern = new RegExp(`\\b${w}\\b`, 'g');
    for (let match = pattern.exec(node.data); match; match = pattern.exec(node.data)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + w.length);
      const r = range.getClientRects()[0];
      if (r) boxes.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
  }
  return boxes;
}

/**
 * The first visible occurrence of a word in the book's text, in page coordinates: { x, y } at its
 * centre and its box. An EPUB's sections are iframes in foliate's closed shadow roots, so they are
 * reached as Playwright frames and shifted by their frame element's box.
 */
export async function wordPoint(page, word) {
  const view = await page.locator('.rf-ov-book').boundingBox();
  const frames = page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached());
  for (const frame of frames.length ? frames : [page.mainFrame()]) {
    const offset = frame === page.mainFrame() ? { x: 0, y: 0 } : await (await frame.frameElement()).boundingBox();
    if (!offset) continue;
    for (const r of await frame.evaluate(wordBoxes, word)) {
      const box = { left: offset.x + r.left, right: offset.x + r.right, top: offset.y + r.top, bottom: offset.y + r.bottom };
      const x = (box.left + box.right) / 2;
      const y = (box.top + box.bottom) / 2;
      if (x > view.x + 2 && x < view.x + view.width - 2 && y > view.y + 2 && y < view.y + view.height - 2) return { x, y, ...box };
    }
  }
  return null;
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
