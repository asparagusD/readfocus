// The privacy page (C25.1): public, static, outside the backend gate; the honest Steve statement; linked from the
// landing footer, the honesty note, the answers and the account menu (Steve's notice: steve-panel.spec.js).
import { test, expect } from './fixtures.js';

const API = 'http://localhost:8000';
const LEAD = /quizzes, grading, planning and scoring are algorithmic and run on our servers\. Steve, the optional study assistant, uses Google’s Gemini; when you ask Steve something, the relevant passages and your question are sent to Google and, on the free tier, may be used to improve Google’s products\. You can turn Steve off\./;

test.describe('signed out', () => {
  test.use({ signedIn: false });

  test('the page says what is kept, what goes to Google and how to delete, without waking the backend', async ({ page }) => {
    const calls = [];
    page.on('request', (r) => { if (r.url().startsWith(API)) calls.push(r.url()); });
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
    await expect(page).toHaveTitle('Privacy — ReadFocus');
    await expect(page.locator('.rf-privacy__lead')).toHaveText(LEAD);
    for (const name of ['What we keep', 'What goes to Google, and when', 'Other services', 'Who sees what', 'Deleting']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Google’s terms for it' })).toHaveAttribute('href', 'https://aistudio.google.com/docs/terms');
    await expect(page.getByText('Send book text to Gemini', { exact: false })).toBeVisible();
    await expect(page.getByText(/deleting your whole account is done by hand, on request/)).toBeVisible();
    await expect(page.locator('.rf-warm')).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  test('the landing footer, the honesty note and an answer link to it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
    await page.getByRole('link', { name: 'ReadFocus, home' }).click();
    const sent = page.locator('.rf-faq details', { hasText: 'What’s sent to Google?' });
    await sent.locator('summary').click();
    await sent.getByRole('link', { name: 'privacy page' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });

  for (const [width, height] of [[375, 812], [1440, 900]]) {
    for (const theme of ['paper', 'lamplight']) {
      test(`${width} px in ${theme}: no sideways scroll, a readable measure, the skip link`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.addInitScript((t) => localStorage.setItem('rf-theme', t), theme);
        await page.goto('/privacy');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const box = await page.locator('.rf-privacy__page p').first().boundingBox();
        expect(box.width).toBeLessThanOrEqual(720);
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
      });
    }
  }
});

test('signed in, the account menu opens the privacy page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account and reading settings' }).click();
  await page.getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
});
