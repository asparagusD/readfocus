// The notebook (C37.2, issue 26; drawing notes since C22.3): one per book, its pages the book's drawing notes in
// book order, open over 70 % of the screen with the book blurred and inert in the other 30 %. Excalidraw loads
// only when a page opens, from our own origin (fonts too: no other host is asked, constraint 1); a page saves as
// it changes and leaving it exports a PNG thumbnail to the notes bucket, which the notepad's list shows without
// Excalidraw. Pages turn by arrows or tabs; "Go to this place" turns to the page made where the book is; a click on the
// blurred book or Escape (once Excalidraw has nothing left to do) tucks it away and it reopens where it was left.
// Lamplight draws dark; a phone opens it full screen. Mocked API (fixtures.js).
import { test, expect, openReader, settled } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const notebook = (page) => page.getByRole('dialog', { name: 'Notebook' });
const canvas = (page) => notebook(page).locator('canvas.interactive');

/** Requests to any host but this machine (the app, its mocked API). */
function outside(page) {
  const urls = [];
  page.on('request', (r) => { const { hostname } = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(hostname) && !r.url().startsWith('data:')) urls.push(r.url()); });
  return urls;
}

/** C37.3: the toolbar's Notes opens the notebook. */
async function openNotebook(page) {
  await page.getByRole('button', { name: /^Notes/ }).click();
  await expect(notebook(page)).toBeVisible();
}

async function newPage(page) {
  await notebook(page).getByRole('button', { name: 'New page' }).first().click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await settledCanvas(page);
}

/** The canvas has stopped resizing. */
async function settledCanvas(page) {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await canvas(page).boundingBox());
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [150], timeout: 5000 }).toBe(true);
}

// Strokes start right of Excalidraw's shape properties panel, which a page this wide shows at its left.
const LEFT = 320;

/** Drags on the canvas from (x0, y0) to (x1, y1), relative to its top-left plus LEFT. */
async function drag(page, x0, y0, x1, y1) {
  const at = await canvas(page).boundingBox();
  const box = { x: at.x + LEFT, y: at.y };
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + x0 + ((x1 - x0) * i) / 6, box.y + y0 + ((y1 - y0) * i) / 6);
  await page.mouse.up();
}

/** A box once its entrance has finished moving it. */
async function still(locator) {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await locator.boundingBox());
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [150], timeout: 5000 }).toBe(true);
  return locator.boundingBox();
}

const lastScene = (api, id) => api.notePatches.filter((p) => p.content && (!id || p.id === id)).at(-1)?.content;

test('Notes opens the notebook over 70 % with the book blurred and inert; a new page loads Excalidraw from our own origin and saves', async ({ page, api }) => {
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  const far = outside(page);
  await openReader(page);
  await openNotebook(page);
  await expect(page.getByRole('button', { name: /^Notes/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(notebook(page).getByText('No pages yet')).toBeVisible();
  expect(scripts.some((u) => u.includes('DrawingEditor'))).toBe(false);
  const view = page.viewportSize();
  const box = await still(notebook(page));
  expect(Math.round(box.x)).toBe(Math.round(view.width * 0.3));
  expect(Math.round(box.width)).toBe(Math.round(view.width * 0.7));
  const area = page.locator('.rf-reading-area');
  await expect.poll(() => area.evaluate((el) => getComputedStyle(el).filter)).toContain('blur(8px)');
  expect(await area.evaluate((el) => el.inert)).toBe(true);
  expect(await page.locator('.rf-reading-chrome').evaluate((el) => el.inert)).toBe(true);
  if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/notebook-empty-1440.png` }); }

  await newPage(page);
  expect(scripts.some((u) => u.includes('DrawingEditor'))).toBe(true);
  await expect.poll(() => api.notePosts.length).toBe(1);
  expect(api.notePosts[0]).toMatchObject({ kind: 'drawing', scope: 'view', content: { elements: [] } });
  await expect(notebook(page).getByRole('tab', { name: 'Page 1' })).toHaveAttribute('aria-selected', 'true');
  await notebook(page).getByTitle(/^Rectangle —/).click();
  await drag(page, 40, 140, 140, 200);
  await notebook(page).getByTitle(/^Arrow —/).click();
  await drag(page, 160, 150, 240, 210);
  await notebook(page).getByTitle(/^Draw —/).click();
  await drag(page, 60, 230, 200, 250);
  await notebook(page).getByTitle(/^Text —/).click();
  const at = await canvas(page).boundingBox();
  await page.mouse.click(at.x + LEFT + 60, at.y + 280);
  await page.keyboard.type('never shrinks');
  await page.keyboard.press('Escape'); // ends the text; the notebook stays
  await expect(notebook(page)).toBeVisible();
  await expect.poll(() => (lastScene(api)?.elements ?? []).map((e) => e.type).sort(), { timeout: 5000 })
    .toEqual(['arrow', 'freedraw', 'rectangle', 'text']);
  expect(lastScene(api).elements.find((e) => e.type === 'text').text).toBe('never shrinks');
  expect(Object.keys(lastScene(api).appState ?? {})).toEqual(['viewBackgroundColor']);
  await expect(notebook(page).getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 5000 });
  for (const absent of ['Text to diagram', 'Export', 'Open', 'Save to', 'Excalidraw+', 'Live collaboration']) {
    await expect(notebook(page).getByText(absent, { exact: false })).toHaveCount(0);
  }
  if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/notebook-page-1440.png` }); }
  expect(far).toEqual([]);
});

