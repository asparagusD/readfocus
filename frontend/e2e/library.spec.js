// The library (C13.3), with the API mocked: loading, empty, error and a shelf of five.
import { test, expect } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const COVER = 'http://localhost:4174/e2e-cover.svg';
const COVER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="#c9b79c"/></svg>';

export const SHELF = [
  { id: 'walden', status: 'ready', title: 'Walden', author: 'Henry David Thoreau', total_chunks: 10, total_words: 6000,
    created_at: '2026-11-01T10:00:00Z', cover_url: null,
    progress: { chunks_completed: 6, last_chunk_index: 5, updated_at: '2026-11-10T20:00:00Z' } },
  { id: 'meditations', status: 'ready', title: 'Meditations', author: 'Marcus Aurelius', total_chunks: 8, total_words: 4000,
    created_at: '2026-11-02T10:00:00Z', cover_url: COVER,
    progress: { chunks_completed: 2, last_chunk_index: 1, updated_at: '2026-11-08T20:00:00Z' } },
  { id: 'middlemarch', status: 'ready', title: 'Middlemarch', author: 'George Eliot', total_chunks: 40, total_words: 300000,
    created_at: '2026-11-03T10:00:00Z', cover_url: null, progress: null },
  { id: 'origin', status: 'processing', title: 'On the Origin of Species', author: 'Charles Darwin', total_chunks: null,
    total_words: null, created_at: '2026-11-04T10:00:00Z', cover_url: null, progress: null },
  { id: 'broken', status: 'error', title: 'A scanned pamphlet', author: 'Unknown', total_chunks: null, total_words: null,
    created_at: '2026-11-05T10:00:00Z', cover_url: null, progress: null },
];

/** Answer GET /books with `books` (after `delay` ms), or fail it with `status`. */
export async function mockShelf(page, books, { delay = 0, status = 200 } = {}) {
  await page.route('http://localhost:8000/books', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (route.request().method() !== 'GET') return route.fallback();
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(status === 200 ? books : { detail: 'down' }) });
  });
  await page.route(COVER, (route) => route.fulfill({ status: 200, headers: { 'Content-Type': 'image/svg+xml' }, body: COVER_SVG }));
}

