// Warming up and the backend error screen (C13.8a), with GET /health answered here.
import { test, expect } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

/** /health answers each call with the next of `answers` (the last one repeats); returns the call count. */
async function mockHealth(page, answers) {
  const calls = { n: 0 };
  await page.route('http://localhost:8000/health', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const answer = answers[Math.min(calls.n, answers.length - 1)];
    calls.n += 1;
    if (answer === 'abort') return route.abort();
    const [status, body] = answer === 'down' ? [503, { detail: 'starting' }] : [200, { status: 'ok', model_ready: answer === 'ready' }];
    return route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  });
  return calls;
}

test('a warm start goes straight to the shelf', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
  await expect(page.locator('.rf-warm')).toHaveCount(0);
});

test('a slow start shows the warm-up room, pauses on request, then opens the shelf', async ({ page }) => {
  const calls = await mockHealth(page, ['down', 'loading', 'loading', 'ready']);
  await page.goto('/');
  const title = page.getByRole('heading', { level: 1, name: 'Warming up the reading room…' });
  await expect(title).toBeVisible();
  await expect(page).toHaveTitle('Warming up · ReadFocus');
  if (shots) await page.screenshot({ path: `${shots}/warmup-1440.png` });
  const steam = page.locator('.rf-warm__tea [data-steam="1"]');
  await expect(steam).toHaveCSS('animation-play-state', 'running');
  const pause = page.getByRole('button', { name: 'Pause animation' });
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute('aria-pressed', 'true');
  await expect(steam).toHaveCSS('animation-play-state', 'paused');
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible({ timeout: 15_000 });
  expect(calls.n).toBe(4);
});

test.describe('signed out', () => {
  test.use({ signedIn: false });

  test('the sign-in page is never held back', async ({ page }) => {
    await mockHealth(page, ['abort']);
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.locator('.rf-warm')).toHaveCount(0);
  });
});

test('no answer in 90 s shows the error screen; Try again warms up again', async ({ page }) => {
  await page.clock.install();
  const answers = ['down'];
  await mockHealth(page, answers);
  await page.goto('/');
  await page.clock.fastForward(2000);
  await expect(page.locator('.rf-warm')).toBeVisible();
  await page.clock.fastForward(90_000);
  await expect(page.getByRole('heading', { level: 1, name: 'The reading room didn’t answer.' })).toBeVisible();
  await expect(page.getByText('Error 503 · GET /health')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/backend-down-1440.png` });
  answers[0] = 'ready';
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
});

test.describe('warm-up at 375, reduced motion', () => {
  test.use({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });

  test('the steam does not loop and nothing scrolls sideways', async ({ page }) => {
    await mockHealth(page, ['loading']);
    await page.goto('/');
    await expect(page.locator('.rf-warm')).toBeVisible();
    await expect(page.locator('.rf-warm__tea [data-steam="1"]')).toHaveCSS('animation-iteration-count', '1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    if (shots) await page.screenshot({ path: `${shots}/warmup-375.png` });
  });
});
