// The notes as one journey (C22; since C37.3 every note goes into the notebook), in a PDF and an EPUB: Add note writes
// the selected passage on the notebook page for this place, a second passage on the same page of the book joins it,
// the notepad's list follows the book and a page's reference jumps back to its passage. A page changed offline is
// saved on reconnect, and a change another tab saved first shows the merge prompt. Mocked API (fixtures.js).
import { test, expect, bookAtRest, openNotepad, openReader, settled, wordPoint } from './fixtures.js';

const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const notebook = (page) => page.getByRole('dialog', { name: 'Notebook' });
const written = (api) => api.notePatches.filter((p) => p.content?.elements).at(-1)?.content.elements
  .filter((e) => e.type === 'text').map((e) => e.text) ?? [];

async function turn(page) {
  const before = await settled(page);
  await page.getByRole('button', { name: 'Next' }).click();
  return settled(page, before);
}

/** Drag the mouse over a passage, from the start of `from` to the end of `to` (the book at rest: C37.7). */
async function select(page, from, to) {
  await bookAtRest(page);
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('toolbar', { name: 'Highlight the selection' })).toBeVisible();
}

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind, viewport: { width: 1440, height: 760 } });

    test('Add note writes the passage on the notebook page for this place; the list follows the book and jumps back', async ({ page, api }) => {
      await openReader(page);
      const first = await settled(page);
      await select(page, 'lamp', 'circle');
      await page.getByRole('toolbar', { name: 'Highlight the selection' }).getByRole('button', { name: 'Add note' }).click();
      await expect(notebook(page)).toBeVisible();
      await expect.poll(() => api.notePosts.length).toBe(1);
      expect(api.notePosts[0]).toMatchObject({ kind: 'drawing', scope: 'selection' });
      await expect.poll(() => written(api).join(' '), { timeout: 8000 }).toMatch(/lamp[\s\S]*circle/);
      await notebook(page).getByRole('button', { name: 'Close notebook' }).click();

      // The same page of the book: the next passage joins the page, below the first.
      await select(page, 'small', 'small');
      await page.getByRole('toolbar', { name: 'Highlight the selection' }).getByRole('button', { name: 'Add note' }).click();
      await expect(notebook(page)).toBeVisible();
      await expect.poll(() => written(api).join(' '), { timeout: 8000 }).toMatch(/lamp[\s\S]*circle[\s\S]*small/);
      expect(api.notePosts).toHaveLength(1);
      await notebook(page).getByRole('button', { name: 'Close notebook' }).click();

      await openNotepad(page);
      await expect(panel(page).locator('.rf-note[data-here]')).toHaveCount(1);
      await turn(page);
      await turn(page);
      await expect(panel(page).locator('.rf-note[data-here]')).toHaveCount(0);
      await panel(page).locator('.rf-note').first().getByRole('button', { name: /^Go to / }).click();
      await expect.poll(async () => (await settled(page)).start.split(':')[0]).toBe(first.start.split(':')[0]);
      await expect(page.locator('.rf-passage-pulse').first()).toBeVisible();
      await expect(panel(page).locator('.rf-note[data-here]')).toHaveCount(1);
    });
  });
}

/** A new notebook page at the first pages, its canvas ready to draw on. */
async function openPage(page, api) {
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  await notebook(page).getByRole('button', { name: 'New page' }).first().click();
  await expect(notebook(page).locator('canvas.interactive')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => api.notes.length).toBe(1);
  await page.waitForTimeout(500);
}

/** A rectangle on the page, right of Excalidraw's shape properties panel. */
async function rectangle(page) {
  await notebook(page).getByTitle(/^Rectangle —/).click();
  const at = await notebook(page).locator('canvas.interactive').boundingBox();
  await page.mouse.move(at.x + 360, at.y + 160);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(at.x + 360 + 20 * i, at.y + 160 + 10 * i);
  await page.mouse.up();
}

test('a page changed offline is saved when the browser is back online', async ({ page, api }) => {
  await openPage(page, api);
  api.noteFail = 'abort';
  await rectangle(page);
  await expect(notebook(page).getByRole('status').filter({ hasText: /^Offline/ })).toBeVisible({ timeout: 4000 });
  await expect(notebook(page).getByText('Waiting to save')).toBeVisible();
  api.noteFail = null;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(notebook(page).getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(api.notes[0].content.elements.map((e) => e.type)).toEqual(['rectangle']);
});

test('a page another tab saved first shows the merge prompt; Keep mine wins on the saved version', async ({ page, api }) => {
  await openPage(page, api);
  api.notes[0].version = 5; // another tab saved since
  await rectangle(page);
  const alert = notebook(page).getByRole('alert');
  await expect(alert).toContainText('This note changed in another tab.', { timeout: 4000 });
  await expect(alert.getByRole('button', { name: 'Use the saved one' })).toBeVisible();
  await alert.getByRole('button', { name: 'Keep mine' }).click();
  await expect(alert).toHaveCount(0);
  await expect.poll(() => api.notes[0].version).toBe(6);
  expect(api.notes[0].content.elements.map((e) => e.type)).toEqual(['rectangle']);
});
