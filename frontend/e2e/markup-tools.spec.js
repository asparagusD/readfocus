// C39.3 (issue 23): Edge's markup tools in the reader's toolbar. The highlighter stays on until Escape or a second
// press; while on, a selection is highlighted at once in its colour (no selection toolbar); its menu picks one of
// Edge's ten colours, which turns it on; the colour is the one H uses. The group sits in the bar while it fits, after
// Look up and the rest have moved into More tools (your decision at C39.3), and in More tools on a phone. Every call is mocked (fixtures.js).
import { expect, openReader, test, wordPoint } from './fixtures';

const markup = (page) => page.getByRole('group', { name: 'Markup' });
const highlighter = (page) => markup(page).getByRole('button', { name: 'Highlight', exact: true });
const menuButton = (page) => markup(page).getByRole('button', { name: 'Highlight colour' });
const selectionBar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });

async function drag(page, from, to) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
}

for (const book of ['pdf', 'epub']) {
  test.describe(book, () => {
    test.use({ book });

    test('the highlighter highlights each selection at once until Escape', async ({ page, api }) => {
      await openReader(page);
      await expect(highlighter(page)).toHaveAttribute('aria-pressed', 'false');
      await highlighter(page).click();
      await expect(highlighter(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(markup(page).getByRole('status')).toHaveText(/Highlighter on, Honey/);

      await drag(page, 'lamp', 'circle');
      await expect.poll(() => api.annotations.map((a) => [a.style, a.color])).toEqual([['highlight', 'honey']]);
      await expect(selectionBar(page)).toHaveCount(0);
      await page.mouse.move(5, 5);
      await drag(page, 'threw', 'small');
      await expect.poll(() => api.annotations.length).toBe(2);

      await page.keyboard.press('Escape');
      await expect(highlighter(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(markup(page).getByRole('status')).toHaveText('Markup tools off.');
      await page.mouse.move(5, 5);
      await drag(page, 'lamp', 'small'); // the selection toolbar again, nothing saved
      await expect(selectionBar(page)).toBeVisible();
      expect(api.annotations).toHaveLength(2);
    });
  });
}

test('the menu picks a colour and turns the highlighter on; keys move through it; the swatch follows H', async ({ page, api }) => {
  await openReader(page);
  await menuButton(page).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('radiogroup', { name: 'Highlight colour' });
  await expect(menu.getByRole('radio')).toHaveCount(10);
  await expect(menu.getByRole('radio', { name: 'Honey' })).toBeFocused(); // the colour in use
  await page.keyboard.press('ArrowRight');
  await expect(menu.getByRole('radio', { name: 'Sage' })).toBeFocused();
  await page.keyboard.press('Escape'); // the menu closes; nothing else changes
  await expect(menu).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();
  await expect(highlighter(page)).toHaveAttribute('aria-pressed', 'false');

  await menuButton(page).click();
  await menu.getByRole('radio', { name: 'Fern' }).click();
  await expect(menu).toHaveCount(0);
  await expect(highlighter(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(markup(page).locator('.rf-markup-swatch')).toHaveAttribute('data-colour', 'fern');
  await drag(page, 'lamp', 'circle');
  await expect.poll(() => api.annotations.map((a) => a.color)).toEqual(['fern']);

  await highlighter(page).click(); // a second press turns it off
  await expect(highlighter(page)).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(5, 5);
  await drag(page, 'threw', 'small');
  await selectionBar(page).getByRole('button', { name: 'Sky highlight' }).click(); // H's colour now: the swatch follows
  await expect(markup(page).locator('.rf-markup-swatch')).toHaveAttribute('data-colour', 'sky');
});

test.describe('fit', () => {
  test('at 1280 the tools sit in the bar, Look up and the rest in More tools, on one row; at 1024 in More tools', async ({ page }) => {
    // Your decision at C39.3 (2026-11-21): when room runs short the markup tools keep their place, as in Edge.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openReader(page);
    const bar = page.getByRole('toolbar', { name: 'Reading controls' });
    await expect(bar.locator('.rf-toolbar-end > .rf-toolbar-markup')).toHaveCount(1);
    await expect(bar.locator('.rf-toolbar-end > .rf-toolbar-reading')).toHaveCount(0);
    expect((await bar.boundingBox()).height).toBeLessThan(64); // one row
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(bar.locator('.rf-toolbar-end > .rf-toolbar-markup')).toHaveCount(0);
    await expect(highlighter(page)).toBeHidden(); // in More tools
    expect((await bar.boundingBox()).height).toBeLessThan(64);
  });

  test('on a phone they are in More tools, and turning one on keeps the panel open', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReader(page);
    const more = page.getByRole('button', { name: 'More tools' });
    await expect(highlighter(page)).toBeHidden();
    await more.click();
    await highlighter(page).click();
    await expect(highlighter(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await menuButton(page).click();
    await page.getByRole('radio', { name: 'Ocean' }).click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(markup(page).locator('.rf-markup-swatch')).toHaveAttribute('data-colour', 'ocean');
  });
});
