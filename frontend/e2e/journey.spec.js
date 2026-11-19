// The full reading journey (C15.1; C26.6c: no sessions), live: a real sign-in, upload, ingestion, the book opened
// at its first page, pages turned and the place saved, a word card, Quiz me graded, the dashboard, and the book
// opened again at the saved place, against a real backend and the shared Supabase project.
// Not part of `npm run test:e2e` (playwright.config.js ignores this file); run it with
// `npm run test:live` (playwright.live.config.js). It signs in as test user A from ../.env.test
// (or TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD), never prints the credentials, and deletes the
// book it uploads, which cascades to its chunks, sessions, results, mastery and decisions.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { signInAs } from './liveSignIn.js';
import { wordPoint } from './fixtures.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SAMPLE = `${ROOT}sample.pdf`;
const SUPABASE_HOST = 'lvfhuszvuiowyeizstru.supabase.co';

/** KEY=value lines of ../.env.test, under the environment. */
function credentials() {
  const file = `${ROOT}.env.test`;
  const vars = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const email = process.env.TEST_USER_A_EMAIL ?? vars.TEST_USER_A_EMAIL;
  const password = process.env.TEST_USER_A_PASSWORD ?? vars.TEST_USER_A_PASSWORD;
  if (!email || !password) throw new Error('TEST_USER_A_EMAIL and TEST_USER_A_PASSWORD are needed (.env.test or the environment)');
  return { email, password };
}

/** The planner's and optimizer's reasons that come from a previous test, not from the book alone. */
/** Plainly wrong, off-topic answers: the score lands low, so the next plan has to react to it. */
const WRONG = 'Bananas are yellow and the weather was nice on Tuesday.';
/** Common words a technical PDF is likely to show on its first pages, tried in order for a card. */
const WORDS = ['design', 'antenna', 'learning', 'structure', 'performance', 'simulation', 'frequency', 'method', 'results', 'model'];

