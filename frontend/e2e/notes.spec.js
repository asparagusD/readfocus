// The notes as one journey (C22; since C37.3 every note goes into the notebook), in a PDF and an EPUB: Add note writes
// the selected passage on the notebook page for this place, a second passage on the same page of the book joins it,
// the notepad's list follows the book and a page's reference jumps back to its passage. A typed note a reader
// already has still saves: an edit made offline is saved on reconnect, and an edit another tab saved first shows
// the merge prompt. Mocked API (fixtures.js).
import { test, expect, openNotepad, openReader, settled, wordPoint } from './fixtures.js';

const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const notebook = (page) => page.getByRole('dialog', { name: 'Notebook' });
const editor = (page) => panel(page).getByRole('textbox', { name: /^Note at / });
const written = (api) => api.notePatches.filter((p) => p.content?.elements).at(-1)?.content.elements
  .filter((e) => e.type === 'text').map((e) => e.text) ?? [];

async function turn(page) {
  const before = await settled(page);
  await page.getByRole('button', { name: 'Next' }).click();
  return settled(page, before);
}

/** Drag the mouse over a passage, from the start of `from` to the end of `to`. */
async function select(page, from, to) {
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

/** A typed note from before C37.3 on page 1, empty, at version 1. */
const typed = () => ({ id: 'note-1', kind: 'text', scope: 'view', version: 1, orphaned: false, deleted_at: null, urls: {},
  anchors: [{ kind: 'pdf', page: 1, quads: [[0, 0, 612, 792]], text: '' }], position_start: 1e6, position_end: 1e6 + 79_299,
  content: { type: 'doc', content: [{ type: 'paragraph' }] }, created_at: '2026-11-14T10:00:00Z' });

async function openTyped(page, api) {
  api.notes = [typed()];
  await openReader(page);
  await openNotepad(page);
  await panel(page).getByRole('button', { name: /^Edit note at / }).click();
  await expect(editor(page)).toBeFocused();
}

test('an edit made offline is saved when the browser is back online', async ({ page, api }) => {
  await openTyped(page, api);
  api.noteFail = 'abort';
  await page.keyboard.type('Written on the train.');
  await expect(panel(page).locator('.rf-note').getByText('Waiting to save')).toBeVisible({ timeout: 4000 });
  api.noteFail = null;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(panel(page).getByRole('status').filter({ hasText: 'All notes saved' })).toBeAttached();
  expect(JSON.stringify(api.notes[0].content)).toContain('Written on the train.');
});

test('an edit another tab saved first shows the merge prompt; Keep mine wins on the saved version', async ({ page, api }) => {
  await openTyped(page, api);
  api.notes[0].version = 5; // another tab saved since
  await page.keyboard.type('Mine.');
  const card = panel(page).locator('.rf-note').first();
  await expect(card.getByRole('alert')).toContainText('This note changed in another tab.', { timeout: 4000 });
  await expect(card.getByRole('button', { name: 'Use the saved one' })).toBeVisible();
  await card.getByRole('button', { name: 'Keep mine' }).click();
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => api.notes[0].version).toBe(6);
  expect(JSON.stringify(api.notes[0].content)).toContain('Mine.');
});
