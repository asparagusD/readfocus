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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    const tops = await page.locator('.rf-shelf__item').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops[0]).toBe(tops[1]);
    expect(tops[1]).toBe(tops[2]);
    expect(tops[3]).toBeGreaterThan(tops[0]);
    if (shots) await page.screenshot({ path: `${shots}/library-shelf-375.png`, fullPage: true });
  });
});
