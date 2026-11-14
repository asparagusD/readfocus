// C21.2: the selection toolbar. Selecting text in a PDF's text layer or an EPUB section shows five colour dots,
// an underline toggle and Ask Steve, above the selection (never over it); a colour saves at once, the toolbar
// closes, and a failed save is taken back with a toast. Keyboard: Shift+arrows grow the selection, H highlights
// in the last colour, U underlines.
import { book, expect, openReader, test, wordPoint } from './fixtures';

const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });
const saved = (page) => page.locator('.rf-ov').getAttribute('data-annotations');

/** Drag the mouse from the start of `from` to the end of `to` (first visible occurrences). */
async function select(page, from, to) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  return { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: a.left, right: b.right };
}

/** True when the toolbar's box stays clear of the selected lines. */
const clearOf = (bar, lines) => bar.y + bar.height <= lines.top || bar.y >= lines.bottom;

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind });

    test('a selection shows the toolbar above it, and a colour saves a highlight at once', async ({ page, api }) => {
      await openReader(page);
      const lines = await select(page, 'lamp', 'circle');
      const bar = toolbar(page);
      await expect(bar).toBeVisible();
      for (const name of ['Honey', 'Sage', 'Sky', 'Rose', 'Lilac']) await expect(bar.getByRole('button', { name: `${name} highlight` })).toBeVisible();
      await expect(bar.getByRole('button', { name: 'Underline', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await expect(bar.getByRole('button', { name: 'Ask Steve' })).toBeVisible();
      await expect(bar.getByRole('button', { name: /note/i })).toHaveCount(0); // C22
      expect(clearOf(await bar.boundingBox(), lines)).toBe(true);
      // The word card for the phrase (lookup on, as before) and the toolbar do not cover each other.
      const card = page.locator('.rf-wordcard');
      if (await card.isVisible()) {
        const [c, t] = [await card.boundingBox(), await bar.boundingBox()];
        expect(c.x + c.width <= t.x || t.x + t.width <= c.x || c.y + c.height <= t.y || t.y + t.height <= c.y).toBe(true);
      }

      await bar.getByRole('button', { name: 'Sky highlight' }).click();
      await expect(bar).toHaveCount(0);
      await expect.poll(() => saved(page)).toBe('1'); // shown at once, before the server answers
      await expect.poll(() => api.annotationPosts.length).toBe(1);
      const [body] = api.annotationPosts;
      expect(body).toMatchObject({ style: 'highlight', color: 'sky' });
      expect(body.anchors).toHaveLength(1);
      expect(body.anchors[0]).toMatchObject({ kind, text: expect.stringMatching(/^lamp .*circle$/) });
      expect(Number.isInteger(body.position_start) && body.position_end > body.position_start).toBe(true);
    });

    test('the underline toggle turns the colours into underlines', async ({ page, api }) => {
      await openReader(page);
      await select(page, 'lamp', 'threw');
      const bar = toolbar(page);
      await bar.getByRole('button', { name: 'Underline', exact: true }).click();
      await expect(bar.getByRole('button', { name: 'Underline', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await bar.getByRole('button', { name: 'Rose underline' }).click();
      await expect.poll(() => api.annotationPosts.length).toBe(1);
      expect(api.annotationPosts[0]).toMatchObject({ style: 'underline', color: 'rose' });
    });
  });
}

test('keyboard: Shift+arrows grow the selection, H highlights in the last colour, U underlines', async ({ page, api }) => {
  await openReader(page);
  await select(page, 'lamp', 'circle');
  await toolbar(page).getByRole('button', { name: 'Lilac highlight' }).click(); // lilac becomes the last colour
  await expect.poll(() => api.annotationPosts.length).toBe(1);

  const lamp = await wordPoint(page, 'lamp');
  await page.mouse.dblclick(lamp.x, lamp.y);
  await book(page).focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.rf-ov')).toHaveAttribute('data-start', '1'); // no page turned
  await expect(toolbar(page)).toBeVisible();
  await page.keyboard.press('h');
  await expect.poll(() => api.annotationPosts.length).toBe(2);
  expect(api.annotationPosts[1]).toMatchObject({ style: 'highlight', color: 'lilac' });
  expect(api.annotationPosts[1].anchors[0].text).toBe('lamp threw'); // the double-clicked word and six more characters

  await page.mouse.dblclick(lamp.x, lamp.y);
  await book(page).focus();
  await expect(toolbar(page)).toBeVisible(); // the selection has settled
  await page.keyboard.press('u');
  await expect.poll(() => api.annotationPosts.length).toBe(3);
  expect(api.annotationPosts[2]).toMatchObject({ style: 'underline', color: 'lilac' });

  // Escape puts the toolbar away and keeps the selection; H and U do nothing without one.
  await page.mouse.dblclick(lamp.x, lamp.y);
  await book(page).focus();
  await expect(toolbar(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toolbar(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.getSelection().toString().trim())).toBe('lamp'); // kept
  await page.evaluate(() => document.getSelection().removeAllRanges());
  await page.keyboard.press('h');
  await page.waitForTimeout(300);
  expect(api.annotationPosts).toHaveLength(3);
});

test('the toolbar is a toolbar: arrow keys move between its buttons', async ({ page }) => {
  await openReader(page);
  await select(page, 'lamp', 'circle');
  const bar = toolbar(page);
  await bar.getByRole('button', { name: 'Honey highlight' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'Sage highlight' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(bar.getByRole('button', { name: 'Ask Steve' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(bar.getByRole('button', { name: 'Honey highlight' })).toBeFocused();
});

test('a highlight the server refuses is taken back, with a toast', async ({ page, api }) => {
  api.annotationFail = 500;
  await openReader(page);
  await select(page, 'lamp', 'circle');
  await toolbar(page).getByRole('button', { name: 'Honey highlight' }).click();
  await expect(page.getByText("That highlight wasn't saved. Try again.")).toBeVisible();
  await expect.poll(() => saved(page)).toBe('0');
});

test('Ask Steve explains the selected passage', async ({ page, api }) => {
  api.steve.consented = true;
  await openReader(page);
  await select(page, 'lamp', 'circle');
  await toolbar(page).getByRole('button', { name: 'Ask Steve' }).click();
  await expect.poll(() => api.steve.asks.length).toBe(1);
  expect(api.steve.asks[0]).toMatchObject({ mode: 'explain_highlight', anchor: { kind: 'pdf', text: expect.stringMatching(/^lamp .*circle$/) } });
  expect(api.annotationPosts).toHaveLength(0);
});

test.describe('on a phone, in lamplight', () => {
  // The EPUB: it reflows to a readable size, where a PDF page fitted to 375 px has 7 px lines.
  test.use({ viewport: { width: 375, height: 812 }, book: 'epub', colorScheme: 'dark' });

  test('the toolbar fits the screen and stays clear of the selection', async ({ page }) => {
    await openReader(page);
    const lines = await select(page, 'lamp', 'small');
    const bar = await toolbar(page).boundingBox();
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(375);
    expect(clearOf(bar, lines)).toBe(true);
    for (const button of await toolbar(page).getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(36); // the handoff's 36 px buttons, 44 px reach
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('lamplight');
  });
});
