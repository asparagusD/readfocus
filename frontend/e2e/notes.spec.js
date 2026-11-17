// The C22 notepad as one journey, in a PDF and an EPUB: a text note and a drawing; a page turn scrolls the notepad
// to that page's notes; a note's reference jumps back to its passage; an edit made offline is saved on reconnect;
// an edit another tab saved first shows the merge prompt. Mocked API (fixtures.js).
import { test, expect, book, openReader, settled } from './fixtures.js';

const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const editor = (page) => panel(page).getByRole('textbox', { name: /^Note at / });

async function turn(page) {
  const before = await settled(page);
  await page.getByRole('button', { name: 'Next' }).click();
  return settled(page, before);
}

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind, viewport: { width: 1440, height: 760 } });

    test('text and drawing notes, the notepad follows the book, a reference jumps back', async ({ page, api }) => {
      await openReader(page);
      const first = await settled(page);
      await page.getByRole('button', { name: /^Notes/ }).click();
      await panel(page).getByRole('button', { name: 'Text' }).click();
      await expect(editor(page)).toBeFocused();
      await page.keyboard.type('On the first page');
      await panel(page).getByRole('button', { name: 'Done' }).click();
      await panel(page).getByRole('button', { name: 'Drawing' }).click();
      await expect(panel(page).locator('.rf-drawing canvas.interactive')).toBeVisible({ timeout: 15_000 });
      await panel(page).getByRole('button', { name: 'Done' }).click();
      await expect.poll(() => api.notes.map((n) => n.kind)).toEqual(['text', 'drawing']);
      await expect(panel(page).locator('.rf-note[data-here]')).toHaveCount(2);

      await turn(page);
      await turn(page);
      await expect(panel(page).locator('.rf-note[data-here]')).toHaveCount(0);
      await book(page).focus();
      await page.keyboard.press('n');
      await expect(editor(page)).toBeFocused();
      await page.keyboard.type('Further on');
      await panel(page).getByRole('button', { name: 'Done' }).click();
      await expect.poll(() => api.notes.length).toBe(3);
      await expect(panel(page).locator('.rf-note[data-here]')).toHaveCount(1);
      await expect(panel(page).locator('.rf-note[data-here]')).toContainText('Further on');

      await panel(page).locator('.rf-note', { hasText: 'On the first page' }).getByRole('button', { name: /^Go to / }).click();
      await expect.poll(async () => (await settled(page)).start).toBe(first.start);
      await expect(page.locator('.rf-passage-pulse').first()).toBeVisible();
      await expect(panel(page).locator('.rf-note[data-here]')).toHaveCount(2);
    });
  });
}

test('an edit made offline is saved when the browser is back online', async ({ page, api }) => {
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  await panel(page).getByRole('button', { name: 'Text' }).click();
  await expect(editor(page)).toBeFocused();
  await expect.poll(() => api.notes.length).toBe(1);
  api.noteFail = 'abort';
  await page.keyboard.type('Written on the train.');
  await expect(panel(page).locator('.rf-note').getByText('Waiting to save')).toBeVisible({ timeout: 4000 });
  api.noteFail = null;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(panel(page).getByRole('status').filter({ hasText: 'All notes saved' })).toBeAttached();
  expect(JSON.stringify(api.notes[0].content)).toContain('Written on the train.');
});

test('an edit another tab saved first shows the merge prompt; Keep mine wins on the saved version', async ({ page, api }) => {
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  await panel(page).getByRole('button', { name: 'Text' }).click();
  await expect(editor(page)).toBeFocused();
  await expect.poll(() => api.notes.length).toBe(1);
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
