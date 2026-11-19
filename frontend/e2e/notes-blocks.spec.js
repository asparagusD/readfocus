// C22.6: things from the book go to the notes; since C37.3 (issue 25) words go onto a notebook page. "Add to notes"
// on a PDF equation writes its LaTeX (from /steve/latex while Steve is on; with none it stays a block note with
// its crop), code writes its exact text (no Steve call), a figure stays a block note (its crop and caption) until
// pictures come (C37.6); on an EPUB an equation writes its own LaTeX and a listing its text, on the device; a
// highlight's chip writes the passage on a page linked to it; a Steve answer ("Save to notes") writes his answer
// and its sources. Mocked API (fixtures.js).
import { test, expect, BOOKS, book, openReader, settled, wordPoint } from './fixtures.js';

const EQ = { id: 'r-eq', page: 1, kind: 'math', bbox: [72, 110, 300, 140], inline: false };
const CODE = { id: 'r-code', page: 1, kind: 'code', bbox: [72, 160, 300, 200], inline: false };
const FIG = { id: 'r-fig', page: 1, kind: 'figure', bbox: [72, 220, 300, 300], inline: false };
const CODE_TEXT = 'def toll(n):\n    return  2 * n   # two spaces kept';
const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const bar = (page, name) => page.getByRole('toolbar', { name });
const shots = process.env.E2E_SHOTS;
const notebook = (page) => page.getByRole('dialog', { name: 'Notebook' });
/** Every text written on a notebook page, from every save. */
const written = (api) => api.notePatches.flatMap((p) => (p.content?.elements ?? []).filter((e) => e.type === 'text').map((e) => e.text));

function regions(api) {
  api.regions = [EQ, CODE, FIG];
  api.regionDetails['r-eq'] = { id: 'r-eq', kind: 'math', page: 1, text: 'a n = 1 / pi', latex: null };
  api.regionDetails['r-code'] = { id: 'r-code', kind: 'code', page: 1, text: CODE_TEXT, language: 'Python' };
  api.regionDetails['r-fig'] = { id: 'r-fig', kind: 'figure', page: 1, text: '', caption: 'Figure 1. The toll road.' };
}

async function hover(page, region) {
  const pageEl = page.locator(`.rf-pdf-page[data-page="${region.page}"][data-scale]`);
  await expect(pageEl).toBeVisible();
  const box = await pageEl.boundingBox();
  const scale = Number(await pageEl.getAttribute('data-scale'));
  const [x0, top, x1, bottom] = region.bbox;
  await page.mouse.move(box.x + ((x0 + x1) / 2) * scale, box.y + ((top + bottom) / 2) * scale, { steps: 4 });
}

test.describe('pdf regions', () => {
  test.beforeEach(({ api }) => { regions(api); api.steve.consented = true; });

  test('an equation is written on a notebook page as its LaTeX, asked of Steve first', async ({ page, api }) => {
    await openReader(page);
    await hover(page, EQ);
    await bar(page, 'Equation, page 1').getByRole('button', { name: 'Add to notes' }).click();
    await expect(notebook(page)).toBeVisible();
    await expect.poll(() => api.steve.latexAsks.length).toBe(1);
    await expect.poll(() => api.notePosts.length).toBe(1);
    expect(api.noteFilePosts).toHaveLength(0); // words, no crop
    expect(api.notePosts[0]).toMatchObject({ kind: 'drawing', region_id: 'r-eq', scope: 'selection',
      anchors: [{ kind: 'pdf', page: 1, quads: [EQ.bbox], text: 'a n = 1 / pi' }], content: { elements: [] } });
    await expect.poll(() => written(api), { timeout: 8000 }).toContain('$$a_n = \\frac{1}{\\pi}$$');
  });

  test('code is written on a notebook page as its exact text, with no Steve call', async ({ page, api }) => {
    await openReader(page);
    await hover(page, CODE);
    await bar(page, 'Code, page 1').getByRole('button', { name: 'Add to notes' }).click();
    await expect.poll(() => api.notePosts.length).toBe(1);
    expect(api.notePosts[0]).toMatchObject({ kind: 'drawing', region_id: 'r-code' });
    await expect.poll(() => written(api), { timeout: 8000 }).toContain(CODE_TEXT);
    expect(api.noteFilePosts).toHaveLength(0);
    expect(api.steve.asks).toHaveLength(0);
    expect(api.steve.latexAsks).toHaveLength(0);
  });

  test('a figure goes as its crop and caption', async ({ page, api }) => {
    await openReader(page);
    await hover(page, FIG);
    await bar(page, 'Figure, page 1').getByRole('button', { name: 'Add to notes' }).click();
    await expect.poll(() => api.notePosts.length).toBe(1);
    expect(api.notePosts[0]).toMatchObject({ kind: 'figure', region_id: 'r-fig',
      content: { caption: 'Figure 1. The toll road.', image_path: expect.stringMatching(/\.png$/) } });
    const card = panel(page).locator('.rf-note[data-kind="figure"]');
    await expect(card.locator('img')).toBeVisible();
    await expect(card.getByRole('textbox', { name: 'Caption' })).toHaveValue('Figure 1. The toll road.');
  });

  test('with Steve off an equation keeps its crop and an empty LaTeX field, and nothing asks him', async ({ page, api }) => {
    api.steve.enabled = false;
    await openReader(page);
    await page.getByRole('button', { name: 'Ask Steve' }).click(); // his settings load: he is off
    await expect(page.getByRole('complementary', { name: 'Steve' })).toBeVisible();
    await page.getByRole('button', { name: 'Close Steve' }).click();
    await hover(page, EQ);
    await bar(page, 'Equation, page 1').getByRole('button', { name: 'Add to notes' }).click();
    await expect.poll(() => api.notePosts.length).toBe(1);
    expect(api.notePosts[0].content.latex).toBe('');
    await page.waitForTimeout(800);
    expect(api.steve.latexAsks).toHaveLength(0);
    await expect(panel(page).locator('.rf-note[data-kind="equation"]').getByRole('textbox', { name: 'LaTeX' })).toHaveValue('');
  });
});

