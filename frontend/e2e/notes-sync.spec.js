// C22.5: the book and the notepad follow each other. Turning pages scrolls the notepad to the first note on the
// pages shown and marks those notes softly; while a note is being written the notepad stays put and offers "Jump
// to notes for this page" instead. A note's reference moves the book to its passage and pulses it. A filter
// shows this page, this chapter or all. PDF and EPUB; reduced motion; mocked API.
import { book, expect, openReader, settled, test } from './fixtures';

const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const list = (page) => page.locator('.rf-notes');
const here = (page) => panel(page).locator('.rf-note[data-here]');
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** Two whole-page notes on every page of the six-page sample PDF, as the server keeps them. */
function seedPdf(api) {
  for (let p = 1; p <= 6; p += 1) {
    for (const k of ['a', 'b']) {
      api.notes.push({ id: `n${p}${k}`, kind: 'text', scope: 'view', anchors: [{ kind: 'pdf', page: p, quads: [[0, 0, 612, 792]], text: '' }],
        position_start: p * 1e6, position_end: p * 1e6 + 79200, content: doc(`About page ${p} (${k})`), version: 1,
        orphaned: false, deleted_at: null, created_at: `2026-11-14T10:0${p}:0${k === 'a' ? 0 : 1}Z`, urls: {} });
    }
  }
}

/** The page numbers the notepad marks as on the pages shown. */
const markedPages = async (page) => (await here(page).evaluateAll((els) => els.map((el) => el.dataset.id))).map((id) => Number(id[1]));

/** True when the note's card starts inside the upper part of the list's visible area. */
const inView = (page, id) => page.evaluate((noteId) => {
  const box = document.querySelector('.rf-notes').getBoundingClientRect();
  const card = document.querySelector(`.rf-note[data-id="${noteId}"]`).getBoundingClientRect();
  return card.top >= box.top - 1 && card.top <= box.top + box.height / 2;
}, id);

async function turn(page) {
  const before = await settled(page);
  await page.getByRole('button', { name: 'Next' }).click();
  return settled(page, before);
}

test.describe('pdf', () => {
  test.use({ viewport: { width: 1440, height: 700 } });

  test('turning pages scrolls the notepad to that spread\'s notes and marks them', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    await page.getByRole('button', { name: /^Notes/ }).click();
    await expect(panel(page).locator('.rf-note')).toHaveCount(12);
    await expect.poll(() => markedPages(page)).toEqual([1, 1]);
    await page.waitForTimeout(300);
    expect(await list(page).evaluate((el) => el.scrollTop)).toBe(0); // already in view: the filter stays on screen
    await expect(panel(page).getByRole('radiogroup', { name: 'Show notes' })).toBeInViewport();
    await turn(page); // pages 2-3
    await expect.poll(() => markedPages(page)).toEqual([2, 2, 3, 3]);
    await turn(page); // pages 4-5
    await expect.poll(() => markedPages(page)).toEqual([4, 4, 5, 5]);
    await expect.poll(() => inView(page, 'n4a')).toBe(true);
    expect(await list(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(panel(page).getByRole('button', { name: 'Jump to notes for this page' })).toHaveCount(0);
  });

  test('while a note is being written the notepad stays put and offers the jump instead', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    await page.getByRole('button', { name: /^Notes/ }).click();
    await panel(page).getByRole('button', { name: /^Edit note at / }).first().click();
    await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
    const top = await list(page).evaluate((el) => el.scrollTop);
    await turn(page);
    await turn(page); // pages 4-5
    const jump = panel(page).getByRole('button', { name: 'Jump to notes for this page' });
    await expect(jump).toBeVisible();
    expect(await list(page).evaluate((el) => el.scrollTop)).toBe(top);
    await expect(panel(page).locator('.rf-note[data-editing]')).toHaveCount(1); // still writing
    await jump.click();
    await expect.poll(() => inView(page, 'n4a')).toBe(true);
    await expect(jump).toHaveCount(0);
  });

  test('a note\'s reference moves the book to its passage and pulses it; the notepad holds still', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    await page.getByRole('button', { name: /^Notes/ }).click();
    await panel(page).locator('.rf-note[data-id="n5b"]').scrollIntoViewIfNeeded();
    const top = await list(page).evaluate((el) => el.scrollTop);
    await panel(page).locator('.rf-note[data-id="n5b"]').getByRole('button', { name: /^Go to / }).click();
    await expect(page.locator('.rf-pdf-page[data-page="5"]')).toBeVisible();
    const pulse = page.locator('.rf-passage-pulse');
    await expect(pulse.first()).toBeVisible();
    const box = await pulse.first().boundingBox();
    const sheet = await page.locator('.rf-pdf-page[data-page="5"]').boundingBox();
    expect(Math.abs(box.x - sheet.x)).toBeLessThan(3); // a whole-page note pulses the page
    expect(Math.abs(box.width - sheet.width)).toBeLessThan(3);
    await expect(pulse).toHaveCount(0, { timeout: 4000 }); // it fades out
    expect(Math.abs((await list(page).evaluate((el) => el.scrollTop)) - top)).toBeLessThan(2);
    await expect.poll(() => markedPages(page)).toEqual([4, 4, 5, 5]);
  });

  test('the filter shows this page, this chapter or all', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    await page.getByRole('button', { name: /^Notes/ }).click();
    const filter = panel(page).getByRole('radiogroup', { name: 'Show notes' });
    await expect(filter.getByRole('radio', { name: 'All' })).toBeChecked();
    await filter.getByRole('radio', { name: 'This page' }).click();
    await expect(panel(page).locator('.rf-note')).toHaveCount(2);
    await turn(page);
    await expect(panel(page).locator('.rf-note')).toHaveCount(4);
    await filter.getByRole('radio', { name: 'This chapter' }).click();
    const inChapter = await panel(page).locator('.rf-note').count();
    expect(inChapter).toBeGreaterThanOrEqual(4);
    expect(inChapter).toBeLessThanOrEqual(12);
    await filter.getByRole('radio', { name: 'All' }).click();
    await expect(panel(page).locator('.rf-note')).toHaveCount(12);
    // Arrow keys move along the filter (one tab stop).
    await filter.getByRole('radio', { name: 'All' }).focus();
    await page.keyboard.press('Home');
    await expect(filter.getByRole('radio', { name: 'This page' })).toBeChecked();
    await expect(filter.getByRole('radio', { name: 'This page' })).toBeFocused();
  });
});

