// C26.5: the reading-pace check (C13.8b) is no longer shown: a reader who never measured their pace opens the
// book straight away, at its first page. CalibrationFlow stays in the tree until C26.6 removes it.
import { test, expect, BOOK, openReader } from './fixtures.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

test('a reader with no measured pace opens the book with no pace check', async ({ page, api }) => {
  const calibrate = [];
  await page.route('http://localhost:8000/auth/profile', (route) => (route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'e2e-reader', is_calibrated: false, wpm: null }) })));
  await page.route('http://localhost:8000/auth/profile/calibrate', (route) => { calibrate.push(route.request().method()); return route.abort(); });
  await openReader(page);
  await expect(page).toHaveURL(new RegExp(`/read/${BOOK}$`));
  await expect(page.getByRole('heading', { name: 'How quickly do you read?' })).toHaveCount(0);
  expect(api.opens).toBe(1);
  expect(api.starts).toBe(0);
  expect(calibrate).toEqual([]);
});