test.describe('epub regions', () => {
  BOOKS.converted = { file: 'converted.epub', format: 'epub', type: 'application/epub+zip', today: [0],
    chunks: ['Converted text that no book holds, so today runs from the start to the end of the book.'] };
  test.use({ book: 'converted' });

  async function find(page, selector) {
    for (let turn = 0; turn < 12; turn += 1) {
      for (const frame of page.frames()) {
        const el = frame.locator(selector).first();
        if (await el.count() && await el.isVisible()) {
          const box = await el.boundingBox();
          if (box && box.x >= 0 && box.x + box.width <= page.viewportSize().width) { await settled(page); return el; }
        }
      }
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(500);
    }
    throw new Error(`${selector} never came into view`);
  }

  // A block can still be moving after the notebook closes (the book comes back into focus); `settled` watches the
  // page shown, not where a block sits, so wait for the block's own box to stop moving.
  async function still(el) {
    let last = null;
    await expect.poll(async () => {
      const now = JSON.stringify(await el.boundingBox());
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [300], timeout: 10_000 }).toBe(true);
    return JSON.parse(last);
  }

  test('an EPUB equation goes with its own LaTeX and a listing with its text, on the device', async ({ page, api }) => {
    await openReader(page);
    const math = await find(page, 'math');
    const mbox = await math.boundingBox();
    await page.mouse.move(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2, { steps: 4 });
    await page.getByRole('toolbar', { name: 'Equation, this page' }).getByRole('button', { name: 'Add to notes' }).click();
    await expect.poll(() => api.notePosts.length).toBe(1);
    const [eq] = api.notePosts;
    expect(eq).toMatchObject({ kind: 'drawing', content: { elements: [] } });
    expect(eq.anchors[0].kind).toBe('epub');
    await expect.poll(() => written(api).some((t) => /^\$\$.+\$\$$/s.test(t)), { timeout: 8000 }).toBe(true);
    expect(api.steve.latexAsks).toHaveLength(0);
    await notebook(page).getByRole('button', { name: 'Close notebook' }).click();

    const pre = await find(page, 'pre');
    const pbox = await still(pre);
    // Straight onto the listing: a path from the equation can cross the figure below it, whose bar (placed above
    // the figure, over the listing) then holds the pointer.
    await page.mouse.move(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2);
    await page.getByRole('toolbar', { name: 'Code, this page' }).getByRole('button', { name: 'Add to notes' }).click();
    const code = await pre.textContent();
    await expect.poll(() => written(api), { timeout: 8000 }).toContain(code);
    expect(api.notePosts.every((post) => post.kind === 'drawing')).toBe(true); // a second page only in another chapter
  });
});

test('a highlight\'s Add note writes the passage on a notebook page linked to the highlight', async ({ page, api }) => {
  await openReader(page);
  const a = await wordPoint(page, 'lamp');
  const b = await wordPoint(page, 'circle');
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('toolbar', { name: 'Highlight the selection' }).getByRole('button', { name: 'Sky highlight', exact: true }).click();
  await expect.poll(() => api.annotations.length).toBe(1);
  await page.getByRole('switch', { name: 'Look up words on hover' }).click();
  const w = await wordPoint(page, 'small');
  await page.mouse.move(w.x - 20, w.y - 40);
  await page.mouse.move(w.x, w.y, { steps: 4 });
  const chip = page.getByRole('toolbar', { name: /^Sky highlight:/ });
  await chip.getByRole('button', { name: 'Add note' }).click();
  await expect(notebook(page)).toBeVisible();
  await expect.poll(() => api.notePosts.length).toBe(1);
  const [post] = api.notePosts;
  const highlight = api.annotations[0];
  expect(post).toMatchObject({ kind: 'drawing', scope: 'selection', annotation_id: highlight.id, anchors: highlight.anchors,
    position_start: highlight.position_start, position_end: highlight.position_end });
  await expect.poll(() => written(api).join(' '), { timeout: 8000 }).toMatch(/lamp[\s\S]*circle/);
});

test('a Steve answer is written on a notebook page with its sources, Steve beside it', async ({ page, api }) => {
  api.steve.consented = true;
  await openReader(page);
  await page.getByRole('button', { name: 'Ask Steve' }).click();
  const steve = page.getByRole('complementary', { name: 'Steve' });
  await steve.getByRole('textbox', { name: 'Your question for Steve' }).fill('Why twice?');
  await page.keyboard.press('Enter');
  await expect(steve.getByRole('button', { name: 'Save to notes' })).toBeVisible();
  await steve.getByRole('button', { name: 'Save to notes' }).click();
  await expect.poll(() => api.notePosts.length).toBe(1);
  expect(api.notePosts[0].kind).toBe('drawing');
  await expect(notebook(page)).toBeVisible();
  await expect(steve).toBeVisible(); // over the book's 30 %
  await expect.poll(() => written(api), { timeout: 8000 }).toContain('He counts twice [p. 2].');
  expect(written(api)).toContain('Sources: p. 2');
  await expect(steve.getByRole('button', { name: 'Saved to notes' })).toBeDisabled();
  if (shots) { await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/notebook-steve-answer-1440.png` }); }
});
