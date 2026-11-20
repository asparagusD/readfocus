// C23.6b: ending a focus session. End session lets the reader set the ribbon on a page shown (a button per
// page, dragging the ribbon, or the arrow keys and Enter), turning pages first if need be; then "Ready for your
// questions?", and the quiz on the test's own screen with no clock and no Steve, then the results. The 3-hour
// stop and leaving focus mode take the same path. Mocked API.
import { clickTool, expect, openReader, test, twoPagesInView } from './fixtures';

const bar = (page) => page.getByRole('region', { name: 'Focus mode' });
const placing = (page) => page.getByRole('group', { name: 'Place the ribbon' });
const ready = (page) => page.getByRole('dialog', { name: 'Ready for your questions?' });
const ends = (api) => api.focus.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/end'));
const pdfStart = { source: 'outline', body_start: { kind: 'pdf', page: 1, title: 'Chapter 1' } };

async function startFocus(page, api) {
  await openReader(page);
  await clickTool(page, page.getByRole('switch', { name: 'Focus mode' })); // C38.4b: in More tools on a phone
  await bar(page).getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => api.focus.events.length).toBeGreaterThan(0);
  api.focus.active = 1500; // 25 minutes on the server: 250 points so far
}

/** C38.2: two pages in view, as a spread used to show, so the ribbon has two places to go. */
const toSpread = (page) => twoPagesInView(page);