test('loading shows the shelf skeleton, then the books', async ({ page }) => {
  await mockShelf(page, SHELF, { delay: 600 });
  await page.goto('/');
  await expect(page.getByLabel('Loading your shelf')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/library-loading.png` });
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
});

test('a shelf of five: next book, covers, progress and states', async ({ page }) => {
  await mockShelf(page, SHELF);
  await page.goto('/');
  await expect(page.getByText('5 books · Walden is where you left off')).toBeVisible();
  const today = page.getByRole('region', { name: 'Walden' });
  await expect(today).toContainText('Continue reading');
  await expect(today).toContainText('60% read so far');
  await expect(today.getByRole('link', { name: 'Begin reading' })).toHaveAttribute('href', '/read/walden');

  const shelf = page.getByRole('list');
  await expect(shelf.getByRole('listitem')).toHaveCount(5);
  await expect(shelf.getByRole('link', { name: /Walden/ })).toHaveAttribute('href', '/read/walden');
  await expect(shelf.getByRole('link', { name: /On the Origin/ })).toHaveCount(0); // not readable yet
  await expect(shelf).toContainText('25% read');
  await expect(shelf).toContainText('New · not started');
  await expect(shelf).toContainText('Reading the pages…');
  await expect(shelf).toContainText('We couldn’t read this file');
  await expect(page.getByRole('button', { name: 'Remove Middlemarch from your shelf' })).toBeVisible();
  // The stored cover is drawn over the typographic one.
  await expect(page.locator(`img[src="${COVER}"]`)).toHaveCount(1);
  await expect(page.getByText('Ch. 1 of')).toHaveCount(0); // audit U14
  if (shots) await page.screenshot({ path: `${shots}/library-shelf-1440.png`, fullPage: true });
});

test('an empty shelf invites the first book', async ({ page }) => {
  await mockShelf(page, []);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your shelf is waiting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a PDF or EPUB' })).toBeVisible();
  await expect(page.getByRole('region', { name: /./ }).filter({ hasText: 'Begin reading' })).toHaveCount(0);
  if (shots) await page.screenshot({ path: `${shots}/library-empty-1440.png` });
});

test('a failed load says so and can try again', async ({ page }) => {
  await mockShelf(page, SHELF, { status: 503 });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('We couldn’t open your shelf just now.');
  await page.unroute('http://localhost:8000/books');
  await mockShelf(page, SHELF);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(5);
});

test.describe('at 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('three covers across and nothing wider than the screen', async ({ page }) => {
    await mockShelf(page, SHELF);
    await page.goto('/');
    await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(5);
    // the tiles rise into place first (C13.3c); measure them once they have settled
    await expect.poll(() => page.locator('.rf-shelf__item').evaluateAll((els) => els.every((e) => getComputedStyle(e).transform === 'none'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    const tops = await page.locator('.rf-shelf__item').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops[0]).toBe(tops[1]);
    expect(tops[1]).toBe(tops[2]);
    expect(tops[3]).toBeGreaterThan(tops[0]);
    if (shots) await page.screenshot({ path: `${shots}/library-shelf-375.png`, fullPage: true });
  });
});

/** Record and answer the writes and the status poll; GET /books comes from `shelf()` on each call. */
async function mockWrites(page, shelf, { progress = 0.64, failUpload = false } = {}) {
  const calls = { uploads: [], deletes: [], statuses: 0 };
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await page.route('http://localhost:8000/books', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return json(route, shelf());
  });
  await page.route(/localhost:8000\/books\/[^/]+(\/status)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    if (path === '/books/upload') return route.fallback();
    if (path.endsWith('/status')) {
      calls.statuses += 1;
      return json(route, { status: 'processing', total_chunks: null, ingestion: { status: 'running', progress } });
    }
    if (req.method() === 'DELETE') {
      calls.deletes.push(path);
      return json(route, { message: 'deleted' });
    }
    return route.fallback();
  });
  await page.route('http://localhost:8000/books/upload', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = req.postDataBuffer()?.toString('latin1') ?? '';
    const field = (name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
    calls.uploads.push({ title: field('title'), author: field('author'), file: /filename="([^"]+)"/.exec(body)?.[1] });
    if (failUpload) return json(route, { detail: 'That file is too large' }, 400);
    return json(route, { book_id: 'new-book', status: 'processing' });
  });
  return calls;
}

const PDF = { name: 'the_age_of_innocence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') };

test('adding a book: picker, inline errors, the same form fields, a toast and a processing tile', async ({ page }) => {
  const calls = await mockWrites(page, () => SHELF.slice(0, 3));
  await page.goto('/');
  await page.getByRole('list').waitFor();
  await page.locator('input[type=file]').setInputFiles(PDF);
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  await expect(dialog).toContainText('the_age_of_innocence.pdf');
  await expect(dialog.getByLabel('Title')).toHaveValue('The Age Of Innocence');
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(dialog.getByLabel('Author')).toHaveAccessibleDescription('Enter the author’s name.');
  await expect(dialog.getByLabel('Author')).toBeFocused();
  expect(calls.uploads).toEqual([]);
  await dialog.getByLabel('Author').fill('Edith Wharton');
  await dialog.getByLabel('Author').press('Enter');
  await expect(dialog).toBeHidden();
  expect(calls.uploads).toEqual([{ title: 'The Age Of Innocence', author: 'Edith Wharton', file: 'the_age_of_innocence.pdf' }]);
  await expect(page.getByText('The Age Of Innocence is on your shelf. We’re reading its pages now.')).toBeVisible();
  await expect(page.locator('.rf-shelf__item').first()).toContainText('Reading the pages…');
});

test('a failed upload keeps the dialog open and says why', async ({ page }) => {
  await mockWrites(page, () => SHELF.slice(0, 3), { failUpload: true });
  await page.goto('/');
  await page.getByRole('list').waitFor();
  await page.locator('input[type=file]').setInputFiles(PDF);
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  await dialog.getByLabel('Author').fill('Edith Wharton');
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(page.getByText('We couldn’t add that book: That file is too large.')).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('a file dropped on the page: the drop target shows, then the dialog; other files are refused', async ({ page }) => {
  await mockWrites(page, () => SHELF.slice(0, 3));
  await page.goto('/');
  await page.getByRole('list').waitFor();
  const drag = (type, name) => page.evaluate(([t, n]) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], n, { type: 'application/octet-stream' }));
    window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [type, name]);
  await drag('dragenter', 'notes.epub');
  await expect(page.getByText('Release to add your book')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/library-drop.png` });
  await drag('drop', 'notes.epub');
  await expect(page.getByText('Release to add your book')).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Add to your shelf' })).toContainText('notes.epub');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await drag('dragenter', 'photo.jpg');
  await drag('drop', 'photo.jpg');
  await expect(page.getByText('photo.jpg isn’t a PDF or EPUB, so it can’t go on the shelf.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a processing book shows how far its pages are read, then says when it is ready', async ({ page }) => {
  let polls = 0;
  const origin = SHELF.find((b) => b.id === 'origin');
  const calls = await mockWrites(page, () => {
    polls += 1;
    return [SHELF[0], polls < 3 ? origin : { ...origin, status: 'ready', total_chunks: 30 }];
  });
  await page.goto('/');
  const tile = page.locator('.rf-shelf__item').filter({ hasText: 'On the Origin of Species' });
  await expect(tile).toContainText('Reading the pages… 64%', { timeout: 6000 });
  expect(calls.statuses).toBeGreaterThan(0);
  await expect(page.getByText('On the Origin of Species is ready on your shelf.')).toBeVisible({ timeout: 6000 });
  await expect(tile).toContainText('New · not started');
});

test('removing a book asks first, in a dialog; Keep it changes nothing', async ({ page }) => {
  let books = SHELF.slice(0, 3);
  const calls = await mockWrites(page, () => books);
  await page.goto('/');
  const remove = page.getByRole('button', { name: 'Remove Middlemarch from your shelf' });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Remove Middlemarch?' });
  await expect(dialog).toContainText('can’t be undone');
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  expect(calls.deletes).toEqual([]);
  await remove.click();
  books = SHELF.slice(0, 2);
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.deletes).toEqual(['/books/middlemarch']);
  await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('Middlemarch is off your shelf.')).toBeVisible();
});

