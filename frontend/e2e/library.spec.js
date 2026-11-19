// The library (C13.3), with the API mocked: loading, empty, error and a shelf of five.
import { createHash } from 'node:crypto';
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
  await expect(shelf.getByRole('link', { name: /On the Origin/ })).toHaveAttribute('href', '/read/origin'); // C26.3: opens while processed
  await expect(shelf).toContainText('25% read');
  await expect(shelf).toContainText('New · not started');
  await expect(shelf).toContainText('Preparing the book…');
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
async function mockWrites(page, shelf, { progress = 0.64, failUpload = false, uploaded = {}, deleteAnswer = null, holdPut = null } = {}) {
  const calls = { uploads: [], deletes: [], statuses: 0, puts: [] };
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
      if (deleteAnswer) return deleteAnswer(route, json); // C35.2: held or failed
      return json(route, { status: 'deleting', book_id: path.split('/').pop() }, 202);
    }
    return route.fallback();
  });
  await page.route('http://localhost:8000/books/upload', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = req.postDataBuffer()?.toString('latin1') ?? '';
    const field = (name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
    calls.uploads.push({ title: field('title'), author: field('author'), mode: field('storage_mode'), file: /filename="([^"]+)"/.exec(body)?.[1] });
    if (failUpload) return json(route, { detail: 'That file is too large' }, 400);
    return json(route, { book_id: 'new-book', status: 'processing', ...uploaded });
  });
  // C35.3e: a PDF or EPUB kept on our server goes straight to Storage: a signed URL, the PUT, then register.
  const asked = {};
  await page.route('http://localhost:8000/books/upload-url', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    Object.assign(asked, req.postDataJSON());
    if (failUpload) return json(route, { detail: 'That file is too large' }, 413);
    const fileType = asked.filename.split('.').pop().toLowerCase();
    return json(route, { book_id: 'new-book', file_type: fileType, token: 't', max_bytes: 52428800,
      upload_url: `${STORAGE}/storage/v1/object/upload/sign/books/u/new-book.${fileType}?token=t` });
  });
  await page.route(`${STORAGE}/storage/v1/object/upload/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls.puts.push({ method: req.method(), url: req.url(), type: req.headers()['content-type'], upsert: req.headers()['x-upsert'],
      bytes: req.postDataBuffer()?.length ?? 0 });
    if (holdPut) await holdPut;
    return json(route, { Key: 'books/u/new-book.pdf' });
  });
  await page.route('http://localhost:8000/books/register', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = req.postDataJSON();
    calls.uploads.push({ title: body.title, author: body.author, mode: 'cloud', file: asked.filename });
    return json(route, { book_id: body.book_id, status: 'processing', source_format: null, notes: [], author: null, ...uploaded });
  });
  return calls;
}

const STORAGE = 'https://lvfhuszvuiowyeizstru.supabase.co'; // the CSP's own project host, as a real signed URL
const keptFiles = (page) => page.evaluate(async () => (await (await caches.open('readfocus-book-files-v1')).keys()).map((r) => r.url));

const PDF = { name: 'the_age_of_innocence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') };

test('adding a book: picker, an inline error for the title, the author optional, a toast and a processing tile', async ({ page }) => {
  const calls = await mockWrites(page, () => SHELF.slice(0, 3), { uploaded: { author: 'Edith Wharton' } });
  await page.goto('/');
  await page.getByRole('list').waitFor();
  await page.locator('input[type=file]').setInputFiles(PDF);
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  await expect(dialog).toContainText('the_age_of_innocence.pdf');
  await expect(dialog.getByLabel('Title')).toHaveValue('The Age Of Innocence');
  await expect(dialog.getByLabel('Author (optional)')).toHaveAccessibleDescription('Leave it blank and we’ll use the name in the file, if it has one.');
  await dialog.getByLabel('Title').fill('');
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(dialog.getByLabel('Title')).toHaveAccessibleDescription('Enter the book’s title.');
  await expect(dialog.getByLabel('Title')).toBeFocused();
  expect(calls.uploads).toEqual([]);
  await dialog.getByLabel('Title').fill('The Age Of Innocence');
  await dialog.getByLabel('Title').press('Enter'); // C30.2: no author typed; the server reads it from the file
  await expect(dialog).toBeHidden();
  expect(calls.uploads).toEqual([{ title: 'The Age Of Innocence', author: '', mode: 'cloud', file: 'the_age_of_innocence.pdf' }]);
  await expect(page.getByText('The Age Of Innocence is on your shelf. Open it now; the pages you read can be quizzed as you go.')).toBeVisible();
  await expect(page.locator('.rf-shelf__item').first()).toContainText('Preparing the book…');
  await expect(page.locator('.rf-shelf__item').first()).toContainText('Edith Wharton');
});

// C35.3e (issue 16): the file goes straight to Storage with its progress shown, then is registered, and is kept
// in this browser under its own sha256 for its first open.
test('a PDF goes straight to Storage with its progress, then onto the shelf, kept in this browser', async ({ page }) => {
  let release;
  const holdPut = new Promise((resolve) => { release = resolve; });
  const calls = await mockWrites(page, () => SHELF.slice(0, 3), { holdPut });
  await page.goto('/');
  await page.getByRole('list').waitFor();
  await page.locator('input[type=file]').setInputFiles(PDF);
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  await dialog.getByRole('button', { name: 'Add book' }).click();
  const bar = dialog.getByRole('progressbar', { name: 'Sending the file' });
  await expect(bar).toBeVisible();
  await expect(dialog).toContainText(/Sending the file: \d+%|Sent\. Putting it on your shelf…/);
  expect(calls.uploads).toEqual([]); // registered only once Storage has the file
  if (shots) {
    await dialog.screenshot({ path: `${shots}/upload-progress-1440.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await dialog.screenshot({ path: `${shots}/upload-progress-375.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  }
  release();
  await expect(dialog).toBeHidden();
  expect(calls.puts).toEqual([{ method: 'PUT', url: `${STORAGE}/storage/v1/object/upload/sign/books/u/new-book.pdf?token=t`,
    type: 'application/pdf', upsert: 'false', bytes: PDF.buffer.length }]);
  expect(calls.uploads).toEqual([{ title: 'The Age Of Innocence', author: '', mode: 'cloud', file: 'the_age_of_innocence.pdf' }]);
  const sha = createHash('sha256').update(PDF.buffer).digest('hex');
  await expect.poll(() => keptFiles(page)).toEqual([`https://book-files.readfocus.invalid/new-book/${sha}`]);
  await expect(page.locator('.rf-shelf__item').first()).toContainText('Preparing the book…');
});

test('a refused direct upload never registers and keeps the dialog open', async ({ page }) => {
  const calls = await mockWrites(page, () => SHELF.slice(0, 3));
  await page.route(`${STORAGE}/storage/v1/object/upload/**`, (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: 413, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'The object exceeded the maximum allowed size' }) }));
  await page.goto('/');
  await page.getByRole('list').waitFor();
  await page.locator('input[type=file]').setInputFiles(PDF);
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(page.getByText('We couldn’t add that book: The object exceeded the maximum allowed size.')).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(calls.uploads).toEqual([]);
  expect(await keptFiles(page)).toEqual([]);
});