test('End session: set the ribbon on a page, ready, the questions, the results', async ({ page, api }) => {
  api.bodyStart = pdfStart;
  await startFocus(page, api);
  const at = await toSpread(page);
  await bar(page).getByRole('button', { name: 'End session' }).click();
  await expect(placing(page)).toContainText('Drag the ribbon to the page where you stopped.');
  const buttons = placing(page).getByRole('button', { name: /^Set ribbon on p\./ });
  await expect(buttons).toHaveCount(Number(at.end) - Number(at.start) + 1);
  await buttons.last().click();
  await expect.poll(() => ends(api).length).toBe(1);
  const bookmark = ends(api)[0].body.bookmark_anchor;
  expect(bookmark.page).toBe(Number(at.end));
  expect(bookmark.quads[0][1]).toBeGreaterThan(500); // the bottom of the page: the whole page was read
  await expect(placing(page)).toHaveCount(0);
  await expect(ready(page)).toContainText(/The ribbon is on p\. \S+\. Three short questions/);
  await expect(ready(page)).toContainText('Three short questions on what you read, about 4 minutes.');
  await expect(ready(page)).toContainText('250 points for your focus time so far, and 20 for each right answer, up to as many again. Get 2 of 3 right');
  await ready(page).getByRole('button', { name: 'Not now, keep my place' }).click();
  await expect(ready(page)).toHaveCount(0);
  await bar(page).getByRole('button', { name: 'End session' }).click(); // the ribbon is set: straight to ready
  await expect(placing(page)).toHaveCount(0);
  await ready(page).getByRole('button', { name: 'Start questions' }).click();
  await expect(page).toHaveURL(/\/focus\/focus-1\/quiz$/);
  await expect(page.getByText('From the pages you just read')).toBeVisible();
  await expect(page.getByText('No Steve during questions')).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await page.getByRole('radio', { name: /A small circle of light/ }).click();
  await page.locator('[data-test-next]').click();
  await expect(page.getByText(/^Question 2 of 3/)).toBeVisible();
  await page.getByLabel('Your answer').fill('The page mattered.');
  await page.locator('[data-test-next]').click();
  await expect(page.getByText(/^Question 3 of 3/)).toBeVisible();
  await page.getByLabel('Your answer').fill('Reading by lamplight.');
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page).toHaveURL(/\/results\/focus-1$/);
  expect(api.focus.answers).toEqual(['(b) A small circle of light', 'The page mattered.', 'Reading by lamplight.']);
  await expect(page.getByText('Score: 67%')).toBeAttached();
  await expect(page.getByText('20 of 30 points')).toHaveCount(0); // C23.7: only the session's points are shown
  // C23.7: the points, row by row, from the server's lines.
  const scored = page.getByRole('region', { name: 'How this session scored' });
  const rows = scored.locator('.rf-points__row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Focused reading');
  await expect(rows.nth(0)).toContainText('25 minutes');
  await expect(rows.nth(0)).toContainText('+250');
  await expect(rows.nth(1)).toContainText('Not counted');
  await expect(rows.nth(1)).toContainText('Time on one page beyond 30 minutes without turning it · 10 minutes');
  await expect(rows.nth(2)).toContainText('2 of 3 right · 67%');
  await expect(rows.nth(2)).toContainText('+40');
  await expect(rows.nth(3)).toContainText('+290');
  await expect(scored).toContainText('It is never taken off what you earned.');
  await expect(page.getByText(/No points this time/)).toHaveCount(0);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/results-points-1440.png`, fullPage: true });
});

test('under 40% the results say so kindly, with no points', async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  api.bodyStart = pdfStart;
  api.focus.passed = false;
  await startFocus(page, api);
  api.focus.active = 1500;
  await bar(page).getByRole('button', { name: 'End session' }).click();
  await placing(page).getByRole('button', { name: /^Set ribbon on p\./ }).first().click();
  await ready(page).getByRole('button', { name: 'Start questions' }).click();
  await page.getByRole('radio', { name: /A small circle of light/ }).click();
  await page.locator('[data-test-next]').click();
  await page.getByLabel('Your answer').fill('Not sure.');
  await page.locator('[data-test-next]').click();
  await expect(page.getByText(/^Question 3 of 3/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page).toHaveURL(/\/results\/focus-1$/);
  await expect(page.getByRole('note')).toHaveText(/No points this time; you got 1 of 3\. Points return when you score 40% or more\./);
  const rows = page.getByRole('region', { name: 'How this session scored' }).locator('.rf-points__row');
  await expect(rows.last()).toContainText('This session');
  await expect(rows.last().locator('dd')).toHaveText('0');
  await expect(rows.first().locator('dd')).toHaveText('—');
  if (process.env.E2E_SHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/results-low-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/results-low-375.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});

test('the arrows and Enter choose the page; Escape cancels', async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  api.bodyStart = pdfStart;
  await startFocus(page, api);
  const at = await toSpread(page);
  expect(Number(at.end)).toBe(Number(at.start) + 1);
  await bar(page).getByRole('button', { name: 'End session' }).click();
  const ribbon = page.locator('.rf-ov-ribbon--placing');
  await expect(ribbon).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(placing(page)).toHaveCount(0);
  expect(ends(api)).toEqual([]);

  await bar(page).getByRole('button', { name: 'End session' }).click();
  await expect(ribbon).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(placing(page).getByRole('button', { name: /^Set ribbon on/ }).first()).toHaveAttribute('data-picked', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => ends(api).length).toBe(1);
  expect(ends(api)[0].body.bookmark_anchor.page).toBe(Number(at.start));
});

test('dragging the ribbon to the left page sets it there', async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  api.bodyStart = pdfStart;
  await startFocus(page, api);
  const at = await toSpread(page);
  await bar(page).getByRole('button', { name: 'End session' }).click();
  const ribbon = await page.locator('.rf-ov-ribbon--placing').boundingBox();
  const stage = await page.locator('.rf-ov-stage').boundingBox();
  await page.mouse.move(ribbon.x + ribbon.width / 2, ribbon.y + 40);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.3, ribbon.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => ends(api).length).toBe(1);
  expect(ends(api)[0].body.bookmark_anchor.page).toBe(Number(at.start));
});

test('the 3-hour stop and leaving focus mode both go to the ribbon', async ({ page, api }) => {
  api.bodyStart = pdfStart;
  await startFocus(page, api);
  await bar(page).getByRole('button', { name: 'Exit focus mode' }).click();
  await page.getByRole('dialog', { name: 'Leave focus mode?' }).getByRole('button', { name: 'End and take the quiz' }).click();
  await expect(placing(page)).toBeVisible();
  await placing(page).getByRole('button', { name: 'Cancel' }).click();
  api.focus.active = 10800;
  api.focus.session.status = 'awaiting_quiz';
  await page.reload();
  await openReader(page);
  await page.getByRole('group', { name: 'Three hours of focus' }).getByRole('button', { name: 'Place bookmark' }).click();
  await expect(placing(page)).toBeVisible();
  await placing(page).getByRole('button', { name: /^Set ribbon on/ }).first().click();
  await expect(ready(page)).toBeVisible();
});

test.describe('EPUB', () => {
  test.use({ book: 'epub' });

  test('the ribbon goes at the end of the page shown, as a point CFI', async ({ page, api }) => {
    api.bodyStart = { source: 'outline', body_start: { kind: 'epub', spine_index: 0, title: 'Chapter 1' } };
    await startFocus(page, api);
    await bar(page).getByRole('button', { name: 'End session' }).click();
    await placing(page).getByRole('button', { name: /^Set ribbon on/ }).click();
    await expect.poll(() => ends(api).length).toBe(1);
    const { bookmark_anchor: bookmark } = ends(api)[0].body;
    expect(bookmark.kind).toBe('epub');
    expect(bookmark.cfi).toMatch(/^epubcfi\([^,]+\)$/);
    await expect(ready(page)).toBeVisible();
  });
});

test.describe('phone, Lamplight', () => {
  test.use({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });

  test('the placing bar and the ready dialog fit, 44 px targets', async ({ page, api }) => {
    api.bodyStart = pdfStart;
    await startFocus(page, api);
    await bar(page).getByRole('button', { name: 'End session' }).click();
    for (const button of await placing(page).getByRole('button').all()) { // C38.2: a place for each page in view
      const box = await button.boundingBox();
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
      expect(box.x >= 0 && box.x + box.width <= 375).toBe(true);
    }
    await placing(page).getByRole('button', { name: /^Set ribbon on/ }).first().click();
    await expect(ready(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test('while the ribbon is placed the focus cards step aside, so its buttons can be pressed', async ({ page, api }) => {
  api.bodyStart = pdfStart;
  api.focus.session = { id: 'focus-1', book_id: 'e2e-book', status: 'awaiting_quiz', state: 'awaiting_quiz', reasons: {} };
  api.focus.active = 10800;
  await openReader(page);
  await page.getByRole('group', { name: 'Three hours of focus' }).getByRole('button', { name: 'Place bookmark' }).click();
  await expect(page.getByRole('group', { name: 'Three hours of focus' })).toHaveCount(0);
  const button = placing(page).getByRole('button', { name: /^Set ribbon on/ }).first();
  const box = await button.boundingBox();
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent, {
    x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(top).toMatch(/^Set ribbon on/);
  await placing(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('group', { name: 'Three hours of focus' })).toBeVisible();
});
