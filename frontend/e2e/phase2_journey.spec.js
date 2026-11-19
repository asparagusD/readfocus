// The phase-2 reading journey (C25.3), live: a real sign-in, two real books, the original view, highlights, notes,
// focus mode, its quiz, points, XP, streak and league, against a real backend and the shared Supabase project.
// Not part of `npm run test:e2e` (playwright.config.js ignores it); run it with `npm run test:live:phase2`
// (playwright.phase2.config.js), only with approval: it writes to the shared project as test user A.
//
// Steve is mocked in the browser (every /steve/* request is answered here, so nothing reaches the backend's Steve or
// Google) unless STEVE_LIVE=1, which you allow per run. Everything else is real: uploads, ingestion, the region map,
// annotations, notes and their pictures, the focus session, the quiz and its grading, XP.
//
// The quiz is answered from the session's stored questions (read with the service key, on this machine only) so it
// passes and its points become XP. The daily goal is set to 20 XP for the run so a short session meets it (the
// streak), and set back after. Both books are deleted at the end (cascade, note pictures included).
//
// Local files the checks read (not in git): samples/technical/interactive-linear-algebra.pdf and
// alices-adventures-in-wonderland.epub (scripts/fetch_test_shelf.py); .venv's Python for the PDFium page compare
// (scripts/dev/g5_page_diff.py) and the EPUB's expected images and captions (scripts/dev/g5_epub_expect.py).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { signInAs } from './liveSignIn.js';
import { createClient } from '@supabase/supabase-js';
import { settled, STEVE_NOTICE, steveStream } from './fixtures.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHELF = `${ROOT}samples/technical/`;
const PDF = 'interactive-linear-algebra.pdf';
const EPUB = 'alices-adventures-in-wonderland.epub';
const SUPABASE_HOST = 'lvfhuszvuiowyeizstru.supabase.co';
const PYTHON = process.env.PYTHON ?? (existsSync(`${ROOT}.venv/Scripts/python.exe`) ? `${ROOT}.venv/Scripts/python.exe` : 'python');
const STEVE_LIVE = process.env.STEVE_LIVE === '1';
const RUN_GOAL = 20; // the lowest daily goal a reader may set (G5)