test('a book with no author shows “Unknown author” on the shelf (C30.2)', async ({ page }) => {
  await mockWrites(page, () => [{ ...SHELF[0], author: null }]);
  await page.goto('/');
  await expect(page.locator('.rf-shelf__item').first().locator('.rf-shelf__author')).toHaveText('Unknown author');
});

test('a notebook is converted on the server: no device choice, sent to keep, missing images listed (C19.2c)', async ({ page }) => {
  const notes = ['Image not included: https://example.org/a.png (remote images are not downloaded)',
    'Image not included: figures/b.png (not in the upload)', 'Image not included: figures/c.png (not in the upload)'];
  const calls = await mockWrites(page, () => SHELF.slice(0, 3), { uploaded: { source_format: 'ipynb', notes } });
  await page.goto('/');
  await page.getByRole('list').waitFor();
  await expect(page.locator('input[type=file]')).toHaveAttribute('accept', '.pdf,.epub,.md,.markdown,.zip,.ipynb');
  await page.locator('input[type=file]').setInputFiles({ name: 'fourier_lab.ipynb', mimeType: 'application/x-ipynb+json', buffer: Buffer.from('{}') });
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog).toContainText('We’ll turn it into a book on our server, keeping its equations, code and images');
  await dialog.getByLabel('Author').fill('Ada Lovelace');
  if (shots) await page.screenshot({ path: `${shots}/library-convert-dialog.png` });
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(dialog).toBeHidden();
  expect(calls.uploads).toEqual([{ title: 'Fourier Lab', author: 'Ada Lovelace', mode: 'cloud', file: 'fourier_lab.ipynb' }]);
  await expect(page.getByText('3 images couldn’t be included: https://example.org/a.png (remote images are not downloaded); figures/b.png (not in the upload) and 1 more.')).toBeVisible();
});

