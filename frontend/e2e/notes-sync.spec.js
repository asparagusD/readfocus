// C22.5: the book and the notepad follow each other. Turning pages scrolls the notepad to the first note on the
// pages shown and marks those notes softly; while a note is being written the notepad stays put and offers "Jump
// to notes for this page" instead. A note's reference moves the book to its passage and pulses it. A filter
// shows this page, this chapter or all. PDF and EPUB; reduced motion; mocked API.
import { expect, openNotepad, openReader, settled, test } from './fixtures';

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

/** C38.2: the marks the notepad should show: two seeded notes for each PDF page in view (a scrolled view shows one, two
    or a sliver of the next, as the panel's width sets the page size). */
async function shownMarks(page) {
  const { start, end } = await settled(page);
  return Array.from({ length: Number(end) - Number(start) + 1 }, (_, i) => Number(start) + i).flatMap((p) => [p, p]);
}

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
    await openNotepad(page);
    await expect(panel(page).locator('.rf-note')).toHaveCount(12);
    await expect.poll(async () => markedPages(page)).toEqual(await shownMarks(page));
    expect((await markedPages(page))[0]).toBe(1);
    await page.waitForTimeout(300);
    expect(await list(page).evaluate((el) => el.scrollTop)).toBe(0); // already in view: the filter stays on screen
    await expect(panel(page).getByRole('radiogroup', { name: 'Show notes' })).toBeInViewport();
    await turn(page);
    await turn(page); // C38.2: a page at a time, page 3 at the top
    await expect.poll(async () => markedPages(page)).toEqual(await shownMarks(page));
    expect((await markedPages(page))[0]).toBe(3);
    await turn(page); // page 4 at the top, its notes below the fold of the list
    await expect.poll(async () => markedPages(page)).toEqual(await shownMarks(page));
    await expect.poll(() => inView(page, 'n4a')).toBe(true);
    expect(await list(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(panel(page).getByRole('button', { name: 'Jump to notes for this page' })).toHaveCount(0);
  });

  test('just after the reader scrolled the list the notepad stays put and offers the jump instead', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    // Scroll anchoring would hide a jump measured before the pill above the notes goes (DEBUG_LOG 2026-11-17 C25.5).
    await page.addStyleTag({ content: '.rf-notes, .rf-notes * { overflow-anchor: none !important; }' });
    await openNotepad(page);
    await turn(page); // pages 2-3
    await page.waitForTimeout(400);
    const box = await list(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 40); // by hand, just before the turn (C37.4: no typed note to write in any more)
    await page.waitForTimeout(200);
    const top = await list(page).evaluate((el) => el.scrollTop);
    await turn(page); // pages 4-5, within the 2 s the notepad holds still after a hand scroll
    const jump = panel(page).getByRole('button', { name: 'Jump to notes for this page' });
    await expect(jump).toBeVisible();
    expect(await list(page).evaluate((el) => el.scrollTop)).toBe(top);
    await jump.click();
    await expect.poll(() => inView(page, 'n4a')).toBe(true);
    await expect(jump).toHaveCount(0);
  });

  test('a note\'s reference moves the book to its passage and pulses it; the notepad holds still', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    await openNotepad(page);
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
    await expect.poll(async () => markedPages(page)).toEqual(await shownMarks(page)); // C38.2: page 5 at the top
    expect((await markedPages(page))[0]).toBe(5);
  });

  test('the filter shows this page, this chapter or all', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    await openNotepad(page);
    const filter = panel(page).getByRole('radiogroup', { name: 'Show notes' });
    await expect(filter.getByRole('radio', { name: 'All' })).toBeChecked();
    await filter.getByRole('radio', { name: 'This page' }).click();
    await expect(panel(page).locator('.rf-note')).toHaveCount((await shownMarks(page)).length); // C38.2: the pages in view
    await turn(page);
    await expect(panel(page).locator('.rf-note')).toHaveCount((await shownMarks(page)).length);
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
    const notebook = page.getByRole('dialog', { name: 'Notebook' });
    const newPage = async (n) => { // C37.3: a notebook page at the place shown
      await page.getByRole('button', { name: /^Notes/ }).click();
      await notebook.getByRole('button', { name: 'New page' }).first().click();
      await expect.poll(() => api.notes.length).toBe(n);
      await notebook.getByRole('button', { name: 'Close notebook' }).click();
      await expect(notebook).toHaveCount(0);
    };
    // A page on the first page, then one two pages on.
    await newPage(1);
    const first = await settled(page);
    await turn(page);
    await turn(page);
    await newPage(2);
    await openNotepad(page);
    await expect(here(page)).toHaveCount(1);
    await expect(here(page)).toHaveAttribute('data-id', api.notes[1].id);

    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.waitForTimeout(800);
    await expect(here(page)).toHaveAttribute('data-id', api.notes[1].id); // the page shown still holds the note's characters

    await panel(page).locator(`.rf-note[data-id="${api.notes[0].id}"]`).getByRole('button', { name: /^Go to / }).click();
    await expect.poll(async () => (await settled(page)).start.split(':')[0]).toBe(first.start.split(':')[0]);
    await expect(page.locator('.rf-passage-pulse').first()).toBeVisible();
    await expect(here(page)).toHaveAttribute('data-id', api.notes[0].id);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 700 } });

  test('the notepad jumps without a smooth scroll and the pulse only fades', async ({ page, api }) => {
    seedPdf(api);
    await openReader(page);
    await openNotepad(page);
    await turn(page);
    await turn(page); // pages 4-5, at once: no smooth scroll to wait for
    await expect.poll(() => inView(page, 'n4a'), { timeout: 600 }).toBe(true);
    await panel(page).locator('.rf-note[data-id="n2a"]').getByRole('button', { name: /^Go to / }).click();
    const pulse = page.locator('.rf-passage-pulse').first();
    await expect(pulse).toBeVisible();
    expect(await pulse.evaluate((el) => getComputedStyle(el).animationName)).toBe('rf-passage-fade');
  });
});
