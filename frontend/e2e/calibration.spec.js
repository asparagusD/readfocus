// The first-session reading pace (C13.8b), with the profile and calibrate calls answered here.
import { test, expect, BOOK } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: CORS })
  : route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** A reader who has not measured their pace yet; returns the bodies posted to calibrate. */
async function uncalibrated(page, status = 200) {
  const posted = [];
  await page.route('http://localhost:8000/auth/profile', (route) => json(route, { id: 'e2e-reader', is_calibrated: false, wpm: null }));
  await page.route('http://localhost:8000/auth/profile/calibrate', (route) => {
    if (route.request().method() === 'POST') posted.push(JSON.parse(route.request().postData()));
    return json(route, status === 200 ? { wpm: 240 } : { detail: 'Profile store is down' }, status);
  });
  return posted;
}

test('the pace check: intro, passage, then the posted pace and today’s reading', async ({ page }) => {
  const posted = await uncalibrated(page);
  await page.goto(`/read/${BOOK}`);
  await expect(page.getByRole('heading', { level: 1, name: 'How quickly do you read?' })).toBeVisible();
  await expect(page).toHaveTitle('Your reading pace · ReadFocus');
  if (shots) await page.screenshot({ path: `${shots}/calibrate-intro-1440.png` });
  await page.getByRole('button', { name: 'Start reading' }).click();
  await expect(page.getByText(/^Reading is a complex cognitive process/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/calibrate-passage-1440.png` });
  await page.getByRole('button', { name: 'I’ve finished reading' }).click();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor();
  expect(posted).toHaveLength(1);
  expect(posted[0].wpm).toBeGreaterThanOrEqual(50);
  expect(posted[0].wpm).toBeLessThanOrEqual(1000);
});

test('a failed save says so in a toast, with no native dialog, and the session goes on', async ({ page }) => {
  await uncalibrated(page, 503);
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs += 1; d.dismiss(); });
  await page.goto(`/read/${BOOK}`);
  await page.getByRole('button', { name: 'Start reading' }).click();
  await page.getByRole('button', { name: 'I’ve finished reading' }).click();
  await expect(page.getByText(/We couldn’t save your reading pace \(Profile store is down\), so we’ll plan at 200 words a minute for now\./)).toBeVisible();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor();
  expect(dialogs).toBe(0);
});

test.describe('at 375', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the passage fits without sideways scroll', async ({ page }) => {
    await uncalibrated(page);
    await page.goto(`/read/${BOOK}`);
    await page.getByRole('button', { name: 'Start reading' }).click();
    await expect(page.getByRole('button', { name: 'I’ve finished reading' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    if (shots) await page.screenshot({ path: `${shots}/calibrate-375.png`, fullPage: true });
  });
});
