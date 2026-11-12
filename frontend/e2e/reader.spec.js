// The reader end to end (C12.10; on the original view since C17.5), on the real /read page with the
// API mocked, once on a PDF (e2e/fixtures/books/sample.pdf) and once on an illustrated EPUB (reflow.epub).
import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect, book, openReader, shown, spoken, timeToCard, wordPoint } from './fixtures.js';

/** "5" -> 5; "2:340" -> [2, 340]. */
const at = (spot) => (spot.includes(':') ? spot.split(':').map(Number) : Number(spot));
const before = (a, b) => (Array.isArray(a) ? a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) : a < b);
/** True when the place `spot` lies between the shown start and end. */
const holds = ({ start, end }, spot) => !before(at(spot), at(start)) && !before(at(end), at(spot));

for (const kind of ['pdf', 'epub']) {
  test.describe(`${kind}: pages and turns`, () => {
    test.use({ book: kind });

    test('arrow keys, the turn buttons and the page edge turn the page', async ({ page, api }) => {
      await openReader(page);
      const first = await shown(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => shown(page)).not.toEqual(first);
      const second = await shown(page);
      expect(before(at(first.start), at(second.start))).toBe(true);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect.poll(() => shown(page)).not.toEqual(second);
      const third = await shown(page);
      await book(page).focus(); // the arrow keys belong to the book; the button keeps focus after a click
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => shown(page)).toEqual(second);
      await page.locator('.rf-ov-edge[data-edge="forward"]').click({ force: true }); // a pointer-only target
      await expect.poll(() => shown(page)).toEqual(third);
      expect(api.starts).toBe(1);
      expect(api.fileLoads).toBe(1);
    });

    test('the place is saved as an anchor in the file and restored after a reload', async ({ page, api }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700); // the leaf lands
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
      const place = await shown(page);
      await expect.poll(() => api.position?.anchor?.kind, { timeout: 4000 }).toBe(kind); // debounced 1 s
      expect(api.position).toMatchObject(kind === 'pdf'
        ? { chunk_index: expect.any(Number), anchor: { kind: 'pdf', page: Number(place.start), quads: [[0, 0, 0, 0]], text: '' } }
        : { chunk_index: expect.any(Number), anchor: { kind: 'epub', cfi: expect.stringMatching(/^epubcfi\(.+\)$/), text: '' } });
      await page.reload();
      await openReader(page);
      expect(api.starts).toBe(2);
      expect(holds(await shown(page), place.start)).toBe(true);
    });

    test('a resize keeps the same place in view', async ({ page }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(800); // the leaf lands
      const { start } = await shown(page);
      for (const size of [{ width: 1100, height: 760 }, { width: 800, height: 1000 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(700);
        expect(holds(await shown(page), start), `${start} in view at ${size.width}x${size.height}`).toBe(true);
      }
    });

    test('reduced motion turns the page with no animated leaf', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openReader(page);
      const first = await shown(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => shown(page)).not.toEqual(first);
      const during = await page.evaluate(() => ({
        leaf: document.querySelectorAll('.rf-ov-leaf').length,
        animations: document.getAnimations().filter((a) => a.playState === 'running').length,
      }));
      expect(during).toEqual({ leaf: 0, animations: 0 });
    });

    test("End shows today's closing page; its Start test takes a mouse click and finishes reading", async ({ page }) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
      const answer = (route, body) => route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: cors })
        : route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let finished = 0;
      await page.route('http://localhost:8000/sessions/e2e-session/finish-reading', (route) => { if (route.request().method() === 'POST') finished += 1; return answer(route, {}); });
      await page.route('http://localhost:8000/sessions/e2e-session', (route) => answer(route, { id: 'e2e-session', test_questions: [{ question: 'What did the lamp do?', type: 'free_text' }] }));
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('End');
      await expect(spoken(page)).toHaveText("End of today's reading");
      await expect(page.locator('.rf-end')).toHaveCount(1);
      await page.locator('.rf-end').getByRole('button', { name: 'Start test' }).click({ timeout: 3000 });
      await expect(page).toHaveURL(/\/test\/e2e-session$/);
      expect(finished).toBe(1);
    });

    test("turning past today's last page shows the closing page, and Previous comes back", async ({ page }) => {
      await openReader(page);
      await book(page).focus();
      for (let i = 0; i < 12 && !(await page.locator('.rf-end').count()); i += 1) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(700);
      }
      await expect(spoken(page)).toHaveText("End of today's reading");
      const last = await shown(page);
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('.rf-end')).toHaveCount(0);
      expect(await shown(page)).toEqual(last); // the closing page lay over the book; the book did not move
    });

    test('a known word shows its card within 600 ms once cached, beside the word, and Esc closes it', async ({ page, api }) => {
      await openReader(page);
      const lamp = await wordPoint(page, 'lamp');
      expect(lamp).not.toBeNull();
      await page.mouse.move(5, 5);
      await page.mouse.move(lamp.x, lamp.y);
      const card = page.locator('.rf-wordcard[data-kind="definition"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText('A device for giving light.');
      const box = await card.boundingBox();
      expect(box.y >= lamp.bottom || box.y + box.height <= lamp.top, 'the card leaves the line uncovered').toBe(true);
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
      // Again: the answer is in the client's cache, so only the hover intent stands between.
      await page.mouse.move(5, 5);
      await page.waitForTimeout(300);
      const elapsed = await timeToCard(page, lamp);
      expect(elapsed).toBeLessThan(600);
      await expect(card).toBeVisible();
      expect(api.lookups.filter((l) => l.term === 'lamp')).toHaveLength(1);
      // Moving off the word closes a hover card, inside an EPUB section's iframe as well: here, into the gutter.
      const middle = await page.locator('.rf-ov-book').boundingBox();
      await page.mouse.move(middle.x + middle.width / 2, lamp.y, { steps: 4 });
      await expect(card).toHaveCount(0);
    });

    test('two to five selected words are looked up as a phrase', async ({ page, api }) => {
      await openReader(page);
      const lamp = await wordPoint(page, 'lamp');
      const threw = await wordPoint(page, 'threw');
      await page.mouse.move(lamp.left + 1, lamp.y);
      await page.mouse.down();
      await page.mouse.move(threw.right - 1, threw.y, { steps: 8 });
      await page.mouse.up();
      await expect(page.locator('.rf-wordcard')).toBeVisible();
      await expect.poll(() => api.lookups.map((l) => l.term)).toContainEqual(expect.stringMatching(/^lamp.*threw$/));
    });

    test.describe('on a phone', () => {
      test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

      test('a long-press opens the compact sheet below or above the word, with no page turn', async ({ page }) => {
        await openReader(page);
        const lamp = await wordPoint(page, 'lamp');
        const cdp = await page.context().newCDPSession(page);
        const touch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: lamp.x, y: lamp.y }] });
        const before = await shown(page);
        await touch('touchStart');
        await page.waitForTimeout(600);
        await touch('touchEnd');
        const sheet = page.locator('.rf-wordcard[data-compact]');
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('Tap outside to close');
        const box = await sheet.boundingBox();
        expect(box.y >= lamp.bottom || box.y + box.height <= lamp.top, 'the sheet leaves the word uncovered').toBe(true);
        expect(await shown(page)).toEqual(before); // no page turn
      });
    });

    test('page-turn frame rate (recorded in docs/BENCHMARKS.md)', async ({ page }, info) => {
      await openReader(page);
      await book(page).focus();
      await page.evaluate(() => {
        window.__frames = [];
        const tick = (t) => { window.__frames.push(t); window.__raf = requestAnimationFrame(tick); };
        window.__raf = requestAnimationFrame(tick);
      });
      const from = await page.evaluate(() => performance.now());
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press(i < 2 ? 'ArrowRight' : 'ArrowLeft');
        await page.waitForTimeout(800);
      }
      const frames = await page.evaluate((t0) => { cancelAnimationFrame(window.__raf); return window.__frames.filter((t) => t >= t0); }, from);
      const gaps = frames.slice(1).map((t, i) => t - frames[i]);
      const seconds = (frames.at(-1) - frames[0]) / 1000;
      const turn = { frames: frames.length, seconds: +seconds.toFixed(2), fps: +(gaps.length / seconds).toFixed(1),
        worstFrameMs: +Math.max(...gaps).toFixed(1), over33ms: gaps.filter((g) => g > 33.4).length };
      const result = { date: new Date().toISOString(), browser: info.project.use.channel ?? 'chromium', book: kind, turn };
      mkdirSync('test-results', { recursive: true });
      writeFileSync(`test-results/reader-benchmarks-${kind}.json`, JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      expect(turn.fps).toBeGreaterThan(30);
    });
  });
}

