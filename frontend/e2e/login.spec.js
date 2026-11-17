// The sign-in page (C13.1b; Google only since C28.1) signed out, with Supabase Auth answered here: nothing leaves the machine.
import { test, expect } from './fixtures.js';

test.use({ signedIn: false });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const USER = { id: 'e2e-reader', aud: 'authenticated', role: 'authenticated', email: 'reader@e2e.test', app_metadata: {}, user_metadata: {} };

const session = () => ({
  access_token: 'e2e-token', refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER,
});

/** C28.1: Supabase's Google hand-off, answered here. `back(url)` is where "Google" sends the reader. */
async function mockGoogle(page, back) {
  const calls = { authorize: [], token: [] };
  await page.route(/supabase\.co\/auth\/v1\/authorize/, (route) => {
    const url = new URL(route.request().url());
    calls.authorize.push(url);
    return route.fulfill({ status: 302, headers: { Location: back(url) } });
  });
  await page.route(/supabase\.co\/auth\/v1\/token/, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls.token.push({ grant: new URL(request.url()).searchParams.get('grant_type'), body: JSON.parse(request.postData() || '{}') });
    return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(session()) });
  });
  return calls;
}

test('the sign-in page offers Google and nothing else', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle('Sign in · ReadFocus');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await expect(page.getByLabel('Password')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
});

test('Start reading opens with the new-reader words', async ({ page }) => {
  await page.goto('/login?tab=signup');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Make yourself a shelf');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('Continue with Google, by keyboard, comes back signed in and opens the library', async ({ page }) => {
  const calls = await mockGoogle(page, (url) => `${url.searchParams.get('redirect_to')}?code=e2e-code`);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
  const [authorize] = calls.authorize;
  expect(authorize.searchParams.get('provider')).toBe('google');
  expect(authorize.searchParams.get('redirect_to')).toMatch(/^http:\/\/localhost:\d+\/login$/);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
  expect(calls.token.map((c) => [c.grant, c.body.auth_code])).toEqual([['pkce', 'e2e-code']]);
});

test('a refusal from Google is shown on the sign-in page', async ({ page }) => {
  await mockGoogle(page, (url) => `${url.searchParams.get('redirect_to')}?error=access_denied&error_description=${encodeURIComponent('The reader said no.')}`);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('alert')).toHaveText('The reader said no.');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});

test('under reduced motion the form and the drawings do not move', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.__frames = [];
    const sample = () => {
      for (const el of document.querySelectorAll('.rf-login__card, .rf-login__art')) window.__frames.push(getComputedStyle(el).transform);
      if (window.__frames.length < 120) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/login');
  await page.waitForFunction(() => window.__frames.length >= 120);
  const moved = await page.evaluate(() => window.__frames.filter((t) => t !== 'none'));
  expect(moved).toEqual([]);
});
