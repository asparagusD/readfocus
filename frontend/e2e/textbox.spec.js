// C39.6 (issue 23): Edge's Add text on a PDF page. A press places a box there, typing fills it, leaving it saves it
// in PDF points (an empty one is dropped); after a reload and a zoom it is drawn again at the same place on the page;
// with Add text on a click or Enter on a box retypes it, and emptying it deletes it with an Undo; Enter on the book
// places a box by keyboard; Add text's menu picks the colour and size; with it off the words under a box are
// selectable; an EPUB has no Add text (D2). Every call is mocked (fixtures.js).
import { expect, openReader, test } from './fixtures';

const markup = (page) => page.getByRole('group', { name: 'Markup' });
const addText = (page) => markup(page).getByRole('button', { name: 'Add text', exact: true });
const pageOne = (page) => page.locator('.rf-pdf-page[data-page="1"]');
const savedBoxes = (page) => pageOne(page).locator('.rf-textbox[data-id^="mark-"]');

async function pressAt(page, fx, fy) {
  const box = await pageOne(page).boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test('a box is placed, typed and saved in page points, and back after a reload and a zoom', async ({ page, api }) => {
  await openReader(page);
  await addText(page).click();
  await expect(markup(page).getByRole('status')).toHaveText(/^Add text on, Ink, 12 points\./);
  await pressAt(page, 0.3, 0.7);
  const draft = page.getByRole('textbox', { name: 'New text box on page 1' });
  await expect(draft).toBeFocused();
  await page.keyboard.type('See figure 3');
  await page.keyboard.press('Escape'); // leaves the box: it is saved; Add text stays on
  await expect.poll(() => api.markPosts.length).toBe(1);
  const [body] = api.markPosts;
  expect(body).toMatchObject({ kind: 'text', page: 1, color: 'ink', data: { text: 'See figure 3', size: 12, width: 192 } });
  const scale = Number(await pageOne(page).getAttribute('data-scale'));
  const box = await pageOne(page).boundingBox();
  expect(Math.abs(body.data.x - (box.width * 0.3) / scale)).toBeLessThan(1.5);
  expect(Math.abs(body.data.y - (box.height * 0.7) / scale)).toBeLessThan(1.5);
  await expect(addText(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(savedBoxes(page)).toHaveText('See figure 3');
  await expect(savedBoxes(page)).toHaveAttribute('data-selected', 'true');

  await pressAt(page, 0.3, 0.85); // a box left empty is dropped
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(api.markPosts).toHaveLength(1);

  await page.reload();
  await openReader(page);
  await expect(savedBoxes(page)).toHaveText('See figure 3');
  const before = await savedBoxes(page).boundingBox();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await savedBoxes(page).boundingBox()).width).toBeGreaterThan(before.width * 1.1);
  const after = Number(await pageOne(page).getAttribute('data-scale'));
  const font = await savedBoxes(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(Math.abs(font - 12 * after)).toBeLessThan(0.1); // its points times the new scale
});

test('with Add text on a box is retyped by a click, and emptied it is deleted with an Undo', async ({ page, api }) => {
  api.marks.push({ id: 'mark-1', kind: 'text', page: 1, color: 'ocean', data: { x: 100, y: 500, width: 192, text: 'Old note', size: 12 } });
  await openReader(page);
  await expect(savedBoxes(page)).toHaveText('Old note');
  await expect(savedBoxes(page)).not.toHaveAttribute('role', 'button'); // only drawn while Add text is off
  await addText(page).click();
  await savedBoxes(page).click();
  const editing = page.getByRole('textbox', { name: 'Text box on page 1' });
  await expect(editing).toBeFocused();
  await editing.fill('New note');
  await page.keyboard.press('Escape');
  await expect.poll(() => api.markPatches.at(-1)?.data?.text).toBe('New note');
  await expect(savedBoxes(page)).toHaveText('New note');

  await savedBoxes(page).focus(); // by keyboard: Enter edits
  await page.keyboard.press('Enter');
  await expect(editing).toBeFocused();
  await editing.fill('   ');
  await page.keyboard.press('Escape');
  await expect.poll(() => api.markDeletes).toEqual(['mark-1']);
  await expect(page.getByText('Text box deleted.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => api.markPosts.at(-1)?.data?.text).toBe('New note');
  await expect(pageOne(page).locator('.rf-textbox')).toHaveText('New note');
});

test("Enter on the book places a box by keyboard; Add text's menu picks its colour and size", async ({ page, api }) => {
  await openReader(page);
  await markup(page).getByRole('button', { name: 'Text options' }).click();
  await page.getByRole('radiogroup', { name: 'Add text colour' }).getByRole('radio', { name: 'Poppy' }).click();
  const size = page.getByRole('slider', { name: 'Size' });
  await size.focus();
  await page.keyboard.press('ArrowRight');
  await expect(size).toHaveAttribute('aria-valuetext', '14 points');
  await page.keyboard.press('Escape');
  await expect(addText(page)).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.rf-ov-stage').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'New text box on page 1' })).toBeFocused();
  await page.keyboard.type('By keyboard');
  await page.keyboard.press('Tab'); // leaving by Tab saves it too
  await expect.poll(() => api.markPosts.length).toBe(1);
  expect(api.markPosts[0]).toMatchObject({ color: 'poppy', data: { text: 'By keyboard', size: 14 } });
});

test('the selected box moves by its handle or the arrow keys; the menu restyles it', async ({ page, api }) => {
  api.marks.push({ id: 'mark-1', kind: 'text', page: 1, color: 'ink', data: { x: 100, y: 400, width: 192, text: 'Move me', size: 12 } });
  await openReader(page);
  await addText(page).click();
  await expect(page.getByRole('button', { name: 'Move text box' })).toHaveCount(0); // only the selected box has one
  await savedBoxes(page).click();
  await page.keyboard.press('Escape'); // retyped nothing: still selected
  const grip = page.getByRole('button', { name: 'Move text box' });
  await expect(grip).toBeVisible();

  const scale = Number(await pageOne(page).getAttribute('data-scale'));
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 50 * scale, g.y + g.height / 2 + 20 * scale, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => api.markPatches.at(-1)?.data).toMatchObject({ x: 150, y: 420, text: 'Move me' });

  await grip.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => api.markPatches.at(-1)?.data?.x).toBe(146);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => api.markPatches.at(-1)?.data?.y).toBe(436);

  await markup(page).getByRole('button', { name: 'Text options' }).click();
  await page.getByRole('radio', { name: 'Berry' }).click();
  await expect.poll(() => api.markPatches.at(-1)?.color).toBe('berry');
  const width = page.getByRole('slider', { name: 'Width' });
  await width.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => api.markPatches.at(-1)?.data?.width).toBe(240);
  await expect(savedBoxes(page)).toHaveAttribute('data-mark-colour', 'berry');
});

test('with Add text off the words under a box are selectable', async ({ page, api }) => {
  api.marks.push({ id: 'mark-1', kind: 'text', page: 1, color: 'ink', data: { x: 20, y: 40, width: 400, text: 'Over the words', size: 18 } });
  await openReader(page);
  await expect(savedBoxes(page)).toBeVisible();
  const hit = await savedBoxes(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + 5, r.top + 5)?.closest('.rf-textbox') !== null;
  });
  expect(hit).toBe(false); // the press goes to the page's text, not the box
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('an EPUB has no Add text', async ({ page }) => {
    await openReader(page);
    await expect(markup(page).getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
    await expect(addText(page)).toHaveCount(0);
  });
});
