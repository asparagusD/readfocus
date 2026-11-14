// C22.4: anchoring notes and margin markers. "Add note" in the selection toolbar, N, or the notepad's Text pill
// anchors the new note to the selection, else to the pages shown (PDF) or the page's CFI range (EPUB). "Link to
// current selection" moves a note's anchor. Passages with notes get a marker in the margin beside them (PDF:
// the frame margin outside the page; EPUB: the page margin); it stays beside them after a zoom, a larger text
// size or a narrower window, and clicking it opens the notepad at those notes. Mocked API.
import { book, expect, openReader, test, wordPoint } from './fixtures';

const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });
const markers = (page) => page.locator('.rf-note-marker');

/** Drag the mouse from the start of `from` to the end of `to` (first visible occurrences). */
async function select(page, from, to) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(toolbar(page)).toBeVisible();
  return { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
}

/** The paper the marker belongs beside: the PDF page under a point, or the EPUB book box. */
async function paperAt(page, kind, y) {
  if (kind === 'epub') return page.locator('.rf-ov-book').boundingBox();
  const boxes = await page.locator('.rf-pdf-page').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  return boxes.find((b) => y >= b.top && y <= b.bottom) ?? boxes[0];
}

/** The marker is level with `line` (its top within 14 px) and in the margin: outside a PDF page, inside an EPUB page's edge. */
async function expectBeside(page, kind, line) {
  await expect(markers(page)).toHaveCount(1);
  const marker = await markers(page).boundingBox();
  expect(Math.abs(marker.y - line.top), `marker at ${marker.y}, line at ${line.top}`).toBeLessThanOrEqual(14);
  const paper = await paperAt(page, kind, line.top + 2);
  const view = page.viewportSize();
  expect(marker.x).toBeGreaterThanOrEqual(0);
  expect(marker.x + marker.width).toBeLessThanOrEqual(view.width);
  if (kind === 'pdf' && view.width >= 760) {
    expect(marker.x >= paper.right || marker.x + marker.width <= paper.left, 'outside the page').toBe(true);
  } else {
    const fromEdge = Math.min(Math.abs(marker.x - paper.x), Math.abs(paper.x + paper.width - (marker.x + marker.width)));
    expect(fromEdge, 'at the page edge').toBeLessThanOrEqual(24);
  }
}

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind });

    test('Add note anchors to the selection and a marker appears beside it, after a re-layout too', async ({ page, api }) => {
      await openReader(page);
      const line = await select(page, 'lamp', 'circle');
      await toolbar(page).getByRole('button', { name: 'Add note' }).click();
      await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
      await expect.poll(() => api.notePosts.length).toBe(1);
      const [post] = api.notePosts;
      expect(post.scope).toBe('selection');
      expect(post.anchors[0]).toMatchObject({ kind, text: expect.stringMatching(/^lamp .*circle$/) });
      await expect(toolbar(page)).toHaveCount(0);
      await expectBeside(page, kind, line);
      await expect(markers(page)).toHaveAccessibleName('1 note on this passage');

      if (kind === 'pdf') {
        await page.getByRole('button', { name: 'Zoom in' }).click();
      } else {
        await page.getByRole('button', { name: 'Larger text' }).click();
      }
      await page.waitForTimeout(700);
      const moved = await wordPoint(page, 'lamp');
      await expectBeside(page, kind, moved);
    });

    test('N with nothing selected anchors to the pages shown, and the marker opens the note', async ({ page, api }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('n');
      await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
      await expect.poll(() => api.notePosts.length).toBe(1);
      const [post] = api.notePosts;
      expect(post.scope).toBe('view');
      expect(post.anchors[0]).toMatchObject({ kind, text: '' });
      if (kind === 'epub') expect(post.anchors[0].cfi).toContain(',');
      await page.keyboard.type('About these pages');
      await page.keyboard.press('Escape'); // out of the editor
      await panel(page).getByRole('button', { name: 'Close notes' }).click();
      await expect(panel(page)).toHaveCount(0);

      await expect(markers(page)).toHaveCount(1);
      await markers(page).click();
      await expect(panel(page)).toBeVisible();
      const note = panel(page).locator('.rf-note[data-focused]');
      await expect(note).toHaveCount(1);
      await expect(note.locator('.rf-note-read')).toBeFocused();
      await expect(note).toContainText('About these pages');
    });

    test('Link to current selection moves a note to the selected passage', async ({ page, api }) => {
      await openReader(page);
      await page.getByRole('button', { name: /^Notes/ }).click();
      await panel(page).getByRole('button', { name: 'Text' }).click();
      await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
      await expect.poll(() => api.notes.length).toBe(1);
      await page.keyboard.press('Escape'); // out of the editor; the panel stays
      const line = await select(page, 'lamp', 'circle');
      await panel(page).getByRole('button', { name: /to the current selection$/ }).click();
      await expect.poll(() => api.notePatches.filter((p) => p.anchors).length).toBe(1);
      const patch = api.notePatches.find((p) => p.anchors);
      expect(patch.scope).toBe('selection');
      expect(patch.anchors[0].text).toMatch(/^lamp .*circle$/);
      expect(patch.position_start).toBeGreaterThanOrEqual(0);
      await expectBeside(page, kind, line);
    });
  });
}

test('Link to current selection without a selection says what to do and changes nothing', async ({ page, api }) => {
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  await panel(page).getByRole('button', { name: 'Text' }).click();
  await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
  await expect.poll(() => api.notes.length).toBe(1);
  await page.keyboard.press('Escape'); // out of the editor; the panel stays
  await panel(page).getByRole('button', { name: /to the current selection$/ }).click();
  await expect(page.getByText('Select a passage in the book first')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(api.notePatches.filter((p) => p.anchors)).toHaveLength(0);
});

test.describe('phone', () => {
  test.use({ book: 'epub', viewport: { width: 375, height: 812 } });

  test('the marker is a smaller circle at the right edge, inside the screen', async ({ page }) => {
    await openReader(page);
    const line = await select(page, 'lamp', 'circle');
    await toolbar(page).getByRole('button', { name: 'Add note' }).click();
    await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
    await page.keyboard.press('Escape');
    await panel(page).getByRole('button', { name: 'Close notes' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expectBeside(page, 'epub', line);
    const marker = await markers(page).boundingBox();
    expect(Math.round(marker.width)).toBe(22);
    expect(marker.x).toBeGreaterThan(375 / 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
