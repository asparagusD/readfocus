// Block actions on a PDF (C20.8b): an equation, a code listing and a figure from the region map offer Explain,
// Copy as LaTeX and Copy code on hover or keyboard focus. Every call is mocked (fixtures.js).
import { test, expect, openReader } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const EQ = { id: 'r-eq', page: 1, kind: 'math', bbox: [72, 110, 300, 140], inline: false };
const CODE = { id: 'r-code', page: 1, kind: 'code', bbox: [72, 160, 300, 200], inline: false };
const FIG = { id: 'r-fig', page: 1, kind: 'figure', bbox: [72, 220, 300, 300], inline: false };
const CODE_TEXT = 'def toll(n):\n    return  2 * n   # two spaces kept';

test.beforeEach(async ({ context, api }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  api.regions = [EQ, CODE, FIG, { id: 'r-block', page: 1, kind: 'math', bbox: [80, 300, 90, 310], inline: true }];
  api.regionDetails['r-code'] = { id: 'r-code', kind: 'code', page: 1, text: CODE_TEXT, language: 'python' };
  api.steve.consented = true;
});

/** Move the mouse to the middle of a region's box on its page. */
async function hover(page, region) {
  const pageEl = page.locator(`.rf-pdf-page[data-page="${region.page}"][data-scale]`);
  await expect(pageEl).toBeVisible();
  const box = await pageEl.boundingBox();
  const scale = Number(await pageEl.getAttribute('data-scale'));
  const [x0, top, x1, bottom] = region.bbox;
  await page.mouse.move(box.x + ((x0 + x1) / 2) * scale, box.y + ((top + bottom) / 2) * scale, { steps: 4 });
}

const bar = (page, name) => page.getByRole('toolbar', { name });

