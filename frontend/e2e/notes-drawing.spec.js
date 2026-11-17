// Drawing notes (C22.3): "+ Drawing" adds a note and opens Excalidraw, loaded only then and served from our own
// origin (fonts too: no other host is asked, constraint 1); shapes, arrows, freehand, text, undo; "Paste passage"
// puts the note's text in as a text element; the scene autosaves as JSON; Done exports a PNG thumbnail to the
// notes bucket, which the list shows without loading Excalidraw. Lamplight draws dark; a phone opens it full
// screen under the passage reference. Mocked API (fixtures.js).
import { test, expect, openReader } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const drawing = (page) => page.locator('.rf-drawing');
const canvas = (page) => drawing(page).locator('canvas.interactive');

/** Requests to any host but this machine (the app, its mocked API). */
function outside(page) {
  const urls = [];
  page.on('request', (r) => { const { hostname } = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(hostname) && !r.url().startsWith('data:')) urls.push(r.url()); });
  return urls;
}

async function addDrawing(page) {
  await page.getByRole('button', { name: /^Notes/ }).click();
  await panel(page).getByRole('button', { name: 'Drawing' }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await settledCanvas(page);
}

/** The canvas has stopped resizing (the panel widens as a drawing opens). */
async function settledCanvas(page) {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await canvas(page).boundingBox());
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [150], timeout: 5000 }).toBe(true);
}

/** Drags on the canvas from (x0, y0) to (x1, y1), relative to its top-left. */
async function drag(page, x0, y0, x1, y1) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + x0 + ((x1 - x0) * i) / 6, box.y + y0 + ((y1 - y0) * i) / 6);
  await page.mouse.up();
}

const lastScene = (api) => api.notePatches.filter((p) => p.content).at(-1)?.content;

test('a drawing loads Excalidraw only when opened, from our own origin, and saves shapes, arrows and freehand', async ({ page, api }) => {
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  const far = outside(page);
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  expect(scripts.some((u) => u.includes('DrawingEditor'))).toBe(false);
  await panel(page).getByRole('button', { name: 'Drawing' }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await settledCanvas(page);
  expect(scripts.some((u) => u.includes('DrawingEditor'))).toBe(true);
  await expect.poll(() => api.notePosts.length).toBe(1);
  expect(api.notePosts[0]).toMatchObject({ kind: 'drawing', scope: 'view', content: { elements: [] } });
  await drawing(page).getByTitle(/^Rectangle —/).click();
  await drag(page, 40, 140, 140, 200);
  await drawing(page).getByTitle(/^Arrow —/).click();
  await drag(page, 160, 150, 240, 210);
  await drawing(page).getByTitle(/^Draw —/).click();
  await drag(page, 60, 230, 200, 250);
  await drawing(page).getByTitle(/^Text —/).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.click(box.x + 60, box.y + 280);
  await page.keyboard.type('never shrinks');
  await page.keyboard.press('Escape'); // ends the text, stays in the drawing
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => (lastScene(api)?.elements ?? []).map((e) => e.type).sort(), { timeout: 5000 })
    .toEqual(['arrow', 'freedraw', 'rectangle', 'text']);
  const scene = lastScene(api);
  expect(scene.elements.find((e) => e.type === 'text').text).toBe('never shrinks');
  expect(Object.keys(scene.appState ?? {})).toEqual(['viewBackgroundColor']);
  expect(scene.files ?? {}).toEqual({});
  await page.keyboard.press('Control+z'); // undo the text
  await expect.poll(() => lastScene(api).elements.map((e) => e.type).sort(), { timeout: 5000 }).toEqual(['arrow', 'freedraw', 'rectangle']);
  await drawing(page).getByRole('button', { name: 'Undo' }).isVisible(); // Excalidraw's own undo and redo are there
  await expect(drawing(page).locator('[data-testid="main-menu-trigger"]')).toBeVisible();
  for (const absent of ['Text to diagram', 'Export', 'Open', 'Save to', 'Excalidraw+', 'Live collaboration']) {
    await expect(drawing(page).getByText(absent, { exact: false })).toHaveCount(0);
  }
  if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/notes-drawing-paper-1440.png` }); }
  expect(far).toEqual([]);
});

test('Done exports a PNG thumbnail to the notes bucket; the list shows it without loading Excalidraw', async ({ page, api }) => {
  await openReader(page);
  await addDrawing(page);
  await expect.poll(() => api.notes.length).toBe(1);
  // the panel widens for the drawing (its tools all show), and the list never scrolls sideways
  expect((await panel(page).boundingBox()).width).toBeGreaterThanOrEqual(560);
  const tools = await drawing(page).getByTitle(/^Eraser —/).boundingBox();
  expect(tools.x + tools.width).toBeLessThanOrEqual((await canvas(page).boundingBox()).x + (await canvas(page).boundingBox()).width);
  expect(await panel(page).locator('.rf-notes').evaluate((el) => el.scrollLeft)).toBe(0);
  await drawing(page).getByTitle(/^Rectangle —/).click();
  await drag(page, 40, 140, 160, 220);
  await panel(page).getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => Math.round((await panel(page).boundingBox()).width)).toBe(380);
  await expect.poll(() => api.noteFilePosts.length).toBe(1);
  expect(api.noteFilePosts[0].content_type).toBe('image/png');
  expect(Buffer.from(api.noteFilePosts[0].data, 'base64').subarray(1, 4).toString()).toBe('PNG');
  expect(Buffer.from(api.noteFilePosts[0].data, 'base64').length).toBeLessThanOrEqual(262_144);
  await expect.poll(() => api.notes[0].thumbnail_path).toBe('e2e-reader/e2e-book/file-1.png');
  const thumb = panel(page).getByRole('img', { name: /^Drawing/ });
  await expect(thumb).toBeVisible();
  expect(await thumb.evaluate((img) => img.naturalWidth > 0)).toBe(true);
  if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/notes-drawing-thumb-1440.png` }); }
  await expect(canvas(page)).toHaveCount(0);
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.reload();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor();
  await page.getByRole('button', { name: 'Notes, 1' }).click();
  await expect(panel(page).getByRole('img', { name: /^Drawing/ })).toBeVisible();
  expect(scripts.some((u) => u.includes('DrawingEditor'))).toBe(false);
  await panel(page).getByRole('button', { name: /^Edit drawing at / }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await settledCanvas(page);
  await drawing(page).getByTitle(/^Ellipse —/).click();
  await drag(page, 180, 140, 260, 210);
  // the saved rectangle came back with the scene: the next save holds both
  await expect.poll(() => (lastScene(api)?.elements ?? []).map((e) => e.type).sort(), { timeout: 5000 }).toEqual(['ellipse', 'rectangle']);
});

