// The public landing page (C13.10): signed-out visitors at "/" see it, signed-in readers still
// get their shelf, and every deep link behaves as before.
import { test, expect } from './fixtures.js';

const API = 'http://localhost:8000';

/** Every backend request the page makes, as "METHOD /path". */
function backendCalls(page) {
  const calls = [];
  page.on('request', (r) => { if (r.url().startsWith(API) && r.method() !== 'OPTIONS') calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  return calls;
}

test.describe('signed out', () => {
  test.use({ signedIn: false });

  test('"/" shows the landing page and only wakes the backend once', async ({ page }) => {
    const calls = backendCalls(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'A quiet place to read deeply.' })).toBeVisible();
    await expect(page.locator('.rf-warm')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(calls).toEqual(['GET /health']);
  });

  test('the landing page shows at once even when the backend never answers', async ({ page }) => {
    await page.route(`${API}/health`, (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'A quiet place to read deeply.' })).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.locator('.rf-warm')).toHaveCount(0);
  });

  test('Start reading opens Create account; Sign in opens sign in', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Start reading' }).first().click();
    await expect(page).toHaveURL(/\/login\?tab=signup$/);
    await expect(page.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  });

  test('deep links still send signed-out visitors to sign in', async ({ page }) => {
    for (const path of ['/dashboard', '/read/e2e-book', '/results/e2e-session']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});

test('signed in, "/" is still the shelf', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A quiet place to read deeply.' })).toHaveCount(0);
});

test.describe('hero and how it works', () => {
  test.use({ signedIn: false });

  test('the book spread cites its source and the flyleaf turns over once', async ({ page }) => {
    await page.goto('/');
    const spread = page.locator('.rf-spread');
    await expect(spread.getByText('The Fourth Book').first()).toBeVisible();
    await expect(spread.getByRole('link', { name: 'Project Gutenberg' })).toHaveAttribute('href', 'https://www.gutenberg.org/ebooks/2680');
    const leaf = page.locator('.rf-spread__leaf');
    await expect(leaf).toHaveCount(1);
    // Turned over at the spine: rotateY(-180deg) leaves a matrix3d with m11 = -1.
    await expect.poll(() => leaf.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m11), { timeout: 5000 }).toBeCloseTo(-1, 2);
  });

  test('See how it works moves to the contents page and focus follows', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'See how it works' }).click();
    await expect(page.locator('#how-it-works')).toBeFocused();
    const steps = page.locator('#how-it-works li');
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(3)).toBeVisible();
    await expect(steps.nth(0)).toContainText('Upload a PDF or EPUB');
    await expect(steps.nth(3)).toContainText('Your next session adapts');
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('no flyleaf is drawn and the steps do not move', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.rf-spread__text').first()).toBeVisible();
      await expect(page.locator('.rf-spread__leaf')).toHaveCount(0);
      await page.locator('#how-it-works').scrollIntoViewIfNeeded();
      await expect(page.locator('#how-it-works li').last()).toHaveCSS('opacity', '1');
      const transforms = await page.locator('#how-it-works li').evaluateAll((items) => items.map((el) => getComputedStyle(el).transform));
      expect(transforms).toEqual(['none', 'none', 'none', 'none']);
    });
  });
});