/** Every frame, each shelf tile's first words and transform, with the time since the page started. */
async function recordTiles(page) {
  await page.addInitScript(() => {
    window.__tiles = [];
    const start = performance.now();
    const sample = () => {
      for (const el of document.querySelectorAll('.rf-shelf__item')) {
        window.__tiles.push({ t: performance.now() - start, text: el.textContent.slice(0, 24), transform: getComputedStyle(el).transform });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

for (const reduced of [false, true]) {
  test.describe(reduced ? 'shelf motion, reduced' : 'shelf motion', () => {
    test.use({ reducedMotion: reduced ? 'reduce' : 'no-preference' });

    test(`the shelf ${reduced ? 'fades in without moving' : 'rises in, one cover after another'}`, async ({ page }) => {
      await recordTiles(page);
      await mockShelf(page, SHELF);
      await page.goto('/');
      await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(5);
      await page.waitForTimeout(900);
      const tiles = await page.evaluate(() => window.__tiles);
      const moved = tiles.filter((x) => x.transform !== 'none');
      if (reduced) {
        expect(moved).toEqual([]);
      } else {
        expect(moved.length).toBeGreaterThan(0);
        const firstMove = (name) => tiles.find((x) => x.text.startsWith(name) && x.transform === 'none' && tiles.some((y) => y.text.startsWith(name) && y.transform !== 'none' && y.t < x.t))?.t;
        expect(firstMove('Walden')).toBeLessThan(firstMove('A scanned')); // the first cover settles before the last
      }
    });

    test(`a book that turns ready ${reduced ? 'appears without moving' : 'arrives on the shelf'}`, async ({ page }) => {
      await recordTiles(page);
      let polls = 0;
      const origin = SHELF.find((b) => b.id === 'origin');
      await mockWrites(page, () => {
        polls += 1;
        return [SHELF[0], polls < 2 ? origin : { ...origin, status: 'ready', total_chunks: 30 }];
      });
      await page.goto('/');
      await expect(page.getByText('On the Origin of Species is ready on your shelf.')).toBeVisible({ timeout: 6000 });
      await page.waitForTimeout(900);
      const tiles = await page.evaluate(() => window.__tiles);
      const after = tiles.filter((x) => x.t > 2500 && x.text.startsWith('On the Origin'));
      const moved = after.filter((x) => x.transform !== 'none');
      if (reduced) expect(moved).toEqual([]);
      else expect(moved.some((x) => x.transform !== 'none')).toBe(true);
    });
  });
}