test.describe('epub', () => {
  test.use({ book: 'epub', viewport: { width: 1440, height: 700 } });

  test('notes follow the EPUB, stay with their page after a larger text size, and the reference returns to it', async ({ page, api }) => {
    await openReader(page);
    await page.getByRole('button', { name: /^Notes/ }).click();
    // A note on the first page, then one two pages on.
    await book(page).focus();
    await page.keyboard.press('n');
    await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
    await page.keyboard.type('First page');
    await panel(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => api.notes.length).toBe(1);
    const first = await settled(page);
    await turn(page);
    await turn(page);
    await expect(here(page)).toHaveCount(0);
    await book(page).focus();
    await page.keyboard.press('n');
    await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
    await page.keyboard.type('Later page');
    await panel(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => api.notes.length).toBe(2);
    await expect(here(page)).toHaveCount(1);
    await expect(here(page)).toContainText('Later page');

    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.waitForTimeout(800);
    await expect(here(page)).toContainText('Later page'); // the page shown still holds the note's characters

    await panel(page).locator('.rf-note', { hasText: 'First page' }).getByRole('button', { name: /^Go to / }).click();
    await expect.poll(async () => (await settled(page)).start.split(':')[0]).toBe(first.start.split(':')[0]);
    await expect(page.locator('.rf-passage-pulse').first()).toBeVisible();
    await expect(here(page)).toContainText('First page');
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 700 } });

  test('the notepad jumps without a smooth scroll and the pulse only fades', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    await page.getByRole('button', { name: /^Notes/ }).click();
    await turn(page);
    await turn(page); // pages 4-5, at once: no smooth scroll to wait for
    await expect.poll(() => inView(page, 'n4a'), { timeout: 600 }).toBe(true);
    await panel(page).locator('.rf-note[data-id="n2a"]').getByRole('button', { name: /^Go to / }).click();
    const pulse = page.locator('.rf-passage-pulse').first();
    await expect(pulse).toBeVisible();
    expect(await pulse.evaluate((el) => getComputedStyle(el).animationName)).toBe('rf-passage-fade');
  });
});
