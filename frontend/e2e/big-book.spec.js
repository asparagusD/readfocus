// C26.7: a book over 50 MB stays on this device. Adding a generated 60 MB PDF makes the book with
// POST /books/device (no file sent), keeps the file in this browser, reads every page's text with pdf.js and
// sends it in batches to POST /books/{id}/pages, the last one marked; the shelf shows how far it has read.
// Over 300 MB, or a Markdown file over 50 MB, is refused before anything is sent. Mocked API.
import { writeFileSync } from 'node:fs';
import { test, expect, BOOK } from './fixtures.js';
import { bigPdf, bigPdfLine } from './bigPdf.js';

const PAGES = 12;
const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

async function mockDevice(page, { perBatch = 5 } = {}) {
  const calls = { made: [], batches: [], uploads: 0, shelf: [] };
  const reply = (route, body, status = 200) => (route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  await page.route('http://localhost:8000/books', (route) => reply(route, calls.shelf));
  await page.route('http://localhost:8000/books/upload', (route) => { calls.uploads += 1; return reply(route, {}, 500); });
  await page.route('http://localhost:8000/books/device', (route) => {
    if (route.request().method() === 'POST') {
      calls.made.push(route.request().postDataJSON());
      calls.shelf = [{ id: BOOK, title: 'Atlas Of Light', author: 'A. Maker', status: 'processing', storage_mode: 'device',
        total_chunks: null, progress: null, created_at: '2026-11-17T12:00:00Z' }];
    }
    return reply(route, { book_id: BOOK, status: 'processing', pages_per_batch: perBatch });
  });
  await page.route(`http://localhost:8000/books/${BOOK}/pages`, (route) => {
    if (route.request().method() === 'POST') calls.batches.push(route.request().postDataJSON());
    return reply(route, { received: 1, through: 1, ingesting: false });
  });
  return calls;
}

test('a 60 MB PDF stays on this device and only its text is sent, in batches', async ({ page }) => {
  test.setTimeout(90_000);
  const calls = await mockDevice(page);
  await page.goto('/');
  const buffer = bigPdf({ pages: PAGES });
  expect(buffer.length).toBeGreaterThan(60 * 1024 * 1024 - 1);
  const file = test.info().outputPath('atlas_of_light.pdf'); // Playwright takes a file over 50 MB only by path
  writeFileSync(file, buffer);
  await page.locator('input[type=file]').setInputFiles(file);
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  await expect(dialog).toContainText('Over 50 MB, so this book stays on this device');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0); // no choice: it cannot go to the server
  if (shots) { await page.waitForTimeout(800); await page.screenshot({ path: `${shots}/big-book-dialog-1440.png` }); }
  await dialog.getByLabel('Author').fill('A. Maker');
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(page.getByText('Atlas Of Light is on your shelf, kept on this device.')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => calls.batches.some((b) => b.last), { timeout: 60_000 }).toBe(true);
  expect(calls.uploads).toBe(0);
  expect(calls.made).toEqual([{ title: 'Atlas Of Light', author: 'A. Maker', file_type: 'pdf', file_bytes: buffer.length,
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
  expect(calls.batches.map((b) => [b.first, b.texts.length, b.last])).toEqual([[1, 5, false], [6, 5, false], [11, 2, true]]);
  const texts = calls.batches.flatMap((b) => b.texts);
  expect(texts).toEqual(Array.from({ length: PAGES }, (_, i) => bigPdfLine(i + 1)));
  const kept = await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('readfocus-books', 1);
    open.onsuccess = () => {
      const get = open.result.transaction('files').objectStore('files').get('e2e-book');
      get.onsuccess = () => resolve(get.result?.size ?? null);
      get.onerror = () => resolve(null);
    };
    open.onerror = () => resolve(null);
  }));
  expect(kept).toBe(buffer.length); // the file is kept in this browser for reading
});

test('over 300 MB, or a Markdown file over 50 MB, is refused before anything is sent (at 375)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const calls = await mockDevice(page);
  await page.goto('/');
  await page.locator('input[type=file]').waitFor({ state: 'attached' });
  // A stand-in File whose size says 301 MB: what matters is the size check, not the bytes.
  await page.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    const file = new File(['%PDF-1.4'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 301 * 1024 * 1024 });
    const list = new DataTransfer();
    list.items.add(file);
    Object.defineProperty(input, 'files', { value: list.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const dialog = page.getByRole('dialog', { name: 'Add to your shelf' });
  await expect(dialog).toContainText('Over 50 MB, so this book stays on this device');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  if (shots) { await page.waitForTimeout(800); await page.screenshot({ path: `${shots}/big-book-dialog-375.png` }); }
  await dialog.getByLabel('Author').fill('Someone');
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(page.getByText('huge.pdf is over 300 MB, the most a book kept on this device can be.')).toBeVisible();
  await page.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    const file = new File(['# notes'], 'notes.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });
    const list = new DataTransfer();
    list.items.add(file);
    Object.defineProperty(input, 'files', { value: list.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await dialog.getByLabel('Author').fill('Someone');
  await dialog.getByRole('button', { name: 'Add book' }).click();
  await expect(page.getByText('Over 50 MB, only a PDF or EPUB can be added')).toBeVisible();
  expect(calls.made).toEqual([]);
  expect(calls.batches).toEqual([]);
  expect(calls.uploads).toBe(0);
});