test('an equation offers Explain and Copy as LaTeX; Explain sends a crop to Steve', async ({ page, api }) => {
  await openReader(page);
  await hover(page, EQ);
  const actions = bar(page, 'Equation, page 1');
  await expect(actions.getByRole('button')).toHaveText(['Explain this equation', 'Copy as LaTeX']);
  const sheet = await page.locator('.rf-pdf-page[data-page="1"]').boundingBox();
  const drawn = await actions.boundingBox();
  expect(drawn.x).toBeGreaterThanOrEqual(sheet.x); // the bar stays on the page
  expect(drawn.x + drawn.width).toBeLessThanOrEqual(sheet.x + sheet.width);
  if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/blocks-equation-1440.png` }); }
  await actions.getByRole('button', { name: 'Explain this equation' }).click();
  await expect(page.getByRole('complementary', { name: 'Steve' })).toBeVisible();
  await expect(page.locator('.rf-steve-q')).toHaveText('Equation, p. 1: Explain this equation.');
  await expect.poll(() => api.steve.asks.length).toBe(1); // C21.4: an ask waits for Steve's settings, then goes
  const [asked] = api.steve.asks;
  expect(asked).toMatchObject({ mode: 'explain_equation', region_id: 'r-eq', question: 'Explain this equation.' });
  expect(asked.image_png_b64.startsWith('iVBOR')).toBe(true); // a PNG
  expect(asked.image_png_b64.length * 0.75).toBeLessThan(500 * 1024);
});

test('Copy as LaTeX shows a KaTeX preview and copies the LaTeX', async ({ page, api }) => {
  await openReader(page);
  await hover(page, EQ);
  await bar(page, 'Equation, page 1').getByRole('button', { name: 'Copy as LaTeX' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy as LaTeX' });
  await expect(dialog.locator('math')).toBeAttached();
  await expect(dialog.locator('.rf-latex-source')).toHaveText('a_n = \\frac{1}{\\pi}');
  if (shots) await page.screenshot({ path: `${shots}/blocks-latex-1440.png` });
  await dialog.getByRole('button', { name: 'Copy LaTeX' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('a_n = \\frac{1}{\\pi}');
  expect(api.steve.latexAsks[0]).toMatchObject({ book_id: 'e2e-book', region_id: 'r-eq' });
  expect(api.steve.latexAsks[0].image_png_b64.startsWith('iVBOR')).toBe(true);
});

test('a refusal is said in the dialog', async ({ page, api }) => {
  api.steve.latexReplies.push({ status: 403, detail: { code: 'no_consent', message: 'Turn on Steve first: he needs your consent before he reads along.' } });
  await openReader(page);
  await hover(page, EQ);
  await bar(page, 'Equation, page 1').getByRole('button', { name: 'Copy as LaTeX' }).click();
  await expect(page.getByRole('dialog', { name: 'Copy as LaTeX' }).getByRole('alert')).toContainText('Turn on Steve first');
});

test('code copies its exact text with no Steve call, and Explain sends the region', async ({ page, api }) => {
  await openReader(page);
  await hover(page, CODE);
  const actions = bar(page, 'Code, page 1');
  await expect(actions.getByRole('button')).toHaveText(['Copy code', 'Explain this code']);
  await actions.getByRole('button', { name: 'Copy code' }).click();
  await expect(page.getByText('Code copied.')).toBeVisible();
  // Windows gives text back from its clipboard with CRLF line ends; the text copied is the exact listing.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(CODE_TEXT);
  expect(api.steve.asks).toEqual([]);
  await hover(page, CODE);
  await bar(page, 'Code, page 1').getByRole('button', { name: 'Explain this code' }).click();
  await expect.poll(() => api.steve.asks.length).toBe(1);
  expect(api.steve.asks[0]).toMatchObject({ mode: 'explain_code', region_id: 'r-code' });
  expect(api.steve.asks[0].image_png_b64).toBeUndefined();
});

test('a figure is explained from its crop', async ({ page, api }) => {
  await openReader(page);
  await hover(page, FIG);
  await bar(page, 'Figure, page 1').getByRole('button', { name: 'Explain this figure' }).click();
  await expect.poll(() => api.steve.asks.length).toBe(1);
  expect(api.steve.asks[0]).toMatchObject({ mode: 'explain_figure', region_id: 'r-fig' });
  expect(api.steve.asks[0].image_png_b64.startsWith('iVBOR')).toBe(true);
});

test('inline math has no actions, and moving away puts the bar away', async ({ page }) => {
  await openReader(page);
  await hover(page, { page: 1, bbox: [80, 300, 90, 310] });
  await page.waitForTimeout(500);
  await expect(page.locator('.rf-block-bar')).toHaveCount(0);
  await hover(page, EQ);
  await expect(page.locator('.rf-block-bar')).toHaveCount(1);
  await page.mouse.move(5, 5);
  await expect(page.locator('.rf-block-bar')).toHaveCount(0);
});

test('keyboard: an outline takes focus, Tab reaches the actions, Esc puts them away', async ({ page }) => {
  await openReader(page);
  const outline = page.getByRole('button', { name: 'Code, page 1: actions' });
  await outline.focus();
  const actions = bar(page, 'Code, page 1');
  await expect(actions).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(actions.getByRole('button', { name: 'Copy code' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions).toHaveCount(0);
});

test('with Steve switched off, blocks keep only what stays on the device', async ({ page, api }) => {
  api.steve.enabled = false; // C21.4 follow-up: Steve's entry points hide while he is off (steve-guardrails S2)
  await openReader(page);
  await page.getByRole('button', { name: 'Ask Steve' }).click(); // the toolbar's Steve: his settings load
  await expect(page.getByPlaceholder('Turn on Steve to ask')).toBeVisible();
  await page.keyboard.press('Escape');
  await hover(page, CODE);
  await expect(bar(page, 'Code, page 1').getByRole('button')).toHaveText(['Copy code']);
  await hover(page, EQ);
  await page.waitForTimeout(400);
  await expect(bar(page, 'Equation, page 1')).toHaveCount(0); // Explain and Copy as LaTeX both ask Gemini on a PDF
  expect(api.steve.asks).toHaveLength(0);
});
