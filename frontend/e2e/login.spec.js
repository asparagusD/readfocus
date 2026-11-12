// The sign-in page (C13.1b) signed out, with Supabase Auth answered here: nothing leaves the machine.
import { test, expect } from './fixtures.js';

test.use({ signedIn: false });

const AUTH = /supabase\.co\/auth\/v1\/(token|signup)/;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const USER = { id: 'e2e-reader', aud: 'authenticated', role: 'authenticated', email: 'reader@e2e.test', app_metadata: {}, user_metadata: {} };

/** Answer Supabase Auth: `reply(path, body)` returns [status, json]; every request is recorded. */
async function mockAuth(page, reply, { delay = 0 } = {}) {
  const calls = [];
  await page.route(AUTH, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(request.url()).pathname;
    const body = JSON.parse(request.postData() || '{}');
    calls.push({ path, body });
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const [status, json] = reply(path, body);
    return route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
  });
  return calls;
}

const session = () => ({
  access_token: 'e2e-token', refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER,
});

test('empty fields are explained inline and nothing is sent', async ({ page }) => {
  const calls = await mockAuth(page, () => [500, {}]);
  await page.goto('/login');
  await expect(page).toHaveTitle('Sign in · ReadFocus');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  const email = page.getByLabel('Email');
  await expect(email).toBeFocused();
  await expect(email).toHaveAccessibleDescription('Enter your email address.');
  await expect(page.getByLabel('Password')).toHaveAccessibleDescription('Enter your password.');
  expect(calls).toEqual([]);
});

test('a wrong password shows loading, then an error on the password field', async ({ page }) => {
  const calls = await mockAuth(page, () => [400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }], { delay: 400 });
  await page.goto('/login');
  await page.getByLabel('Email').fill('reader@e2e.test');
  await page.getByLabel('Password').fill('not-it');
  await page.getByLabel('Password').press('Enter');
  const submit = page.locator('form button[type=submit]');
  await expect(submit).toHaveText('Signing in…');
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  const password = page.getByLabel('Password');
  await expect(password).toHaveAccessibleDescription('That password doesn’t match this email.');
  await expect(password).toBeFocused();
  await expect(submit).toHaveText('Sign in');
  expect(calls).toEqual([{ path: '/auth/v1/token', body: { email: 'reader@e2e.test', password: 'not-it', gotrue_meta_security: {} } }]);
});

test('a correct password opens the library', async ({ page }) => {
  await mockAuth(page, () => [200, session()]);
  await page.goto('/login');
  await page.getByLabel('Email').fill(' reader@e2e.test ');
  await page.getByLabel('Password').fill('right-one');
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/\/$/);
});

test('create account by keyboard: the tab, a short password, then the inbox message', async ({ page }) => {
  const calls = await mockAuth(page, () => [200, USER]);
  await page.goto('/login');
  const signIn = page.getByRole('tab', { name: 'Sign in' });
  await signIn.focus();
  await page.keyboard.press('ArrowRight');
  const create = page.getByRole('tab', { name: 'Create account' });
  await expect(create).toBeFocused();
  await expect(create).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Make yourself a shelf');
  await page.getByLabel('Your name').fill('Reader');
  await page.getByLabel('Email').fill('new@e2e.test');
  await page.getByLabel('Password').fill('short');
  await page.getByLabel('Password').press('Enter');
  await expect(page.getByLabel('Password')).toHaveAccessibleDescription('Use at least 6 characters.');
  expect(calls).toEqual([]);
  await page.getByLabel('Password').fill('long enough');
  await page.getByLabel('Password').press('Enter');
  await expect(page.getByRole('status')).toContainText('We sent a confirmation link to new@e2e.test');
  expect(calls.map((c) => [c.path, c.body.email, c.body.password])).toEqual([['/auth/v1/signup', 'new@e2e.test', 'long enough']]);
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
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