test.describe('word-lookup demo', () => {
  test.use({ signedIn: false });

  /** Every request that leaves the page's own origin after load. */
  function outside(page) {
    const urls = [];
    page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4174')) urls.push(r.url()); });
    return urls;
  }

  test('hovering a word opens the real card under its line; leaving closes it; no lookup is sent', async ({ page }) => {
    const urls = outside(page);
    await page.goto('/');
    const word = page.getByRole('button', { name: 'odious' });
    await word.scrollIntoViewIfNeeded();
    await word.hover();
    const card = page.getByRole('dialog', { name: 'odious' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Arousing or meriting strong dislike');
    await expect(card).toContainText('Wiktionary, via Free Dictionary');
    const w = await word.boundingBox();
    const c = await card.boundingBox();
    expect(c.y >= w.y + w.height || c.y + c.height <= w.y, 'the card never covers the line').toBe(true);
    await page.mouse.move(5, 5);
    await expect(card).toBeHidden();
    expect(urls.filter((u) => !u.endsWith('/health'))).toEqual([]);
  });

  test('a name opens a Wikipedia summary with its link', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Quadi' }).hover();
    const card = page.getByRole('dialog', { name: 'Quadi' });
    await expect(card).toContainText('Germanic people');
    await expect(card.getByRole('link', { name: /Wikipedia/ })).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Quadi');
  });

  test('keyboard: Enter opens and focuses the card, Esc closes it and returns to the word', async ({ page }) => {
    await page.goto('/');
    const word = page.getByRole('button', { name: 'kinsman' });
    await word.focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('dialog', { name: 'kinsman' });
    await expect(card).toBeFocused();
    await expect(word).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(word).toBeFocused();
  });

  test('touch: press and hold opens the compact card', async ({ page }) => {
    await page.goto('/');
    const word = page.getByRole('button', { name: 'incur' });
    await word.scrollIntoViewIfNeeded();
    const box = await word.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await word.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: point.x, clientY: point.y, isPrimary: true });
    await page.waitForTimeout(600);
    await word.dispatchEvent('pointerup', { pointerType: 'touch', clientX: point.x, clientY: point.y, isPrimary: true });
    const card = page.getByRole('dialog', { name: 'incur' });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-compact', 'true');
  });
});

test.describe('features, questions and footer', () => {
  test.use({ signedIn: false });

  test('three feature sections and the honesty note are there', async ({ page }) => {
    await page.goto('/');
    for (const name of ['Feels like a book', 'Understand every word', 'Reading that adapts', 'What ReadFocus isn’t']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeAttached();
    }
    await expect(page.locator('.rf-isnt')).toContainText('No generative AI');
  });

  test('questions open and close from the keyboard', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.rf-faq details');
    await expect(items).toHaveCount(5);
    const first = items.first();
    await first.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('open', '');
    await expect(first.getByText('PDF and EPUB.')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(first).not.toHaveAttribute('open', '');
  });

  test('the footer links the source code, credits the sources and switches the theme', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute('href', 'https://github.com/asparagusD/readfocus');
    await expect(footer).toContainText('CC BY-SA 3.0');
    await expect(footer).toContainText('CC BY-SA 4.0');
    await footer.getByRole('radio', { name: 'Lamplight (dark)' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'lamplight');
    await footer.getByRole('radio', { name: 'Paper (light)' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
    await footer.getByRole('link', { name: 'Start reading' }).click();
    await expect(page).toHaveURL(/\/login\?tab=signup$/);
  });
});

test.describe('head, sharing and first paint', () => {
  test.use({ signedIn: false });

  test('the HTML itself carries the headline, the title, the description and the share tags', async ({ page, request }) => {
    const html = await (await request.get('/')).text();
    expect(html).toContain('A quiet place to read deeply.</h1>');
    await page.goto('/');
    await expect(page).toHaveTitle('ReadFocus — read deeply, remember more');
    const meta = (sel) => page.locator(sel).first().getAttribute('content');
    expect(await meta('meta[name="description"]')).toMatch(/PDF or EPUB/);
    expect(await meta('meta[property="og:image"]')).toMatch(/\/og\.png$/);
    expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  });

  test('robots.txt opens only "/" and the share image is 1200 x 630 within budget', async ({ page, request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Allow: /$');
    expect(robots).toContain('Disallow: /');
    const og = await request.get('/og.png');
    expect(og.headers()['content-type']).toBe('image/png');
    const body = await og.body();
    expect(body.length).toBeLessThanOrEqual(150_000);
    expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([1200, 630]); // PNG IHDR width, height
    await page.goto('/');
  });

  test('a deep link never shows the prerendered landing page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-prerender', 'hidden');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expect(page.getByText('A quiet place to read deeply.')).toHaveCount(0);
  });
});

test('signed in, the prerendered landing page is hidden from the first paint', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-prerender', 'hidden');
  await expect(page.getByRole('heading', { level: 1, name: 'Your shelf' })).toBeVisible();
});

test.describe('critique fixes', () => {
  test.use({ signedIn: false, viewport: { width: 1100, height: 800 } });

  test('links in running text are underlined and nothing scrolls sideways at 1100 px', async ({ page }) => {
    await page.goto('/');
    for (const sel of ['.rf-spread__caption a', '.rf-colophon__credits a']) {
      await expect(page.locator(sel).first()).toHaveCSS('text-decoration-line', 'underline');
    }
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBe(client);
  });
});
