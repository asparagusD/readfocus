// C34.7 (issue 15): an EPUB is read whole, so after its first open it is kept in this browser (Cache Storage,
// keyed by the book and its sha256) and the next open downloads nothing; a changed file is fetched again, and
// signing out forgets every kept file. reflow.epub, mocked API.
import { test, expect, openReader } from './fixtures.js';

test.use({ book: 'epub' });

const keptFiles = (page) => page.evaluate(async () => {
  const cache = await caches.open('readfocus-book-files-v1');
  return (await cache.keys()).length;
});

test('the second open of an EPUB reads it from this browser', async ({ page, api }) => {
  api.fileSha = 'aaaa';
  await openReader(page);
  expect(api.fileLoads).toBe(1);
  await expect.poll(() => keptFiles(page)).toBe(1);
  await openReader(page); // a new page load: the reader opens the book again
  expect(api.fileLoads).toBe(1);
});

test('a changed file is downloaded again', async ({ page, api }) => {
  api.fileSha = 'aaaa';
  await openReader(page);
  await expect.poll(() => keptFiles(page)).toBe(1);
  api.fileSha = 'bbbb';
  await openReader(page);
  expect(api.fileLoads).toBe(2);
  await expect.poll(() => keptFiles(page)).toBe(1); // the old version is replaced, not added to
});

test('signing out forgets the kept files', async ({ page, api }) => {
  await page.route(/supabase\.co\/auth\/v1\/logout/, (route) => route.fulfill({ status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }));
  api.fileSha = 'aaaa';
  await openReader(page);
  await expect.poll(() => keptFiles(page)).toBe(1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Account and reading settings' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => keptFiles(page)).toBe(0);
});
