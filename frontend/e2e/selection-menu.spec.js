// C39.7 (issue 23): Edge's right-click menu on a selection. A right-click on selected words opens it at the pointer
// (the selection toolbar steps aside); the menu key or Shift+F10 opens it by keyboard; arrows move through it, Escape
// gives the book focus back; Highlight (in a colour), Underline, Copy, Look up and Ask Steve each do what they say.
// Shift+right-click, a right-click with nothing selected, or one with a markup tool on keep the browser's own menu.
// Every call is mocked (fixtures.js).
import { expect, openReader, test, wordPoint } from './fixtures';

const menu = (page) => page.getByRole('menu', { name: 'Selection' });
const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });

async function select(page, from, to) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  return { a, b };
}

/** Whether a right-click (by a dispatched contextmenu) at a word is left to the browser. */
const browserKeeps = (page, word, init = {}) => wordPoint(page, word).then(({ x, y }) => page.evaluate(([px, py, extra]) => {
  const target = document.elementFromPoint(px, py);
  return target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: px, clientY: py, button: 2, ...extra }));
}, [x, y, init]));

test('a right-click on the selection opens the menu there; a colour highlights in it', async ({ page, api }) => {
  await openReader(page);
  const { a } = await select(page, 'lamp', 'circle');
  await page.mouse.click(a.x + 4, a.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  await expect(toolbar(page)).toHaveCount(0); // it steps aside while the menu is open
  await page.mouse.move(a.x + 2, a.y + 1); // resting on a word: no word card over the menu
  await page.waitForTimeout(900);
  await expect(page.locator('.rf-wordcard')).toHaveCount(0);
  const box = await menu(page).boundingBox();
  expect(Math.abs(box.x - (a.x + 4))).toBeLessThan(12); // at the pointer
  await expect(menu(page).getByRole('menuitem', { name: 'Highlight', exact: true })).toBeFocused();
  await menu(page).getByRole('menuitemradio', { name: 'Highlight in Sky' }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect.poll(() => api.annotations.map((a2) => [a2.style, a2.color])).toEqual([['highlight', 'sky']]);
  await expect(page.locator('.rf-ov-stage')).toBeFocused();
});

test('by keyboard: Shift+F10 and the menu key open it; arrows, Escape and Enter', async ({ page, api }) => {
  await openReader(page);
  await select(page, 'lamp', 'circle');
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('ArrowDown'); // the first colour
  await expect(menu(page).getByRole('menuitemradio', { name: 'Highlight in Honey' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu(page).getByRole('menuitem', { name: /^Copy/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.rf-ov-stage')).toBeFocused();
  expect(api.annotations).toHaveLength(0);

  await page.keyboard.press('ContextMenu');
  await expect(menu(page)).toBeVisible();
  const underline = menu(page).getByRole('menuitem', { name: /^Underline/ });
  await underline.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => api.annotations.map((x) => x.style)).toEqual(['underline']);
});

test('Copy puts the selection on the clipboard and keeps it selected', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openReader(page);
  const { a } = await select(page, 'lamp', 'circle');
  await page.mouse.click(a.x + 4, a.y, { button: 'right' });
  await menu(page).getByRole('menuitem', { name: /^Copy/ }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^lamp threw a small circle$/);
  expect(await page.evaluate(() => document.getSelection().toString())).toMatch(/lamp threw a small circle/);
});

test('Look up opens the word card; Ask Steve asks him about the passage', async ({ page, api }) => {
  api.steve.consented = true;
  await openReader(page);
  let { a } = await select(page, 'small', 'small');
  await page.mouse.click(a.x, a.y, { button: 'right' });
  await menu(page).getByRole('menuitem', { name: /^Look up/ }).click();
  await expect(page.locator('.rf-wordcard')).toBeVisible();
  await page.keyboard.press('Escape');

  ({ a } = await select(page, 'lamp', 'circle'));
  await page.mouse.click(a.x + 4, a.y, { button: 'right' });
  await menu(page).getByRole('menuitem', { name: 'Explain with Steve' }).click(); // C40.6: was Ask Steve
  await expect.poll(() => api.steve.asks.length).toBe(1);
  expect(api.steve.asks[0]).toMatchObject({ mode: 'explain_highlight', anchor: { kind: 'pdf', page: 1 } });
});

test("Shift+right-click, nothing selected, or a markup tool on: the browser's own menu", async ({ page }) => {
  await openReader(page);
  expect(await browserKeeps(page, 'lamp')).toBe(true); // nothing selected
  await select(page, 'lamp', 'circle');
  expect(await browserKeeps(page, 'threw', { shiftKey: true })).toBe(true);
  await expect(menu(page)).toHaveCount(0);
  expect(await browserKeeps(page, 'threw')).toBe(false); // ours
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('group', { name: 'Markup' }).getByRole('button', { name: 'Highlight', exact: true }).click();
  await page.keyboard.press('Escape'); // leaves it: the tool stays only until Escape
  await page.getByRole('group', { name: 'Markup' }).getByRole('button', { name: 'Draw', exact: true }).click();
  expect(await browserKeeps(page, 'small')).toBe(true);
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test("a right-click in a section opens the menu and highlights the section's words", async ({ page, api }) => {
    await openReader(page);
    const { a } = await select(page, 'lamp', 'circle');
    await page.mouse.click(a.x + 4, a.y, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    await menu(page).getByRole('menuitem', { name: 'Highlight', exact: true }).click();
    await expect.poll(() => api.annotations.map((x) => x.anchors[0].kind)).toEqual(['epub']);
  });
});
