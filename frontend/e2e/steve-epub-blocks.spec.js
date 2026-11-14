// Block actions in an EPUB (C20.8c): the converted fixture's equation (with its TeX annotation), its Python
// listing and its plot. Copy as LaTeX and Copy code never leave the device; Explain asks Steve.
import { test, expect, BOOKS, book, openReader, settled } from './fixtures.js';

BOOKS.converted = { file: 'converted.epub', format: 'epub', type: 'application/epub+zip', today: [0],
  chunks: ['Converted text that no book holds, so today runs from the start to the end of the book.'] };
test.use({ book: 'converted' });

test.beforeEach(async ({ context, api }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  api.steve.consented = true;
});

/** Turn pages until a section frame shows `selector` on screen; returns that element's locator. */
async function find(page, selector) {
  for (let turn = 0; turn < 12; turn += 1) {
    for (const frame of page.frames()) {
      const el = frame.locator(selector).first();
      if (await el.count() && await el.isVisible()) {
        const box = await el.boundingBox();
        const viewport = page.viewportSize();
        if (box && box.x >= 0 && box.x + box.width <= viewport.width) {
          await settled(page); // the actions wait while a page turns
          return el;
        }
      }
    }
    await book(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
  }
  throw new Error(`${selector} never came into view`);
}

async function hover(page, el) {
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
}

test('an equation copies as LaTeX from its TeX annotation, with no call', async ({ page, api }) => {
  await openReader(page);
  const math = await find(page, 'math');
  await hover(page, math);
  const actions = page.getByRole('toolbar', { name: 'Equation, this page' });
  await expect(actions.getByRole('button')).toHaveText(['Explain this equation', 'Copy as LaTeX']);
  await actions.getByRole('button', { name: 'Copy as LaTeX' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy as LaTeX' });
  await expect(dialog.locator('.rf-latex-source')).toHaveText('E = mc^2');
  await expect(dialog.getByText('From the book’s own markup.', { exact: false })).toBeVisible();
  expect(api.steve.latexAsks).toEqual([]);
  expect(api.steve.asks).toEqual([]);
});

test('an equation the region map does not know is explained from its own source', async ({ page, api }) => {
  await openReader(page);
  await hover(page, await find(page, 'math'));
  await page.getByRole('toolbar', { name: 'Equation, this page' }).getByRole('button', { name: 'Explain this equation' }).click();
  await expect.poll(() => api.steve.asks.length).toBe(1);
  expect(api.regionAtAsks).toHaveLength(1);
  expect(api.regionAtAsks[0]).toMatch(/^\d+:\/4(\/\d+)+$/); // section and CFI steps
  expect(api.steve.asks[0]).toMatchObject({ mode: 'ask', question: 'Explain this equation: $$E = mc^2$$' });
});

test('an equation the region map knows is explained by its region', async ({ page, api }) => {
  await openReader(page);
  const math = await find(page, 'math');
  const path = await math.evaluate((el) => {
    const steps = [];
    for (let node = el; node.parentElement; node = node.parentElement) {
      steps.unshift(2 * ([...node.parentElement.children].indexOf(node) + 1));
    }
    return `/${steps.join('/')}`;
  });
  await hover(page, math);
  const known = (key) => { api.regionAt[key] = { id: 'r-epub-eq', kind: 'math' }; };
  for (let spine = 0; spine < 6; spine += 1) known(`${spine}:${path}`);
  await page.getByRole('toolbar', { name: 'Equation, this page' }).getByRole('button', { name: 'Explain this equation' }).click();
  await expect.poll(() => api.steve.asks.length).toBe(1);
  expect(api.steve.asks[0]).toMatchObject({ mode: 'explain_equation', region_id: 'r-epub-eq', question: 'Explain this equation.' });
  expect(api.steve.asks[0].image_png_b64).toBeUndefined(); // an EPUB equation needs no picture
});

test('code copies its exact text on the device', async ({ page, api }) => {
  await openReader(page);
  const pre = await find(page, 'pre');
  const text = await pre.evaluate((el) => el.textContent);
  await hover(page, pre);
  await page.getByRole('toolbar', { name: 'Code, this page' }).getByRole('button', { name: 'Copy code' }).click();
  await expect(page.getByText('Code copied.')).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(text.replace(/\r\n/g, '\n'));
  expect(text).toContain('return 3.14159 * r ** 2');
  expect(api.steve.asks).toEqual([]);
});

test('a figure is explained with its image file as a PNG', async ({ page, api }) => {
  await openReader(page);
  await hover(page, await find(page, 'figure img'));
  await page.getByRole('toolbar', { name: 'Figure, this page' }).getByRole('button', { name: 'Explain this figure' }).click();
  await expect.poll(() => api.steve.asks.length).toBe(1);
  expect(api.steve.asks[0]).toMatchObject({ mode: 'explain_figure', question: 'Explain this figure.' });
  expect(api.steve.asks[0].image_png_b64.startsWith('iVBOR')).toBe(true);
});

test('keyboard: a block takes focus, Enter moves to its actions, Esc puts them away', async ({ page }) => {
  await openReader(page);
  const pre = await find(page, 'pre');
  await pre.focus();
  const actions = page.getByRole('toolbar', { name: 'Code, this page' });
  await expect(actions).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(actions.getByRole('button', { name: 'Copy code' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions).toHaveCount(0);
});