test('the full reading journey, signed in, on the real stack', async ({ page, baseURL }) => {
  const site = new URL(baseURL);
  const api = new URL(process.env.API_URL ?? (site.hostname === 'localhost' ? 'http://localhost:8000' : 'https://readfocus-api.onrender.com'));
  const title = `Journey ${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
  const allowed = new Set([site.host, api.host, SUPABASE_HOST]);
  const hosts = new Map(); // host -> requests
  const steps = [];
  let started = Date.now();
  const step = (name) => { const now = Date.now(); steps.push([name, ((now - started) / 1000).toFixed(1)]); started = now; };
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol.startsWith('http')) hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1);
  });
  const isApi = (path, method) => (r) => r.url().startsWith(api.origin) && new URL(r.url()).pathname.match(path) && r.request().method() === method;

  let bookId = null;
  let token = null;
  let deletedInUi = false;
  try {
    // 0. A cold Render start: wait for the API and its model before the clock starts.
    await expect.poll(async () => {
      try {
        const health = await page.request.get(`${api.origin}/health`, { timeout: 30_000 });
        return health.ok() && (await health.json()).model_ready === true;
      } catch { return false; }
    }, { timeout: 5 * 60_000, intervals: [5_000] }).toBe(true);
    step('API ready');

    // 1. Sign in.
    const { email, password } = credentials();
    await signInAs(page, email, password);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /^Your shelf/ })).toBeVisible({ timeout: 60_000 });
    token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
      return key ? JSON.parse(localStorage.getItem(key)).access_token : null;
    });
    expect(token, 'a Supabase session after sign-in').toBeTruthy();
    step('signed in');

    // 2. Upload sample.pdf and wait for it to be ready.
    await page.locator('input[type=file]').setInputFiles(SAMPLE);
    const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Author').fill('ReadFocus journey test');
    const uploaded = page.waitForResponse(isApi(/^\/books\/register$/, 'POST'), { timeout: 120_000 });
    await dialog.getByRole('button', { name: 'Add book' }).click();
    const upload = await uploaded;
    expect(upload.status(), 'POST /books/register (C35.3e)').toBe(200);
    bookId = (await upload.json()).book_id;
    expect(bookId).toBeTruthy();
    await expect(dialog).toBeHidden();
    step('uploaded');
    await expect(page.getByText(`${title}: your first quizzes are ready.`)).toBeVisible({ timeout: 12 * 60_000 });
    step('ingested (ready)');

    // 3. Read: the book opens at its first page (GET /books/{id}/open, no session), pages turn and the place is saved.
    const opening = page.waitForResponse(isApi(new RegExp(`^/books/${bookId}/open$`), 'GET'), { timeout: 120_000 });
    await page.goto(`/read/${bookId}`);
    expect((await opening).status(), 'GET /books/{id}/open').toBe(200);
    await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.rf-ov-note .rf-note')).toHaveCount(0); // no suggested reading
    step('book open');

    await page.locator('.rf-ov-stage').focus();
    const saved = page.waitForResponse((r) => r.url() === `${api.origin}/books/${bookId}/position` && r.request().method() === 'PUT', { timeout: 30_000 });
    const live = page.locator('.rf-ov-live');
    const before = await live.textContent();
    await page.keyboard.press('ArrowRight');
    await expect(live).not.toHaveText(before ?? '');
    expect((await saved).status(), 'reading position saved').toBeLessThan(300);
    await page.waitForTimeout(1500); // the last turn's save (one a second)
    const place = await page.locator('.rf-ov').getAttribute('data-start');
    step('pages turned, position saved');

    // 4. Hover a word: its definition card comes from the real lookup.
    const card = page.locator('.rf-wordcard[data-kind="definition"]');
    let looked = null;
    for (const word of WORDS) {
      const point = await wordPoint(page, word);
      if (!point) continue;
      const lookup = page.waitForResponse((r) => r.url().startsWith(`${api.origin}/lookup`) && r.request().method() === 'GET', { timeout: 20_000 }).catch(() => null);
      await page.mouse.move(5, 5);
      await page.mouse.move(point.x, point.y);
      const response = await lookup;
      if (response?.status() === 200 && await card.isVisible({ timeout: 5_000 }).catch(() => false)) { looked = word; break; }
      await page.keyboard.press('Escape');
    }
    expect(looked, `a definition card for one of: ${WORDS.join(', ')}`).toBeTruthy();
    await expect(card).not.toBeEmpty();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    step(`word card (${looked})`);

    // 5. Quiz me on what was read so far, answering every question badly on purpose.
    await page.mouse.move(5, 5); // off the word, so its hover card does not open again
    const built = page.waitForResponse(isApi(/^\/focus\/quiz-me$/, 'POST'), { timeout: 180_000 });
    await page.getByRole('button', { name: 'Quiz me' }).click();
    await page.getByRole('dialog', { name: 'Quiz me' }).getByRole('button', { name: 'Since my last quiz' }).click();
    const quiz = await built;
    expect(quiz.status(), 'POST /focus/quiz-me').toBe(200);
    const sessionId = (await quiz.json()).session_id;
    await expect(page).toHaveURL(new RegExp(`/quiz/${sessionId}$`), { timeout: 120_000 });
    const counter = page.getByText(/^Question 1 of \d+/);
    await expect(counter).toBeVisible({ timeout: 120_000 });
    const total = Number(/of (\d+)/.exec(await counter.textContent())[1]);
    expect(total).toBeGreaterThan(0);
    for (let i = 1; i <= total; i += 1) {
      await expect(page.getByText(new RegExp(`^Question ${i} of ${total}`))).toBeVisible();
      const radios = page.getByRole('radio');
      if (await radios.count()) await radios.last().check();
      else await page.getByLabel('Your answer').fill(WRONG);
      if (i < total) await page.locator('[data-test-next]').click();
    }
    step(`quiz answered (${total} questions)`);
    const submitted = page.waitForResponse(isApi(new RegExp(`^/sessions/${sessionId}/submit-answers$`), 'POST'), { timeout: 180_000 });
    await page.getByRole('button', { name: 'Submit answers' }).click();
    const submit = await submitted;
    expect(submit.status(), 'POST submit-answers').toBe(200);
    const graded = await submit.json();
    expect(graded.next_session, 'no next session is planned (C26.6)').toBeUndefined();

    // 6. Results: the score, feedback on each answer, and Read on (no suggested reading).
    await expect(page).toHaveURL(new RegExp(`/results/${sessionId}$`));
    await expect(page.getByText(`Score: ${Math.round(graded.percentage)}%`)).toBeVisible();
    const feedback = page.locator('.rf-results__feedback');
    await expect(feedback.first()).toBeVisible();
    expect((await feedback.first().textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.getByRole('region', { name: 'Read on' })).toBeVisible();
    step(`results (${Math.round(graded.percentage)}%)`);

    // 7. Dashboard: the book's concepts now carry this test's attempts.
    const masteryLoaded = page.waitForResponse((r) => r.url().startsWith(`${api.origin}/mastery?`) && r.url().includes(bookId) && r.request().method() === 'GET', { timeout: 60_000 });
    await page.goto('/dashboard');
    await expect(page.getByRole('region', { name: 'Your books' })).toContainText(title, { timeout: 60_000 });
    const tabs = page.getByRole('tablist', { name: 'Books' });
    const tab = tabs.getByRole('tab', { name: title });
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    const mastery = await (await masteryLoaded).json();
    const tested = mastery.items.filter((c) => c.attempts > 0);
    expect(tested.length, 'concepts with a recorded attempt').toBeGreaterThan(0);
    const panel = page.getByRole('tabpanel', { name: title });
    await expect(panel.getByRole('listitem').first()).toBeVisible();
    await expect(panel).toContainText(tested[0].label);
    step(`dashboard (${tested.length} concepts tested)`);

    // 8. Back to the book: it opens at the place saved in step 3.
    await page.goto(`/results/${sessionId}`);
    await page.getByRole('region', { name: 'Read on' }).getByRole('button', { name: 'Back to the book' }).click();
    await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor({ timeout: 60_000 });
    await expect.poll(() => page.locator('.rf-ov').getAttribute('data-start'), { timeout: 15_000 }).toBe(place);
    step('book reopened at the saved place');

    // 9. Remove the book through the UI.
    await page.goto('/');
    await page.getByRole('button', { name: `Remove ${title} from your shelf` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByText(`${title} is off your shelf.`)).toBeVisible({ timeout: 60_000 });
    deletedInUi = true;
    step('book removed');
  } finally {
    // Whatever happened above, the book this run made does not stay in the shared project.
    if (bookId && token && !deletedInUi) {
      const gone = await page.request.delete(`${api.origin}/books/${bookId}`, { headers: { Authorization: `Bearer ${token}` } }).catch((e) => e);
      console.log(`cleanup: DELETE /books/${bookId} -> ${gone?.status?.() ?? gone}`);
    }
    if (bookId && token) {
      const shelf = await page.request.get(`${api.origin}/books`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      const left = shelf?.ok() ? (await shelf.json()).some((b) => b.id === bookId) : 'unknown';
      console.log(`book ${bookId} still on the shelf: ${left}`);
    }
    console.log('steps (s):', steps.map(([n, s]) => `${n} ${s}`).join(' | '));
    console.log('hosts:', [...hosts].map(([h, n]) => `${h} (${n})`).join(', '));
  }
  const strangers = [...hosts.keys()].filter((h) => !allowed.has(h));
  expect(strangers, 'hosts outside the site, the API and the Supabase project').toEqual([]);
});