test('a device-only book: the choice is sent, the file stays in this browser, the shelf says so (C17.1)', async ({ page }) => {
  const calls = await mockWrites(page, () => SHELF.slice(0, 3));
  await page.goto('/');
  await page.getByRole('list').waitFor();
  await page.locator('input[type=file]').setInputFiles(PDF);
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  const keep = dialog.getByRole('checkbox', { name: /Keep the file on this device only/ });
  await expect(keep).not.toBeChecked();
  await dialog.getByLabel('Author').fill('Edith Wharton');
  await keep.check();
  if (shots) await page.screenshot({ path: `${shots}/library-device-only-dialog.png` });
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(dialog).toBeHidden();
  expect(calls.uploads.map((u) => u.mode)).toEqual(['device']);
  await expect(page.locator('.rf-shelf__item').first()).toContainText('This book is only on this device');
  const kept = await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('readfocus-books', 1);
    open.onsuccess = () => {
      const get = open.result.transaction('files').objectStore('files').get('new-book');
      get.onsuccess = () => resolve(get.result?.size ?? null);
    };
    open.onerror = () => resolve(null);
  }));
  expect(kept).toBe(PDF.buffer.length);
  if (shots) {
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    await page.getByRole('button', { name: 'Dismiss notification' }).waitFor({ state: 'detached' });
    const tile = page.locator('.rf-shelf__item').first();
    for (const [width, scheme] of [[1440, 'light'], [1440, 'dark'], [375, 'light'], [375, 'dark']]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await tile.screenshot({ path: `${shots}/library-device-only-tile-${width}-${scheme}.png` });
    }
  }
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
  await expect(page.getByText('photo.jpg isn’t a PDF, EPUB, Markdown file or notebook, so it can’t go on the shelf.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a processing book shows how far its quizzes are, then says when the first are ready', async ({ page }) => {
  let polls = 0;
  const origin = SHELF.find((b) => b.id === 'origin');
  const calls = await mockWrites(page, () => {
    polls += 1;
    return [SHELF[0], polls < 3 ? origin : { ...origin, status: 'ready', total_chunks: 30 }];
  });
  await page.clock.install(); // C35.6: the polls back off (5 s, then 10 s, ...); the test moves the clock
  await page.goto('/');
  const tile = page.locator('.rf-shelf__item').filter({ hasText: 'On the Origin of Species' });
  await expect(tile).toContainText('Preparing the book…');
  await page.clock.runFor(5000); // the first poll: the list, then each processing book's status
  await expect(tile).toContainText('Preparing the book… 64%');
  expect(calls.statuses).toBe(1);
  await page.clock.runFor(9000); // the second poll waits 10 s, not 5
  expect(polls).toBe(2);
  await page.clock.runFor(1000);
  await expect(page.getByText('On the Origin of Species: your first quizzes are ready.')).toBeVisible();
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

// C35.2 (issue 18): the book leaves the shelf at once, before the server answers; a failure puts it back.
test('a removed book leaves the shelf before the server answers', async ({ page }) => {
  let answer;
  const answered = new Promise((resolve) => { answer = resolve; });
  const calls = await mockWrites(page, () => SHELF.slice(0, 3), {
    deleteAnswer: async (route, json) => { await answered; return json(route, { status: 'deleting' }, 202); },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Remove Middlemarch from your shelf' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('Middlemarch is off your shelf.')).toBeVisible();
  expect(calls.deletes).toEqual(['/books/middlemarch']); // asked, not yet answered
  answer();
  await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(2);
});

test('a removal that fails puts the book back where it was and says so', async ({ page }) => {
  await mockWrites(page, () => SHELF.slice(0, 3), { deleteAnswer: (route, json) => json(route, { detail: 'down' }, 503) });
  await page.goto('/');
  const titles = () => page.locator('.rf-shelf__item .rf-shelf__title').allTextContents();
  await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(3);
  const before = await titles();
  expect(before).toContain('Middlemarch');
  await page.getByRole('button', { name: 'Remove Middlemarch from your shelf' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText(/We couldn’t remove Middlemarch, so it is back on your shelf/)).toBeVisible();
  await expect.poll(titles).toEqual(before);
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
      await expect(page.getByText('On the Origin of Species: your first quizzes are ready.')).toBeVisible({ timeout: 6000 });
      await page.waitForTimeout(900);
      const tiles = await page.evaluate(() => window.__tiles);
      const after = tiles.filter((x) => x.t > 2500 && x.text.startsWith('On the Origin'));
      const moved = after.filter((x) => x.transform !== 'none');
      if (reduced) expect(moved).toEqual([]);
      else expect(moved.some((x) => x.transform !== 'none')).toBe(true);
    });
  });
}