test('leaving a page exports its thumbnail; the list shows it and opens the notebook at that page', async ({ page, api }) => {
  api.steve.consented = true;
  await openReader(page);
  await openNotebook(page);
  await newPage(page);
  await expect.poll(() => api.notes.length).toBe(1);
  await notebook(page).getByTitle(/^Rectangle —/).click();
  await drag(page, 40, 140, 160, 220);
  await expect.poll(() => (lastScene(api)?.elements ?? []).length, { timeout: 5000 }).toBe(1);
  await notebook(page).getByRole('button', { name: 'Close notebook' }).click();
  await expect(notebook(page)).toHaveCount(0);
  await expect(page.locator('.rf-reading-page[data-notebook]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Notes/ })).toBeFocused(); // focus goes back where it came from
  await expect.poll(() => api.noteFilePosts.length).toBe(1);
  const png = Buffer.from(api.noteFilePosts[0].data, 'base64');
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.length).toBeLessThanOrEqual(262_144);
  await expect.poll(() => api.notes[0].thumbnail_path).toBe('e2e-reader/e2e-book/file-1.png');

  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.reload();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor();
  // The list straight from Steve's panel, so no page is opened on the way: the thumbnail needs no Excalidraw.
  await page.getByRole('button', { name: 'Ask Steve' }).click();
  await page.getByRole('tab', { name: /^Notes/ }).click();
  const thumb = panel(page).getByRole('img', { name: /^Notebook page at / });
  await expect(thumb).toBeVisible();
  expect(await thumb.evaluate((img) => img.naturalWidth > 0)).toBe(true);
  expect(scripts.some((u) => u.includes('DrawingEditor'))).toBe(false);
  await panel(page).getByRole('button', { name: /^Open notebook page at / }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await settledCanvas(page);
  await notebook(page).getByTitle(/^Ellipse —/).click();
  await drag(page, 180, 140, 260, 210);
  // the saved rectangle came back with the page: the next save holds both
  await expect.poll(() => (lastScene(api)?.elements ?? []).map((e) => e.type).sort(), { timeout: 5000 }).toEqual(['ellipse', 'rectangle']);
});

test('pages turn by arrows and tabs, "Go to this place" finds the page made here, and the notebook reopens where it was left', async ({ page, api }) => {
  await openReader(page);
  const first = await settled(page);
  await openNotebook(page);
  await newPage(page); // page 1, at the first pages
  await expect.poll(() => api.notes.length).toBe(1);
  await page.locator('.rf-notebook-scrim').click(); // a click on the blurred book
  await expect(notebook(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Next' }).click();
  await settled(page, first);
  await openNotebook(page);
  await expect(notebook(page).getByRole('tab', { name: 'Page 1' })).toHaveAttribute('aria-selected', 'true'); // where it was left
  await expect(notebook(page).getByRole('button', { name: 'Go to the page made at this place in the book' })).toBeDisabled();
  await newPage(page); // page 2, here
  await expect.poll(() => api.notes.length).toBe(2);
  await expect(notebook(page).getByRole('tab', { name: 'Page 2' })).toHaveAttribute('aria-selected', 'true');
  await notebook(page).getByRole('button', { name: 'Previous page' }).click();
  await expect(notebook(page).getByRole('tab', { name: 'Page 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(notebook(page).getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await notebook(page).getByRole('button', { name: 'Go to the page made at this place in the book' }).click();
  await expect(notebook(page).getByRole('tab', { name: 'Page 2' })).toHaveAttribute('aria-selected', 'true');
  await notebook(page).getByRole('tab', { name: 'Page 2' }).focus();
  await page.keyboard.press('Home');
  await expect(notebook(page).getByRole('tab', { name: 'Page 1' })).toBeFocused();
  await expect(notebook(page).getByRole('tab', { name: 'Page 1' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape'); // focus is on a tab, not in the drawing: Escape tucks the notebook away
  await expect(notebook(page)).toHaveCount(0);
  await openNotebook(page);
  await expect(notebook(page).getByRole('tab', { name: 'Page 1' })).toHaveAttribute('aria-selected', 'true');
  // the page's reference goes to its place in the book, and the book comes back into focus
  await notebook(page).getByRole('button', { name: /^Go to p\. .* in the book$/ }).click();
  await expect(notebook(page)).toHaveCount(0);
  await expect.poll(async () => (await settled(page)).start).toBe(first.start);
});

test('a page can be deleted, with Undo', async ({ page, api }) => {
  await openReader(page);
  await openNotebook(page);
  await newPage(page);
  await expect.poll(() => api.notes.length).toBe(1);
  await notebook(page).getByRole('button', { name: 'Delete page 1' }).click();
  await expect(notebook(page).getByText('No pages yet')).toBeVisible();
  await expect.poll(() => api.noteDeletes.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('Paste passage puts the selected words in again as a text element', async ({ page, api }) => {
  await openReader(page);
  await page.locator('.textLayer span', { hasText: 'Line 3 of page 1' }).first().dblclick();
  // C37.3: Add note starts the page at the selection, the passage already written on it.
  await page.getByRole('toolbar', { name: 'Highlight the selection' }).getByRole('button', { name: 'Add note' }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => api.notePosts.length).toBe(1);
  const words = api.notePosts[0].anchors.map((a) => a.text).join(' ');
  expect(api.notePosts[0].scope).toBe('selection');
  const copies = () => (lastScene(api)?.elements ?? []).filter((e) => e.type === 'text' && e.text.replace(/\s+/g, ' ') === words).length;
  await expect.poll(copies, { timeout: 8000 }).toBe(1);
  await notebook(page).getByRole('button', { name: 'Paste passage' }).click();
  await expect.poll(copies, { timeout: 5000 }).toBe(2);
});

test('Mermaid to Excalidraw still converts, math included, on the overridden nanoid and katex', async ({ page, api }) => {
  // package.json "overrides" (C22.3 follow-up): nanoid 5 and katex 0.19 under mermaid-to-excalidraw.
  const far = outside(page);
  await openReader(page);
  await openNotebook(page);
  await newPage(page);
  await expect.poll(() => api.notes.length).toBe(1);
  await notebook(page).getByRole('button', { name: 'More tools' }).click();
  await notebook(page).getByText('Mermaid to Excalidraw').click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Mermaid to Excalidraw' }); // Excalidraw leaves it unnamed
  await expect(dialog.last()).toBeVisible({ timeout: 15_000 });
  await dialog.last().getByRole('textbox').fill('flowchart LR\n  A["$$x^2$$"] --> B[Done]');
  // Excalidraw parses the chart on a debounce and draws its preview on a canvas the page cannot read: give it time.
  await page.waitForTimeout(2000);
  await dialog.last().getByRole('button', { name: 'Insert' }).click();
  await expect.poll(() => (lastScene(api)?.elements ?? []).length, { timeout: 8000 }).toBeGreaterThan(2);
  await expect(notebook(page)).toBeVisible(); // Escape-free: the dialog's own close never closed the notebook
  expect(far).toEqual([]);
});

test('a page on whole pages has no passage to paste', async ({ page }) => {
  await openReader(page);
  await openNotebook(page);
  await newPage(page);
  await expect(notebook(page).getByRole('button', { name: 'Paste passage' })).toBeDisabled();
});

test('Steve sits over the book\'s 30 % while the notebook is open', async ({ page, api }) => {
  api.steve.consented = true;
  await openReader(page);
  await openNotebook(page);
  await newPage(page);
  await expect.poll(() => api.notes.length).toBe(1);
  await notebook(page).getByRole('button', { name: 'Close notebook' }).click();
  await page.getByRole('button', { name: 'Ask Steve' }).click();
  await page.locator('.rf-note-marker').first().click(); // the page's margin marker opens the notebook at it
  await expect(notebook(page)).toBeVisible();
  const steve = page.getByRole('complementary', { name: /Steve/ });
  await expect(steve).toBeVisible();
  const view = page.viewportSize();
  const box = await still(steve);
  expect([Math.round(box.x), Math.round(box.width)]).toEqual([0, Math.round(view.width * 0.3)]);
  if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/notebook-steve-1440.png` }); }
});

test.describe('lamplight', () => {
  test.use({ colorScheme: 'dark' });
  test('the page follows the dark theme; Escape ends typing first, then closes the notebook', async ({ page }) => {
    const far = outside(page);
    await openReader(page);
    await openNotebook(page);
    await newPage(page);
    await expect(notebook(page).locator('.excalidraw.theme--dark')).toBeVisible();
    await notebook(page).getByTitle(/^Text —/).click();
    const at = await canvas(page).boundingBox();
    await page.mouse.click(at.x + LEFT + 80, at.y + 200);
    await page.keyboard.type('dark');
    await page.keyboard.press('Escape'); // ends the text: Excalidraw's
    await expect(notebook(page)).toBeVisible();
    await expect.poll(() => page.locator('.excalidraw-wysiwyg').count()).toBe(0);
    if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/notebook-lamplight-1440.png` }); }
    await page.keyboard.press('Escape'); // nothing left for Excalidraw: the notebook closes
    await expect(notebook(page)).toHaveCount(0);
    expect(far).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('the notebook opens full screen with 44 px controls', async ({ page, api }) => {
    await openReader(page);
    await openNotebook(page);
    await newPage(page);
    await expect.poll(() => api.notes.length).toBe(1);
    const box = await still(notebook(page));
    expect([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, 375, 812]);
    for (const name of ['Close notebook', 'New page', 'Previous page']) {
      expect(Math.round((await notebook(page).getByRole('button', { name }).first().boundingBox()).height)).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/notebook-page-375.png` }); }
    await notebook(page).getByRole('button', { name: 'Close notebook' }).click();
    await expect(notebook(page)).toHaveCount(0);
  });
});
