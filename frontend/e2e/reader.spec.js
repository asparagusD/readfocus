// The reader and word lookup end to end (C12.10), on the real /read page with the API mocked.
import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect, openReader, spoken, timeToCard, wordPoint } from './fixtures.js';

/** The first block whose box is inside the page window: what the reader is looking at. */
const firstVisibleBlock = (page) => page.evaluate(() => {
  const vp = document.querySelector('.rf-viewport').getBoundingClientRect();
  const inside = (el) => [...el.getClientRects()].some((r) => r.right > vp.left + 1 && r.left < vp.right - 1 && r.bottom > vp.top && r.top < vp.bottom);
  return [...document.querySelectorAll('.rf-viewport .rf-flow [data-b]')].find(inside)?.dataset.b ?? null;
});
const blockVisible = (page, id) => page.evaluate((b) => {
  const vp = document.querySelector('.rf-viewport').getBoundingClientRect();
  const el = document.querySelector(`.rf-viewport .rf-flow [data-b="${b}"]`);
  return [...el.getClientRects()].some((r) => r.right > vp.left + 1 && r.left < vp.right - 1 && r.bottom > vp.top && r.top < vp.bottom);
}, id);

test.describe('pagination and page turns', () => {
  test('arrow keys, the turn buttons and the page edge turn the page', async ({ page, api }) => {
    await openReader(page);
    await expect(spoken(page)).toHaveText(/^Pages 1 and 2 of \d+$/);
    await page.locator('.rf-book').focus();
    await page.keyboard.press('ArrowRight');
    await expect(spoken(page)).toHaveText(/^Pages 3 and 4 of/);
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(spoken(page)).toHaveText(/^Pages 5 and 6 of/);
    await page.locator('.rf-book').focus(); // the arrow keys belong to the book; the button keeps focus after a click
    await page.keyboard.press('ArrowLeft');
    await expect(spoken(page)).toHaveText(/^Pages 3 and 4 of/);
    await page.locator('.rf-edge[data-edge="forward"]').click({ force: true }); // a pointer-only target
    await expect(spoken(page)).toHaveText(/^Pages 5 and 6 of/);
    expect(api.starts).toBe(1);
  });

  test('the place is saved and restored after a reload', async ({ page, api }) => {
    await openReader(page);
    await page.locator('.rf-book').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(spoken(page)).toHaveText(/^Pages 5 and 6 of/);
    await expect.poll(() => api.saves, { timeout: 4000 }).toBeGreaterThan(0); // debounced 1 s
    const saved = api.position;
    expect(saved).toMatchObject({ chunk_index: expect.any(Number), block_id: expect.stringMatching(/^\d+\.\d+$/) });
    await page.reload();
    await page.locator('.rf-viewport .rf-flow p').first().waitFor();
    await expect(spoken(page)).toHaveText(/^Pages 5 and 6 of/);
    expect(api.starts).toBe(2);
    expect(await blockVisible(page, saved.block_id)).toBe(true);
  });

  test('re-pagination on resize keeps the same paragraph in view', async ({ page }) => {
    await openReader(page);
    await page.locator('.rf-book').focus();
    await page.keyboard.press('ArrowRight');
    await expect(spoken(page)).toHaveText(/^Pages 3 and 4 of/);
    await page.waitForTimeout(800); // the leaf lands
    const block = await firstVisibleBlock(page);
    expect(block).not.toBeNull();
    for (const size of [{ width: 1100, height: 760 }, { width: 800, height: 1000 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(500);
      expect(await blockVisible(page, block), `${block} in view at ${size.width}x${size.height}`).toBe(true);
    }
  });

  test('reduced motion turns the page with no animated leaf', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openReader(page);
    await page.locator('.rf-book').focus();
    await page.keyboard.press('ArrowRight');
    await expect(spoken(page)).toHaveText(/^Pages 3 and 4 of/);
    const during = await page.evaluate(() => ({
      leaf: document.querySelectorAll('.rf-face').length,
      turning: document.querySelector('.rf-book').dataset.turning,
      animations: document.getAnimations().filter((a) => a.playState === 'running').length,
    }));
    expect(during).toEqual({ leaf: 0, turning: 'false', animations: 0 });
  });
});

test("the last page's Start test takes a mouse click and finishes reading", async ({ page }) => {
  // Regression (docs/DEBUG_LOG.md, C13.4): the text viewport lay over the closing page, so the button
  // could be reached by keyboard only.
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const answer = (route, body) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: cors })
    : route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let finished = 0;
  await page.route('http://localhost:8000/sessions/e2e-session/finish-reading', (route) => { if (route.request().method() === 'POST') finished += 1; return answer(route, {}); });
  await page.route('http://localhost:8000/sessions/e2e-session', (route) => answer(route, { id: 'e2e-session', test_questions: [{ question: 'What did Thoreau build?', type: 'free_text' }] }));
  await openReader(page);
  await page.locator('.rf-book').focus();
  await page.keyboard.press('End');
  await expect(spoken(page)).toHaveText(/End of today's reading/);
  await expect(page.locator('.rf-end')).toHaveCount(1);
  await page.locator('.rf-end').getByRole('button', { name: 'Start test' }).click({ timeout: 3000 });
  await expect(page).toHaveURL(/\/test\/e2e-session$/);
  expect(finished).toBe(1);
});