test('Paste passage puts the selected words in as a text element', async ({ page, api }) => {
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  await page.locator('.textLayer span', { hasText: 'Line 3 of page 1' }).first().dblclick();
  await panel(page).getByRole('button', { name: 'Drawing' }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await settledCanvas(page);
  await expect.poll(() => api.notePosts.length).toBe(1);
  const words = api.notePosts[0].anchors.map((a) => a.text).join(' ');
  expect(api.notePosts[0].scope).toBe('selection');
  await panel(page).getByRole('button', { name: 'Paste passage' }).click();
  await expect.poll(() => lastScene(api)?.elements.find((e) => e.type === 'text')?.text.replace(/\s+/g, ' '), { timeout: 5000 }).toBe(words);
});

test('Mermaid to Excalidraw still converts, math included, on the overridden nanoid and katex', async ({ page, api }) => {
  // package.json "overrides" (C22.3 follow-up): nanoid 5 and katex 0.19 under mermaid-to-excalidraw.
  const far = outside(page);
  await openReader(page);
  await addDrawing(page);
  await expect.poll(() => api.notes.length).toBe(1);
  await drawing(page).getByRole('button', { name: 'More tools' }).click();
  await drawing(page).getByText('Mermaid to Excalidraw').click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Mermaid to Excalidraw' }); // Excalidraw leaves it unnamed
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('textbox').fill('flowchart LR\n  A["$$x^2$$"] --> B[Done]');
  // Excalidraw parses the chart on a debounce and draws its preview on a canvas the page cannot read: give it time.
  await page.waitForTimeout(2000);
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(() => (lastScene(api)?.elements ?? []).length, { timeout: 8000 }).toBeGreaterThan(2);
  expect(far).toEqual([]);
});

test('a note on whole pages has no passage to paste', async ({ page }) => {
  await openReader(page);
  await addDrawing(page);
  await expect(panel(page).getByRole('button', { name: 'Paste passage' })).toBeDisabled();
});

test.describe('lamplight', () => {
  test.use({ colorScheme: 'dark' });
  test('the drawing follows the dark theme; Escape inside it keeps the panel open', async ({ page }) => {
    const far = outside(page);
    await openReader(page);
    await addDrawing(page);
    await expect(drawing(page).locator('.excalidraw.theme--dark')).toBeVisible();
    await canvas(page).click({ position: { x: 80, y: 200 } });
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeVisible();
    if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/notes-drawing-lamplight-1440.png` }); }
    expect(far).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('the drawing opens full screen under the passage reference', async ({ page, api }) => {
    await openReader(page);
    await addDrawing(page);
    await expect.poll(() => api.notes.length).toBe(1);
    const screen = page.getByRole('dialog', { name: /^Drawing at / });
    await expect(screen).toBeVisible();
    const box = await screen.boundingBox();
    expect([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, 375, 812]);
    const ref = screen.locator('.rf-drawing-ref');
    await expect(ref).toHaveText(/^p\. /);
    expect((await ref.boundingBox()).y).toBeLessThan(60);
    expect(Math.round((await screen.getByRole('button', { name: 'Done' }).boundingBox()).height)).toBeGreaterThanOrEqual(44);
    if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/notes-drawing-paper-375.png` }); }
    await screen.getByRole('button', { name: 'Done' }).click();
    await expect(screen).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });
});
