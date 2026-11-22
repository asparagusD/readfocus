// C39.8 (issue 23, D1): Edge's Add comment on a highlight. From the right-click menu or the selection toolbar the
// selection is highlighted with its comment when ✓ is pressed (nothing when cancelled); a comment icon in the margin
// previews it on hover or focus and edits it on a click or Enter; the chip adds, edits or deletes it; the Annotations
// tab shows it; an EPUB's highlights take comments too. Every call is mocked (fixtures.js).
import { clickTool, contentsPane, expect, openReader, test, wordPoint } from './fixtures';

const editor = (page, name) => page.getByRole('dialog', { name });
const marker = (page) => page.locator('.rf-comment-marker');
const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });

async function select(page, from, to) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  return a;
}

test('from the right-click menu: typed, saved with its highlight, previewed, edited and listed', async ({ page, api }) => {
  await openReader(page);
  const a = await select(page, 'lamp', 'circle');
  await page.mouse.click(a.x + 4, a.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Selection' }).getByRole('menuitem', { name: 'Add comment' }).click();
  const field = editor(page, 'Add comment').getByRole('textbox', { name: 'Comment' });
  await expect(field).toBeFocused();
  await field.fill('  Ask about the tides.  ');
  await editor(page, 'Add comment').getByRole('button', { name: 'Save comment' }).click();
  await expect.poll(() => api.annotationPosts.map((p) => [p.style, p.comment])).toEqual([['highlight', 'Ask about the tides.']]);
  await expect(editor(page, 'Add comment')).toHaveCount(0);

  await expect(marker(page)).toHaveCount(1);
  await marker(page).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Ask about the tides.');
  await page.mouse.move(5, 5);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await marker(page).click();
  const edit = editor(page, 'Edit comment').getByRole('textbox', { name: 'Comment' });
  await expect(edit).toHaveValue('Ask about the tides.');
  await edit.fill('Ask Ms Lee about the tides.');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => api.annotationPatches.at(-1)).toEqual({ id: 'ann-1', comment: 'Ask Ms Lee about the tides.' });

  await marker(page).focus(); // by keyboard: focus previews, Enter edits
  await expect(page.getByRole('tooltip')).toHaveText('Ask Ms Lee about the tides.');
  await page.keyboard.press('Enter');
  await expect(editor(page, 'Edit comment')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor(page, 'Edit comment')).toHaveCount(0);
  await expect(page.locator('.rf-ov-stage')).toBeFocused();

  const contents = page.getByRole('button', { name: 'Contents', exact: true });
  if ((await contents.getAttribute('aria-expanded')) !== 'true') await contents.click();
  await contentsPane(page).getByRole('tab', { name: /^Annotations/ }).click();
  await expect(contentsPane(page).locator('.rf-anno-comment')).toHaveText('Ask Ms Lee about the tides.');
});

test('from the selection toolbar; Cancel and Escape save nothing', async ({ page, api }) => {
  await openReader(page);
  await select(page, 'lamp', 'circle');
  await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
  await editor(page, 'Add comment').getByRole('textbox', { name: 'Comment' }).fill('Not this one');
  await editor(page, 'Add comment').getByRole('button', { name: 'Cancel' }).click();
  await page.mouse.move(5, 5);
  await select(page, 'threw', 'small');
  await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
  await page.keyboard.type('Nor this');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(api.annotationPosts).toEqual([]);
  await expect(marker(page)).toHaveCount(0);
});

test("the chip adds a comment to a highlight, edits it, and Delete comment removes it", async ({ page, api }) => {
  await openReader(page);
  await select(page, 'lamp', 'circle');
  await toolbar(page).getByRole('button', { name: 'Sky highlight' }).click();
  await expect.poll(() => api.annotations.length).toBe(1);
  await clickTool(page, page.getByRole('switch', { name: 'Look up words on hover' })); // lookup off: the chip
  const lamp = await wordPoint(page, 'lamp');
  const hoverChip = async () => {
    await page.mouse.move(lamp.x, lamp.y - 40);
    await page.mouse.move(lamp.x, lamp.y, { steps: 4 });
  };
  await hoverChip();
  await page.getByRole('toolbar', { name: /^Sky highlight:/ }).getByRole('button', { name: 'Add comment' }).click();
  await page.keyboard.type('Why the lamp?');
  await editor(page, 'Add comment').getByRole('button', { name: 'Save comment' }).click();
  await expect.poll(() => api.annotationPatches.at(-1)).toEqual({ id: 'ann-1', comment: 'Why the lamp?' });
  await expect(marker(page)).toHaveCount(1);

  await page.mouse.move(5, 5);
  await hoverChip();
  await page.getByRole('toolbar', { name: /^Sky highlight:/ }).getByRole('button', { name: 'Edit comment' }).click();
  await editor(page, 'Edit comment').getByRole('button', { name: 'Delete comment' }).click();
  await expect.poll(() => api.annotationPatches.at(-1)).toEqual({ id: 'ann-1', comment: '' });
  await expect(marker(page)).toHaveCount(0);
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test("an EPUB highlight takes a comment and shows its marker", async ({ page, api }) => {
    await openReader(page);
    await select(page, 'lamp', 'circle');
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await page.keyboard.type('In the section');
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => api.annotationPosts.map((p) => [p.anchors[0].kind, p.comment])).toEqual([['epub', 'In the section']]);
    await expect(marker(page)).toHaveCount(1);
  });
});