test.describe('the toolbar at 375', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // C13.9: the tools on one row (handoff 375 frame), the session's controls on one row under them.
  test('the session controls sit under the tools, inside the screen', async ({ page }) => {
    await openReader(page);
    const box = (locator) => locator.boundingBox();
    const toolbar = page.getByRole('toolbar', { name: 'Reading controls' });
    const back = await box(toolbar.getByRole('button', { name: 'Back to the library' }));
    const done = await box(toolbar.getByRole('button', { name: 'Done reading' }));
    const abandon = await box(toolbar.getByRole('button', { name: 'Abandon session' }));
    expect(done.y).toBeGreaterThan(back.y + back.height - 1); // the session row is under the tools
    expect(Math.abs(abandon.y - done.y)).toBeLessThan(4);
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

// C13.9: one h1 that names the book, hidden from sight (the book's own headings are the publisher's).
test('the reading page has one h1 naming the book', async ({ page }) => {
  await openReader(page);
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText("Walden: today's reading");
  expect(await h1.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
});

test('the contents list the PDF outline with today labelled, and an entry opens its page', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Contents' }).click();
  const items = page.getByRole('dialog', { name: 'Contents' }).locator('.rf-contents-item');
  await expect(items).toHaveText([/^Chapter 1 Signals\s*today$/, /^Chapter 2 Noise\s*today$/]);
  await items.nth(1).click();
  await expect.poll(() => shown(page)).toEqual({ start: '4', end: '5' }); // page 5 on the 4-5 spread
});

test('a proper noun shows a Wikipedia summary with a link', async ({ page, api }) => {
  await openReader(page);
  await book(page).focus();
  await page.keyboard.press('ArrowRight'); // pages 2-3: "Chapter 1 Signals"
  await page.waitForTimeout(800);
  const signals = await wordPoint(page, 'Signals');
  await page.mouse.move(5, 5);
  await page.mouse.move(signals.x, signals.y);
  const card = page.locator('.rf-wordcard[data-kind="summary"]');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading')).toHaveText('Signal');
  const link = card.getByRole('link', { name: /Wikipedia/ });
  await expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Signal');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(api.lookups).toContainEqual({ term: 'Signals', proper: true });
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('words in a figure are not looked up; the text around it is', async ({ page, api }) => {
    await openReader(page);
    const plate = await wordPoint(page, 'plate'); // only in the figure's caption
    expect(plate).not.toBeNull();
    await page.mouse.move(5, 5);
    await page.mouse.move(plate.x, plate.y);
    await page.waitForTimeout(900);
    await expect(page.locator('.rf-wordcard')).toHaveCount(0);
    expect(api.lookups).toEqual([]);
  });
});

test('with hover lookup off, hovering shows nothing, and Enter on a selected word still opens its card', async ({ page }) => {
  await openReader(page);
  await page.getByRole('switch', { name: 'Look up words on hover' }).click();
  await expect(page.getByRole('switch', { name: 'Look up words on hover' })).toHaveAttribute('aria-checked', 'false');
  const lamp = await wordPoint(page, 'lamp');
  await page.mouse.move(5, 5);
  await page.mouse.move(lamp.x, lamp.y);
  await page.waitForTimeout(900);
  await expect(page.locator('.rf-wordcard')).toHaveCount(0);
  await page.mouse.dblclick(lamp.x, lamp.y);
  await book(page).focus();
  await page.keyboard.press('Enter');
  const card = page.locator('.rf-wordcard[data-kind="definition"]');
  await expect(card).toBeVisible();
  await expect(card).toBeFocused();
});

// C17.6: anchors survive re-layout. An EPUB CFI is structural, so a larger text size and a reload come
// back to the same place; a PDF anchor is in points, so zooming changes nothing that is saved.
test.describe('anchors across re-layout', () => {
  test.describe('epub', () => {
    test.use({ book: 'epub' });

    test('after a text-size change the saved anchor reopens the same place', async ({ page, api }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(800);
      const { start } = await shown(page);
      await page.getByRole('button', { name: 'Larger text' }).click();
      await page.getByRole('button', { name: 'Larger text' }).click();
      await page.waitForTimeout(800);
      expect(holds(await shown(page), start), 'the same place after the new size').toBe(true);
      await expect.poll(() => api.saves, { timeout: 4000 }).toBeGreaterThan(0);
      const cfi = api.position.anchor.cfi;
      await page.reload();
      await openReader(page);
      expect(holds(await shown(page), start), 'the same place after a reload at the new size').toBe(true);
      expect(api.position.anchor.cfi).toBe(cfi);
    });
  });

  test('zooming a PDF to 200% and back keeps the page and the saved anchor', async ({ page, api }) => {
    await openReader(page);
    await book(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    const place = await shown(page);
    await expect.poll(() => api.position?.anchor?.page, { timeout: 4000 }).toBe(Number(place.start));
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 5 && await zoomIn.isEnabled(); i += 1) await zoomIn.click();
    await expect(page.getByRole('button', { name: /^Zoom: 200%/ })).toBeVisible();
    expect(await shown(page)).toEqual(place);
    await page.getByRole('button', { name: /^Zoom:/ }).click(); // back to a fit
    await page.waitForTimeout(500);
    expect(await shown(page)).toEqual(place);
    expect(api.position.anchor).toEqual({ kind: 'pdf', page: Number(place.start), quads: [[0, 0, 0, 0]], text: '' });
  });
});