function env() {
  const vars = {};
  for (const file of [`${ROOT}.env`, `${ROOT}frontend/.env`, `${ROOT}.env.test`]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return { ...vars, ...process.env };
}

function python(args) {
  const out = spawnSync(PYTHON, args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: out.status === 0, text: `${out.stdout}${out.stderr}` };
}

/** FOCUS_RULES F10 as built (C23.5): questions = clamp(round(words / 400), 3, 15), halves up. */
const expectedCount = (words) => Math.min(15, Math.max(3, Math.floor(words / 400 + 0.5)));

test('the phase-2 journey, signed in, on the real stack', async ({ page, baseURL }) => {
  const vars = env();
  for (const key of ['TEST_USER_A_EMAIL', 'TEST_USER_A_PASSWORD', 'SUPABASE_SERVICE_KEY', 'VITE_SUPABASE_URL']) {
    if (!vars[key]) throw new Error(`${key} is needed (.env.test, .env, frontend/.env or the environment)`);
  }
  for (const file of [PDF, EPUB]) if (!existsSync(`${SHELF}${file}`)) throw new Error(`${file} is needed in samples/technical/`);
  const service = createClient(vars.VITE_SUPABASE_URL, vars.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const site = new URL(baseURL);
  const api = new URL(process.env.API_URL ?? (site.hostname === 'localhost' ? 'http://localhost:8000' : 'https://readfocus-api.onrender.com'));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const allowed = new Set([site.host, api.host, SUPABASE_HOST]);
  const hosts = new Map();
  const steps = [];
  let clock = Date.now();
  const step = (name) => { const now = Date.now(); steps.push([name, ((now - clock) / 1000).toFixed(1)]); clock = now; };
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol.startsWith('http')) hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1);
  });
  const isApi = (path, method) => (r) => r.url().startsWith(api.origin) && new URL(r.url()).pathname.match(path) && r.request().method() === method;
  const call = async (method, path, body) => {
    const r = await page.request.fetch(`${api.origin}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data: body });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  const out = mkdtempSync(join(tmpdir(), 'rf-phase2-'));

  // Steve, mocked unless allowed: the panel's settings, its key status and every answer come from here.
  const asks = [];
  let citePage = 1;
  if (!STEVE_LIVE) {
    await page.route(`${api.origin}/steve/**`, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (path === '/steve/settings') {
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({
          enabled: true, consent: { given: true, current: true, at: null, version: STEVE_NOTICE.version }, notice: STEVE_NOTICE }) });
      }
      if (path === '/steve/key') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '{"has_key":false,"last4":null}' });
      if (path === '/steve/ask') {
        asks.push(request.postDataJSON());
        const { sse } = steveStream(`The passage defines it on this page [p. ${citePage}].`, [{ label: `p. ${citePage}`, anchor: { kind: 'pdf', page: citePage } }]);
        return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'text/event-stream' }, body: sse });
      }
      return route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{"detail":"not mocked"}' });
    });
  }

  let token = null;
  const books = {};
  let goalBefore = null;
  try {
    // 0. The API and its model (a cold Render start).
    await expect.poll(async () => {
      try {
        const health = await page.request.get(`${api.origin}/health`, { timeout: 30_000 });
        return health.ok() && (await health.json()).model_ready === true;
      } catch { return false; }
    }, { timeout: 5 * 60_000, intervals: [5_000] }).toBe(true);
    step('API ready');

    // 1. Sign in, in Paper (the PDF canvas is compared with PDFium's white page).
    await page.addInitScript(() => localStorage.setItem('rf-theme', 'paper'));
    await signInAs(page, vars.TEST_USER_A_EMAIL, vars.TEST_USER_A_PASSWORD);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /^Your shelf/ })).toBeVisible({ timeout: 60_000 });
    token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
      return key ? JSON.parse(localStorage.getItem(key)).access_token : null;
    });
    expect(token, 'a Supabase session after sign-in').toBeTruthy();
    const before = (await call('GET', '/me/progress')).json;
    goalBefore = before.daily_goal;
    expect((await call('PUT', '/me/progress', { daily_goal: RUN_GOAL })).status, 'daily goal for the run').toBe(200);
    step('signed in');

    // 2. Upload both books and wait until each is ingested and its region map is built.
    for (const [kind, file, type] of [['pdf', PDF, 'application/pdf'], ['epub', EPUB, 'application/epub+zip']]) {
      await page.locator('input[type=file]').setInputFiles({ name: file, mimeType: type, buffer: readFileSync(`${SHELF}${file}`) });
      const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
      await dialog.getByLabel('Title').fill(`Phase 2 ${kind} ${stamp}`);
      await dialog.getByLabel('Author').fill('ReadFocus phase-2 journey');
      const uploaded = page.waitForResponse(isApi(/^\/books\/register$/, 'POST'), { timeout: 180_000 });
      await dialog.getByRole('button', { name: 'Add book' }).click();
      const response = await uploaded;
      expect(response.status(), `POST /books/register (${file})`).toBe(200);
      books[kind] = (await response.json()).book_id;
      await expect(dialog).toBeHidden();
    }
    for (const [kind, id] of Object.entries(books)) {
      await expect.poll(async () => {
        const jobs = (await service.from('processing_jobs').select('kind, status').eq('book_id', id)).data ?? [];
        return jobs.some((j) => j.kind === 'regions' && j.status === 'done') && jobs.every((j) => j.status === 'done');
      }, { message: `${kind} ingested with its region map`, timeout: 25 * 60_000, intervals: [10_000] }).toBe(true);
    }
    step('both books ingested, region maps built');

    // 3. The math-heavy PDF: its equation pages, as the original view draws them, match PDFium's render.
    const reading = page.waitForResponse(isApi(new RegExp(`^/books/${books.pdf}/open$`), 'GET'), { timeout: 120_000 });
    await page.goto(`/read/${books.pdf}`);
    expect((await reading).status(), 'GET /books/{id}/open').toBe(200); // C26.5: no session
    await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
    const regions = (await call('GET', `/books/${books.pdf}/regions?first=1&last=20`)).json.regions;
    const mathPages = [...new Set(regions.filter((r) => r.kind === 'math' && !r.inline).map((r) => r.page))].slice(0, 2);
    expect(mathPages.length, 'display equations in the first 20 pages').toBeGreaterThan(0);
    const stage = page.locator('.rf-ov-stage');
    const goTo = async (target) => {
      for (let turn = 0; turn < 60; turn += 1) {
        const at = await settled(page);
        if (Number(at.start) <= target && target <= Number(at.end)) return at;
        await stage.focus();
        await page.keyboard.press(Number(at.end) < target ? 'ArrowRight' : 'ArrowLeft');
      }
      throw new Error(`page ${target} not reached`);
    };
    // The toolbar fades after 2.6 s without mouse movement and page-turn keys do not wake it (useChromeVisible):
    // move the mouse, as a reader does, before reaching for it.
    const wake = async () => { await page.mouse.move(400, 300); await page.mouse.move(420, 310, { steps: 3 }); };
    let scale = null;
    for (const n of mathPages) {
      await goTo(n);
      const pageEl = page.locator(`.rf-pdf-page[data-page="${n}"][data-scale]`);
      await pageEl.waitFor({ timeout: 60_000 });
      const canvas = pageEl.locator('.rf-pdf-page__canvas canvas').first();
      const drawn = await canvas.evaluate((c, cssScale) => ({ png: c.toDataURL('image/png'), width: c.width, cssWidth: c.getBoundingClientRect().width, cssScale }),
        Number(await pageEl.getAttribute('data-scale')));
      const pointsWide = drawn.cssWidth / drawn.cssScale;
      scale ??= drawn.width / pointsWide;
      writeFileSync(join(out, `${PDF.replace(/\.pdf$/, '')}-p${n}-pdfjs.png`), Buffer.from(drawn.png.split(',')[1], 'base64'));
    }
    const compared = python(['scripts/dev/g5_page_diff.py', out, String(scale), ...mathPages.map((n) => `${PDF}:${n}`)]);
    console.log(compared.text.trim());
    expect(compared.ok, `equation pages ${mathPages.join(', ')} match PDFium (scale ${scale?.toFixed(3)})`).toBe(true);
    step(`equation pages ${mathPages.join(', ')} match the original`);

    // 4. The illustrated EPUB: every packaged image is drawn with its caption (Gate G5's count).
    const expectFile = join(out, 'expect.json');
    expect(python(['scripts/dev/g5_epub_expect.py', expectFile]).ok, 'g5_epub_expect.py').toBe(true);
    const want = JSON.parse(readFileSync(expectFile, 'utf8')).alice;
    await page.goto(`/read/${books.epub}`);
    await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 120_000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Walk back to the book's first page first, so the cover and title pages' images are counted too (DEBUG_LOG
    // 2026-11-17 C25.3; since C26.5 a new book opens there, a book read before at its saved place).
    for (let still = 0, turn = 0; still < 3 && turn < 200; turn += 1) {
      const start = await page.locator('.rf-ov').getAttribute('data-start');
      await stage.focus();
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => page.locator('.rf-ov').getAttribute('data-start'), { timeout: 3000 }).not.toBe(start).catch(() => {});
      still = await page.locator('.rf-ov').getAttribute('data-start') === start ? still + 1 : 0;
    }
    expect(await page.locator('.rf-ov').getAttribute('data-start'), "the EPUB's first page").toMatch(/^0:/);
    const seen = new Map();
    let stuck = 0;
    for (let turn = 0; turn < 600; turn += 1) {
      for (const frame of page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())) {
        const found = await frame.evaluate(async () => {
          // An image still arriving counts once it has loaded or failed (3 s at most), not as missing.
          await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((done) => {
            i.addEventListener('load', done, { once: true }); i.addEventListener('error', done, { once: true });
            setTimeout(done, 3000);
          })));
          const box = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const images = [...document.querySelectorAll('img, svg image')].map((el) => ({
            loaded: el.tagName.toLowerCase() === 'img' ? el.complete && el.naturalWidth > 0 : box(el),
            caption: (el.closest('figure')?.querySelector('figcaption')?.textContent || el.getAttribute('alt') || '').trim() }));
          return { key: `${document.title}|${document.body?.textContent.length}|${document.images.length}`, images,
            captions: [...document.querySelectorAll('figcaption')].map((el) => el.textContent.trim()).filter(Boolean) };
        }).catch(() => null);
        if (found && found.key !== '||0') seen.set(found.key, found);
      }
      // Stop only when three presses in a row move nothing (the book's own end, under its closing page).
      const end = await page.locator('.rf-ov').getAttribute('data-end');
      const closing = await page.locator('.rf-end').count();
      await stage.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      await expect.poll(async () => `${await page.locator('.rf-ov').getAttribute('data-end')}|${await page.locator('.rf-end').count()}`,
        { timeout: 5000 }).not.toBe(`${end}|${closing}`).catch(() => {});
      const moved = await page.locator('.rf-ov').getAttribute('data-end') !== end || await page.locator('.rf-end').count() !== closing;
      stuck = moved ? 0 : stuck + 1;
      if (stuck >= 3) break;
    }
    const images = [...seen.values()].flatMap((s) => s.images);
    const wanted = { images: want.sections.reduce((n, s) => n + s.images, 0), captions: want.sections.reduce((n, s) => n + s.captions.length, 0) };
    console.log(`EPUB: expected ${JSON.stringify(wanted)} in ${want.sections.length} sections; seen ${seen.size} section documents, `
      + `${images.length} images (${images.filter((i) => i.loaded).length} loaded), ${[...seen.values()].reduce((n, s) => n + s.captions.length, 0)} captions; `
      + `images per section seen ${JSON.stringify([...seen.values()].map((s) => s.images.length))}, expected ${JSON.stringify(want.sections.map((s) => s.images))}; last place ${await page.locator('.rf-ov').getAttribute('data-end')}`);
    expect(images.filter((i) => i.loaded).length, 'every packaged image drawn').toBe(wanted.images);
    expect([...seen.values()].reduce((n, s) => n + s.captions.length, 0), 'every caption shown').toBe(wanted.captions);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    step('EPUB images and captions drawn');

    // 5. Back to the PDF: highlight a passage on a prose page, lookup off, Ask Steve from the highlight.
    await page.goto(`/read/${books.pdf}`);
    await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 120_000 });
    const bodyStart = (await call('GET', `/books/${books.pdf}/body-start`)).json;
    const startPage = Number(bodyStart.page ?? bodyStart.body_start?.page ?? 1);
    const proseAt = await goTo(startPage);
    citePage = Number(proseAt.start);
    const line = page.locator(`.rf-pdf-page[data-page="${citePage}"] .textLayer span`).filter({ hasText: /\w+ \w+ \w+ \w+/ }).first();
    const lineBox = await line.boundingBox();
    const passage = (await line.textContent()).trim();
    await page.mouse.move(lineBox.x + 2, lineBox.y + lineBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(lineBox.x + lineBox.width - 2, lineBox.y + lineBox.height / 2, { steps: 8 });
    await page.mouse.up();
    const saved = page.waitForResponse(isApi(/\/annotations$/, 'POST'), { timeout: 30_000 });
    await page.getByRole('toolbar', { name: 'Highlight the selection' }).getByRole('button', { name: 'Honey highlight', exact: true }).click();
    expect((await saved).status(), 'POST /books/:id/annotations').toBe(201);
    await expect(page.locator(`.rf-pdf-page[data-page="${citePage}"] .rf-anno`)).toHaveCount(1);
    const lookup = page.getByRole('switch', { name: 'Look up words on hover' });
    if (await lookup.getAttribute('aria-checked') === 'true') await lookup.click();
    await expect(lookup).toHaveAttribute('aria-checked', 'false');
    await page.mouse.move(5, 5);
    await page.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2, { steps: 4 });
    const chip = page.getByRole('toolbar', { name: /^Honey highlight:/ });
    await expect(chip).toBeVisible();
    await chip.getByRole('button', { name: 'Ask Steve' }).click();
    const steve = page.getByRole('complementary', { name: 'Steve' });
    await expect(steve.locator('.rf-steve-answer')).toContainText(`p. ${citePage}`, { timeout: STEVE_LIVE ? 90_000 : 15_000 });
    if (!STEVE_LIVE) {
      expect(asks.at(-1)?.mode, 'asked about the highlight').toBe('explain_highlight');
      expect(asks.at(-1)?.anchor?.page, "the highlight's page sent as the anchor").toBe(citePage);
    }
    step('highlighted, lookup off, Steve answered');

    // 6. The citation is a real place: away two views, then the chip brings the book back to the cited page.
    await stage.focus();
    await page.keyboard.press('ArrowRight');
    const away = await settled(page);
    await page.keyboard.press('ArrowRight');
    await settled(page, away);
    const cite = steve.getByRole('button', { name: `Go to page ${citePage}` }).first();
    await cite.click();
    const back = await settled(page);
    expect(Number(back.start) <= citePage && citePage <= Number(back.end), `page ${citePage} shown after the citation`).toBe(true);
    await expect(page.locator(`.rf-pdf-page[data-page="${citePage}"] .textLayer`)).toContainText(passage.slice(0, 20));
    step('citation moved the book to the cited page');

    // 7. Save the answer to notes, then a drawing note.
    const noteSaved = page.waitForResponse(isApi(/\/notes$/, 'POST'), { timeout: 30_000 });
    await steve.getByRole('button', { name: 'Save to notes' }).click();
    expect((await noteSaved).status(), 'POST /books/:id/notes (Steve)').toBe(201);
    await expect(steve.getByRole('button', { name: 'Saved to notes' })).toBeDisabled();
    await page.getByRole('tab', { name: /^Notes/ }).click();
    const notes = page.getByRole('complementary', { name: 'Notes' });
    await expect(notes.locator('.rf-note').first()).toContainText(`p. ${citePage}`);
    const drawingMade = page.waitForResponse(isApi(/\/notes$/, 'POST'), { timeout: 30_000 });
    await notes.getByRole('button', { name: 'Drawing' }).click();
    expect((await drawingMade).status(), 'POST /books/:id/notes (drawing)').toBe(201);
    const drawingCanvas = page.locator('.rf-drawing canvas.interactive');
    await expect(drawingCanvas).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.locator('.rf-drawing').getByTitle(/^Rectangle —/).click();
    const area = await drawingCanvas.boundingBox();
    await page.mouse.move(area.x + 40, area.y + 140);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(area.x + 40 + (120 * i) / 6, area.y + 140 + (80 * i) / 6);
    await page.mouse.up();
    const picture = page.waitForResponse(isApi(/\/note-files$/, 'POST'), { timeout: 30_000 });
    await notes.getByRole('button', { name: 'Done' }).click();
    expect((await picture).status(), 'POST /books/:id/note-files (drawing thumbnail)').toBe(201);
    await expect(notes.getByRole('img', { name: /^Drawing/ })).toBeVisible({ timeout: 30_000 });
    step('answer saved to notes, drawing note added');

    // 8. The notepad follows the book: notes on the cited page are marked there, not two views on.
    const here = notes.locator('.rf-note[data-here]');
    await expect.poll(() => here.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    const atNotes = await settled(page);
    await page.getByRole('button', { name: 'Next' }).click();
    const next1 = await settled(page, atNotes);
    await page.getByRole('button', { name: 'Next' }).click();
    await settled(page, next1);
    await expect.poll(() => here.count(), { timeout: 10_000 }).toBe(0);
    await cite.click().catch(async () => { await goTo(citePage); });
    await settled(page);
    await expect.poll(() => here.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    step('notepad followed the pages');

    // 9. Focus mode from chapter 1: read with page turns for about two and a half minutes, end with the ribbon.
    await goTo(startPage);
    await wake();
    await page.getByRole('switch', { name: 'Focus mode' }).click();
    const bar = page.getByRole('region', { name: 'Focus mode' });
    const focusStarted = page.waitForResponse(isApi(/^\/focus\/start$/, 'POST'), { timeout: 30_000 });
    await wake();
    await bar.getByRole('button', { name: 'Start' }).click();
    const focus = await (await focusStarted).json();
    await expect(bar.getByRole('timer')).toBeVisible();
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(25_000);
      await stage.focus();
      await page.keyboard.press(i % 3 === 2 ? 'ArrowLeft' : 'ArrowRight');
    }
    await wake();
    await bar.getByRole('button', { name: 'End session' }).click();
    const placing = page.getByRole('group', { name: 'Place the ribbon' });
    await expect(placing).toBeVisible();
    await placing.getByRole('button', { name: /^Set ribbon on p\./ }).last().click();
    const ready = page.getByRole('dialog', { name: 'Ready for your questions?' });
    await expect(ready).toBeVisible({ timeout: 30_000 });
    const quizMade = page.waitForResponse(isApi(new RegExp(`^/focus/${focus.id}/quiz$`), 'POST'), { timeout: 180_000 });
    await ready.getByRole('button', { name: 'Start questions' }).click();
    const quiz = await (await quizMade).json();
    step('focus session read and ended with the ribbon');

    // 10. The quiz: as many questions as the words read call for, answered from the stored questions.
    expect(quiz.count, `questions for ${quiz.words_in_range} words`).toBe(expectedCount(quiz.words_in_range));
    await expect(page.getByText(new RegExp(`^Question 1 of ${quiz.count}`))).toBeVisible({ timeout: 30_000 });
    const stored = (await service.from('sessions').select('test_questions').eq('id', focus.id).single()).data.test_questions;
    expect(stored.length).toBe(quiz.count);
    // One question at a time, moved on with the quiz's own Next (focus-end.spec.js); each answer is written only
    // once its question is showing, so an answer cannot land in another question's box (DEBUG_LOG C25.3).
    for (let i = 0; i < stored.length; i += 1) {
      await expect(page.getByText(new RegExp(`^Question ${i + 1} of ${quiz.count}`))).toBeVisible({ timeout: 15_000 });
      const q = stored[i];
      if (q.options?.length) await page.getByRole('radio', { name: q.answer, exact: true }).check();
      else await page.getByLabel('Your answer').fill(q.answer || q.evidence || 'The passage');
      if (i < stored.length - 1) await page.locator('[data-test-next]').click();
    }
    const graded = page.waitForResponse(isApi(new RegExp(`^/focus/${focus.id}/quiz/answers$`), 'POST'), { timeout: 180_000 });
    await page.getByRole('button', { name: 'Submit answers' }).click();
    const gradedResponse = await graded;
    expect(gradedResponse.status(), 'POST /focus/:id/quiz/answers').toBe(200);
    const gradedBody = await gradedResponse.json();
    console.log('submitted answers:', JSON.stringify(gradedResponse.request().postDataJSON()?.answers));
    console.log('stored answers:', JSON.stringify(stored.map((q) => q.answer)));
    console.log('graded:', JSON.stringify({ quiz_correct: gradedBody.quiz_correct, quiz_total: gradedBody.quiz_total, per_question: gradedBody.per_question }));
    await expect(page).toHaveURL(new RegExp(`/results/${focus.id}$`), { timeout: 60_000 });
    step(`quiz of ${quiz.count} answered and graded`);

    // 11. The points breakdown, then XP, the streak and the league.
    const scored = page.getByRole('region', { name: 'How this session scored' });
    await expect(scored).toBeVisible({ timeout: 30_000 });
    await expect(scored.locator('.rf-points__row').first()).toContainText('Focused reading');
    const session = (await service.from('focus_sessions').select('*').eq('id', focus.id).single()).data;
    const events = (await service.from('focus_events').select('kind, server_ts, had_input').eq('session_id', focus.id).order('server_ts')).data ?? [];
    const results = (await service.from('test_results').select('*').eq('session_id', focus.id)).data ?? [];
    console.log('focus session:', JSON.stringify({ ...session, start_anchor: undefined, end_anchor: undefined }));
    console.log('focus events:', JSON.stringify(events.map((e) => `${e.kind}${e.had_input ? '+' : ''}@${String(e.server_ts).slice(11, 19)}`)));
    console.log('quiz results:', JSON.stringify(results).slice(0, 1500));
    console.log('breakdown:', (await scored.innerText()).replace(/\s+/g, ' '));
    expect(session.status, 'focus session scored').toBe('scored');
    expect(session.points_total, 'points earned (quiz passed)').toBeGreaterThan(0);
    await expect(scored.locator('.rf-points__row').last().locator('dd')).toHaveText(`+${session.points_total}`);
    const after = (await call('GET', '/me/progress')).json;
    expect(after.total_xp - before.total_xp, 'XP gained, at least the points').toBeGreaterThanOrEqual(session.points_total);
    expect(after.today.xp - before.today.xp, "today's focus XP").toBe(session.points_total);
    expect(after.today.met, `today's goal of ${RUN_GOAL} met`).toBe(true);
    expect(after.streak.days, 'streak counts today').toBeGreaterThanOrEqual(Math.max(1, before.streak.days));
    await page.goto('/dashboard');
    // The header's name (progressMath.headerLabel): the goal met with today's XP, and the streak in days.
    const headerName = new RegExp(`Today's goal is met, ${after.today.xp} XP\\. ${after.streak.days} days? in a row`);
    await expect(page.getByRole('link', { name: headerName })).toBeVisible({ timeout: 30_000 });
    const league = (await call('GET', '/leagues/current')).json;
    await page.goto('/league');
    if (league.in_group) {
      const me = league.rows.find((r) => r.you);
      expect(me.weekly_xp, 'weekly league XP includes the session').toBeGreaterThanOrEqual(session.points_total);
      await expect(page.getByRole('region', { name: 'Your group this week' }).locator('[aria-current="true"]')).toContainText(`${me.weekly_xp}`);
    } else {
      await expect(page.getByText('you will join', { exact: false })).toBeVisible({ timeout: 30_000 });
    }
    step(`points ${session.points_total}, XP +${after.total_xp - before.total_xp}, streak ${after.streak.days}, league ${league.in_group ? 'updated' : 'joins next Monday'}`);
  } finally {
    // 12. Clean up: both books (cascade: highlights, notes and their pictures, focus sessions), the goal back.
    const report = [];
    for (const [kind, id] of Object.entries(books)) {
      const r = await page.request.delete(`${api.origin}/books/${id}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      report.push(`${kind} ${r?.status() ?? 'failed'}`);
    }
    if (token && goalBefore != null) await call('PUT', '/me/progress', { daily_goal: goalBefore }).catch(() => null);
    const left = {};
    for (const id of Object.values(books)) {
      for (const table of ['books', 'annotations', 'note_blocks', 'focus_sessions']) {
        const { data } = await service.from(table).select('*').eq(table === 'books' ? 'id' : 'book_id', id);
        left[table] = (left[table] ?? 0) + (data?.length ?? 0);
      }
    }
    console.log(`cleanup: DELETE books ${report.join(', ')}; rows left ${JSON.stringify(left)}; daily goal back to ${goalBefore}`);
    console.log('steps (seconds):', steps.map(([name, s]) => `${name} ${s}`).join(' | '));
    console.log('hosts:', JSON.stringify(Object.fromEntries(hosts)));
  }
  const strange = [...hosts.keys()].filter((h) => !allowed.has(h));
  expect(strange, 'no host but the site, the API and the Supabase project').toEqual([]);
});
