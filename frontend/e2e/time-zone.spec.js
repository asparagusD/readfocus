// The reader's time zone (GAMIFICATION G6, after C24.6): taken from the browser while the stored one is the
// default UTC, never changed silently after that, and switchable in the league settings.
import { test, expect, PROGRESS } from './fixtures.js';

const progressLink = (page) => page.getByRole('link', { name: /^Level \d+/ });

test.describe('on a device in Dhaka', () => {
  test.use({ timezoneId: 'Asia/Dhaka' });

  test('a reader still on the default UTC gets this device’s zone, once', async ({ page, api }) => {
    api.progress = { ...PROGRESS, timezone: 'UTC' };
    await page.goto('/');
    await expect(progressLink(page)).toBeVisible();
    await expect.poll(() => api.progressPuts).toEqual([{ timezone: 'Asia/Dhaka' }]);
    await page.goto('/dashboard'); // stored now: nothing more is sent
    await expect(progressLink(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(api.progressPuts).toEqual([{ timezone: 'Asia/Dhaka' }]);
  });

  test('a zone already stored is never changed silently', async ({ page, api }) => {
    await page.goto('/');
    await expect(progressLink(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(api.progress.timezone).toBe('Europe/London');
    expect(api.progressPuts).toEqual([]);
  });

  test('the settings say which zone the days follow and switch to this device’s on request', async ({ page, api }) => {
    await page.goto('/league');
    const card = page.getByRole('region', { name: 'Your league settings' });
    await expect(card).toContainText('Your days and streak follow Europe/London.');
    await card.getByRole('button', { name: 'Use this device’s time zone (Asia/Dhaka)' }).click();
    await expect(page.getByText('Your days now follow Asia/Dhaka.')).toBeVisible();
    expect(api.progressPuts).toEqual([{ timezone: 'Asia/Dhaka' }]);
    await expect(card).toContainText('Your days and streak follow Asia/Dhaka.');
    await expect(card.getByRole('button', { name: /Use this device’s time zone/ })).toHaveCount(0);
  });

  test('a refused zone changes nothing and says so', async ({ page }) => {
    await page.route('http://localhost:8000/me/progress', (route) => (route.request().method() === 'PUT'
      ? route.fulfill({ status: 422, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: '{"detail":"That is not a known time zone."}' })
      : route.fallback()));
    await page.goto('/league');
    const card = page.getByRole('region', { name: 'Your league settings' });
    await card.getByRole('button', { name: 'Use this device’s time zone (Asia/Dhaka)' }).click();
    await expect(page.getByText('The time zone was not changed. Try again in a moment.')).toBeVisible();
    await expect(card).toContainText('Your days and streak follow Europe/London.');
  });
});

test.describe('on a device set to UTC', () => {
  test.use({ timezoneId: 'UTC' });

  test('nothing is adopted and no switch is offered when the zones agree', async ({ page, api }) => {
    api.progress = { ...PROGRESS, timezone: 'UTC' };
    await page.goto('/league');
    const card = page.getByRole('region', { name: 'Your league settings' });
    await expect(card).toContainText('Your days and streak follow UTC.');
    await expect(card.getByRole('button', { name: /Use this device’s time zone/ })).toHaveCount(0);
    expect(api.progressPuts).toEqual([]);
  });
});
