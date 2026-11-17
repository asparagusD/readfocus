// C23.1: where the book's body (chapter 1) begins. Pages before it say "Focus mode starts at Chapter 1" in the
// folio line; the contents drawer marks the start entry and offers "The book starts here", which moves the start
// to the page shown (the reader's choice, kept by the server). PDF and EPUB; a failed lookup changes nothing.
import { book, expect, openReader, settled, test } from './fixtures';

const folio = (page) => page.locator('.rf-ov-folio');
const NOTE = 'Focus mode starts at Chapter 1';
const pdfStart = (page) => ({ source: 'outline', body_start: { kind: 'pdf', page, title: 'Chapter 1',
  anchor: { kind: 'pdf', page, quads: [[0, 0, 0, 0]], text: '' } } });

async function openContents(page) {
  await page.getByRole('button', { name: 'Contents' }).click();
  return page.getByRole('dialog', { name: 'Contents' });
}

test('PDF: front matter says where focus mode starts; turning past it, the note goes', async ({ page, api }) => {
  api.bodyStart = pdfStart(4);
  await openReader(page);
  await expect(folio(page)).toContainText(NOTE);
  let at = await settled(page);
  while (Number(at.end) < 4) {
    await book(page).focus();
    await page.keyboard.press('ArrowRight');
    at = await settled(page, at);
  }
  await expect(folio(page)).not.toContainText('Focus mode starts');
});

test('PDF: "The book starts here" sends the page shown, and its front-matter note goes', async ({ page, api }) => {
  api.bodyStart = pdfStart(6);
  await openReader(page);
  await expect(folio(page)).toContainText(NOTE);
  const at = await settled(page);
  const drawer = await openContents(page);
  await expect(drawer.getByText(/^Focus mode starts at Chapter 1, p\. \S+\.$/)).toBeVisible(); // its printed page
  await drawer.getByRole('button', { name: 'The book starts here' }).click();
  await expect.poll(() => api.bodyStartPuts.map((b) => b.page)).toEqual([Number(at.start)]);
  await expect(page.getByText(/Focus mode now starts at p\./)).toBeVisible();
  await expect(drawer.getByText(/^Focus mode starts at .+, p\. i\.$/)).toBeVisible(); // the page shown, as printed
  await page.keyboard.press('Escape');
  await expect(folio(page)).not.toContainText('Focus mode starts');
});

test('a book with no known start, or a failed lookup, shows no note and no start line', async ({ page, api }) => {
  api.bodyStartFail = true;
  await openReader(page);
  await expect(folio(page)).not.toContainText('Focus mode starts');
  const drawer = await openContents(page);
  await expect(drawer.getByRole('button', { name: 'The book starts here' })).toBeVisible(); // still settable
  await expect(drawer.getByText(/^Focus mode starts at/)).toHaveCount(0);
});

test.describe('EPUB', () => {
  test.use({ book: 'epub' });

  test('a section before the start says so; "The book starts here" sends the section shown', async ({ page, api }) => {
    api.bodyStart = { source: 'heading', body_start: { kind: 'epub', spine_index: 40, title: 'Part One',
      anchor: { kind: 'epub', cfi: 'epubcfi(/6/82!/4)', text: '' } } };
    await openReader(page);
    await expect(folio(page)).toContainText('Focus mode starts at Part One');
    const at = await settled(page);
    const drawer = await openContents(page);
    await drawer.getByRole('button', { name: 'The book starts here' }).click();
    await expect.poll(() => api.bodyStartPuts.map((b) => b.spine_index)).toEqual([Number(at.start.split(':')[0])]);
    await page.keyboard.press('Escape');
    await expect(folio(page)).not.toContainText('Focus mode starts');
  });

  test('the contents entry at the start is marked', async ({ page, api }) => {
    await openReader(page);
    const index = Number((await settled(page)).start.split(':')[0]); // today's first section, chapter 1
    api.bodyStart ={ source: 'outline', body_start: { kind: 'epub', spine_index: index, title: 'Chapter 1' } };
    await page.reload();
    await openReader(page);
    const drawer = await openContents(page);
    await expect(drawer.locator('.rf-contents-item', { has: page.locator('.rf-contents-start') })).toHaveCount(1);
    await expect(drawer.locator('.rf-contents-start')).toHaveText('focus starts');
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the drawer action is a 44 px target and nothing scrolls sideways', async ({ page, api }) => {
    api.bodyStart = pdfStart(6);
    await openReader(page);
    const drawer = await openContents(page);
    const box = await drawer.getByRole('button', { name: 'The book starts here' }).boundingBox();
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
