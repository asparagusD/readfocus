// C22.6: things from the book go to the notes. "Add to notes" on a PDF equation (the crop as an image in the notes
// bucket and its LaTeX, from /steve/latex only while Steve is on), code (the exact text and its language, no
// Steve call) and a figure (the crop and its caption); on an EPUB equation (LaTeX from its TeX annotation, on the
// device) and listing; a highlight's chip (a text note quoting the passage, linked to it); a Steve answer ("Save
// to notes", its citations kept); and dragging an equation onto the notepad. Mocked API (fixtures.js).
import { test, expect, BOOKS, book, openReader, settled, wordPoint } from './fixtures.js';

const EQ = { id: 'r-eq', page: 1, kind: 'math', bbox: [72, 110, 300, 140], inline: false };
const CODE = { id: 'r-code', page: 1, kind: 'code', bbox: [72, 160, 300, 200], inline: false };
const FIG = { id: 'r-fig', page: 1, kind: 'figure', bbox: [72, 220, 300, 300], inline: false };
const CODE_TEXT = 'def toll(n):\n    return  2 * n   # two spaces kept';
const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const bar = (page, name) => page.getByRole('toolbar', { name });
const PNG = /^iVBOR/;

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

  test('an equation goes to the notes as its crop, then its LaTeX', async ({ page, api }) => {
    await openReader(page);
    await hover(page, EQ);
    await bar(page, 'Equation, page 1').getByRole('button', { name: 'Add to notes' }).click();
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => api.notePosts.length).toBe(1);
    expect(api.noteFilePosts).toHaveLength(1);
    expect(api.noteFilePosts[0]).toMatchObject({ content_type: 'image/png', data: expect.stringMatching(PNG) });
    expect(api.noteFilePosts[0].data.length * 0.75).toBeLessThan(256 * 1024);
    const [post] = api.notePosts;
    expect(post).toMatchObject({ kind: 'equation', region_id: 'r-eq', scope: 'selection',
      anchors: [{ kind: 'pdf', page: 1, quads: [EQ.bbox], text: 'a n = 1 / pi' }],
      content: { latex: '', image_path: expect.stringMatching(/\.png$/) } });
    await expect.poll(() => api.steve.latexAsks.length).toBe(1);
    await expect.poll(() => api.notes[0]?.content?.latex).toBe('a_n = \\frac{1}{\\pi}');
    const card = panel(page).locator('.rf-note[data-kind="equation"]');
    await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/png/);
    await expect(card.locator('math')).toBeAttached();
    await expect(card.getByRole('textbox', { name: 'LaTeX' })).toHaveValue('a_n = \\frac{1}{\\pi}');
    // The LaTeX can be edited; the change autosaves.
    await card.getByRole('textbox', { name: 'LaTeX' }).fill('a_n = 2');
    await expect.poll(() => api.notes[0].content.latex, { timeout: 4000 }).toBe('a_n = 2');
  });

  test('code goes as its exact text and language, with no Steve call', async ({ page, api }) => {
    await openReader(page);
    await hover(page, CODE);
    await bar(page, 'Code, page 1').getByRole('button', { name: 'Add to notes' }).click();
    await expect.poll(() => api.notePosts.length).toBe(1);
    expect(api.notePosts[0]).toMatchObject({ kind: 'code', region_id: 'r-code', content: { code: CODE_TEXT, language: 'python' } });
    expect(api.noteFilePosts).toHaveLength(0);
    expect(api.steve.asks).toHaveLength(0);
    const card = panel(page).locator('.rf-note[data-kind="code"]');
    await expect(card.getByRole('textbox', { name: 'Code' })).toHaveValue(CODE_TEXT);
    await expect(card).toContainText('python');
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

  test('dragging an equation onto the notepad adds it', async ({ page, api }) => {
    await openReader(page);
    await page.getByRole('button', { name: /^Notes/ }).click();
    await hover(page, EQ);
    const grip = bar(page, 'Equation, page 1').getByRole('button', { name: 'Drag to notes' });
    await expect(grip).toHaveAttribute('draggable', 'true');
    await grip.dragTo(panel(page).locator('.rf-notes'));
    await expect.poll(() => api.notePosts.length).toBe(1);
    expect(api.notePosts[0]).toMatchObject({ kind: 'equation', region_id: 'r-eq' });
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

  // Adding a note opens the notepad, which narrows the book (1440 to 1060 px wide) and re-lays its sections out;
  // `settled` watches the page shown, not where a block sits, so wait for the block's own box to stop moving.
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
    expect(eq.kind).toBe('equation');
    expect(eq.content.latex.length).toBeGreaterThan(0);
    expect(eq.content.image_path ?? null).toBeNull();
    expect(eq.anchors[0].kind).toBe('epub');
    expect(api.steve.latexAsks).toHaveLength(0);

    const pre = await find(page, 'pre');
    const pbox = await still(pre);
    await page.mouse.move(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2, { steps: 4 });
    await page.getByRole('toolbar', { name: 'Code, this page' }).getByRole('button', { name: 'Add to notes' }).click();
    await expect.poll(() => api.notePosts.length).toBe(2);
    expect(api.notePosts[1].kind).toBe('code');
    const code = await pre.textContent();
    expect(api.notePosts[1].content.code).toBe(code);
    // Its own characters (A4), not its parent's start: what sync compares with the page shown.
    const { position_start: start, position_end: end } = api.notePosts[1];
    expect(end - start).toBe(code.length);
    expect(start % 1e6).toBeGreaterThan(0);
  });
});

test('a highlight\'s Add note writes a text note quoting it, linked to the highlight', async ({ page, api }) => {
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
  await expect(panel(page).getByRole('textbox', { name: /^Note at / })).toBeFocused();
  await expect.poll(() => api.notePosts.length).toBe(1);
  const [post] = api.notePosts;
  const highlight = api.annotations[0];
  expect(post).toMatchObject({ kind: 'text', scope: 'selection', annotation_id: highlight.id, anchors: highlight.anchors,
    position_start: highlight.position_start, position_end: highlight.position_end });
  expect(post.content.content[0]).toMatchObject({ type: 'blockquote' });
  expect(JSON.stringify(post.content)).toMatch(/lamp .*circle/);
  await page.keyboard.type('Why a circle?');
  await expect.poll(() => JSON.stringify(api.notes[0].content), { timeout: 4000 }).toContain('Why a circle?');
});

test('a Steve answer is saved to the notes with its citations', async ({ page, api }) => {
  api.steve.consented = true;
  await openReader(page);
  await page.getByRole('button', { name: 'Ask Steve' }).click();
  const steve = page.getByRole('complementary', { name: 'Steve' });
  await steve.getByRole('textbox', { name: 'Your question for Steve' }).fill('Why twice?');
  await page.keyboard.press('Enter');
  await expect(steve.getByRole('button', { name: 'Save to notes' })).toBeVisible();
  await steve.getByRole('button', { name: 'Save to notes' }).click();
  await expect.poll(() => api.notePosts.length).toBe(1);
  const text = JSON.stringify(api.notePosts[0].content);
  expect(api.notePosts[0].kind).toBe('text');
  expect(text).toContain('He counts twice [p. 2].');
  expect(text).toContain('Sources: p. 2');
  await expect(steve.getByRole('button', { name: 'Saved to notes' })).toBeDisabled();
  await page.getByRole('tab', { name: /^Notes/ }).click();
  await expect(panel(page).locator('.rf-note')).toContainText('He counts twice [p. 2].');
});