test.describe('word lookup', () => {
  test('a known word shows its card within 600 ms once cached, and Esc closes it', async ({ page, api }) => {
    await openReader(page);
    const woods = await wordPoint(page, 'woods');
    await page.mouse.move(5, 5);
    await page.mouse.move(woods.x, woods.y);
    const card = page.locator('.rf-wordcard[data-kind="definition"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('A dense collection of trees');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    // Again: the answer is in the client's cache, so only the hover intent stands between.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    const elapsed = await timeToCard(page, woods); // the 350 ms hover intent plus the cached answer
    expect(elapsed).toBeLessThan(600);
    await expect(card).toBeVisible();
    expect(api.lookups.filter((l) => l.term === 'woods')).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
  });

  test('a proper noun shows a Wikipedia summary with a link', async ({ page, api }) => {
    await openReader(page);
    const concord = await wordPoint(page, 'Concord');
    await page.mouse.move(5, 5);
    await page.mouse.move(concord.x, concord.y);
    const card = page.locator('.rf-wordcard[data-kind="summary"]');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading')).toHaveText('Concord, Massachusetts');
    const link = card.getByRole('link', { name: /Wikipedia/ });
    await expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Concord,_Massachusetts');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(api.lookups).toContainEqual({ term: 'Concord', proper: true });
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    test('a long-press opens the compact sheet below the word', async ({ page }) => {
      await openReader(page);
      const woods = await wordPoint(page, 'woods');
      const cdp = await page.context().newCDPSession(page);
      const touch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: woods.x, y: woods.y }] });
      const before = await spoken(page).textContent();
      await touch('touchStart');
      await page.waitForTimeout(600);
      await touch('touchEnd');
      const sheet = page.locator('.rf-wordcard[data-compact]');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Tap outside to close');
      const box = await sheet.boundingBox();
      expect(box.y >= woods.bottom || box.y + box.height <= woods.top, 'the sheet leaves the word uncovered').toBe(true);
      expect(await spoken(page).textContent()).toBe(before); // no page turn
    });
  });
});

test.describe('the toolbar at 375', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // C13.9: the tools on one row (handoff 375 frame), the session's controls on one row under them.
  test('two rows, not three: tools above, the session below', async ({ page }) => {
    await openReader(page);
    const box = (locator) => locator.boundingBox();
    const toolbar = page.getByRole('toolbar', { name: 'Reading controls' });
    const back = await box(toolbar.getByRole('button', { name: 'Back to the library' }));
    const theme = await box(toolbar.getByRole('radiogroup', { name: 'Theme' }));
    const done = await box(toolbar.getByRole('button', { name: 'Done reading' }));
    const abandon = await box(toolbar.getByRole('button', { name: 'Abandon session' }));
    expect(Math.abs(theme.y - back.y)).toBeLessThan(4); // the theme toggle shares the tools' row
    expect(done.y).toBeGreaterThan(back.y + back.height - 1); // the session row is under it
    expect(Math.abs(abandon.y - done.y)).toBeLessThan(4);
    expect((await box(toolbar)).height).toBeLessThanOrEqual(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  });
});

// C13.9: a stopped session clock says so in words, at 1440 and at 375.
for (const width of [1440, 375]) {
  test(`the session clock reads Start, then Resume, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await openReader(page);
    const session = page.getByRole('group', { name: 'Session' });
    await expect(session.getByRole('timer')).toHaveAccessibleName('Time left 20:00');
    const start = session.getByRole('button', { name: 'Start the timer' });
    await expect(start).toHaveText('Start');
    await expect(start.getByText('Start')).toBeVisible();
    await start.click();
    await expect(session.getByRole('button', { name: 'Pause the timer' })).toHaveText('');
    await session.getByRole('button', { name: 'Pause the timer' }).click();
    await expect(session.getByRole('button', { name: 'Resume the timer' })).toHaveText('Resume');
  });
}

test('page-turn frame rate and lookup timings (recorded in docs/BENCHMARKS.md)', async ({ page }, info) => {
  await openReader(page);
  await page.locator('.rf-book').focus();
  // requestAnimationFrame sampling over five turns, each given time to land; then the same at 4x CPU.
  const measureTurns = async () => {
    await page.evaluate(() => {
      window.__frames = [];
      const tick = (t) => { window.__frames.push(t); window.__raf = requestAnimationFrame(tick); };
      window.__raf = requestAnimationFrame(tick);
    });
    const from = await page.evaluate(() => performance.now());
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press(i < 3 ? 'ArrowRight' : 'ArrowLeft');
      await page.waitForTimeout(800);
    }
    const frames = await page.evaluate((t0) => { cancelAnimationFrame(window.__raf); return window.__frames.filter((t) => t >= t0); }, from);
    const gaps = frames.slice(1).map((t, i) => t - frames[i]);
    const seconds = (frames.at(-1) - frames[0]) / 1000;
    return { frames: frames.length, seconds: +seconds.toFixed(2), fps: +(gaps.length / seconds).toFixed(1),
      worstFrameMs: +Math.max(...gaps).toFixed(1), over33ms: gaps.filter((g) => g > 33.4).length };
  };
  const turn = await measureTurns();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const turnThrottled = await measureTurns();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // Hover to card, answers from the mock (no network): first time and cached, back on page 1.
  await page.keyboard.press('Home');
  await page.waitForTimeout(900);
  const woods = await wordPoint(page, 'woods');
  const timeCard = async () => {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const ms = await timeToCard(page, woods);
    await page.keyboard.press('Escape');
    return ms;
  };
  const lookup = { firstMs: await timeCard(), cachedMs: [] };
  for (let i = 0; i < 5; i += 1) lookup.cachedMs.push(await timeCard());
  const result = { date: new Date().toISOString(), browser: info.project.use.channel ?? 'chromium', turn, turnThrottled, lookup };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/reader-benchmarks.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  expect(turn.fps).toBeGreaterThan(30);
  expect(Math.max(...lookup.cachedMs)).toBeLessThan(600);
});
