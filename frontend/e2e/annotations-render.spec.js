// C21.3: highlights and underlines drawn in the original view. PDF: boxes from the anchor's quads over the page,
// between the canvas and the text layer, blended so ink keeps its colour, scaled with zoom. EPUB: the CSS Custom
// Highlight API inside each section's document (no DOM changed), so a new text size or window re-lays the words
// and the highlight with them; the word-lookup mark is painted over it.
import { book, expect, openReader, test, wordPoint } from './fixtures';

const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });

async function highlight(page, from, to, button) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  await toolbar(page).getByRole('button', { name: button }).click();
  await page.mouse.move(5, 5);
}

/** The drawn PDF boxes, in page coordinates. */
const pdfBoxes = (page) => page.locator('.rf-anno').evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, style: el.dataset.style, color: el.dataset.colour };
}));
const covers = (boxes, { x, y }) => boxes.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);

test.describe('pdf', () => {
  test('a highlight is drawn on its words, stays on them at another zoom, and comes back after a reload', async ({ page, api }) => {
    await openReader(page);
    await highlight(page, 'lamp', 'circle', 'Sky highlight');
    await expect(page.locator('.rf-pdf-page[data-page="1"] .rf-anno')).toHaveCount(1);
    for (const word of ['lamp', 'small', 'circle']) expect(covers(await pdfBoxes(page), await wordPoint(page, word)), word).toBe(true);
    expect(covers(await pdfBoxes(page), await wordPoint(page, 'light')), 'not past the selection').toBe(false);
    const layer = page.locator('.rf-pdf-annos').first();
    expect(await layer.evaluate((el) => getComputedStyle(el.firstElementChild).mixBlendMode)).toBe('darken'); // Paper: ink stays ink

    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    await zoomIn.click();
    await zoomIn.click();
    await page.waitForTimeout(600);
    for (const word of ['lamp', 'circle']) expect(covers(await pdfBoxes(page), await wordPoint(page, word)), `${word} zoomed`).toBe(true);

    await expect.poll(() => api.annotations.length).toBe(1);
    await page.reload();
    await openReader(page);
    await expect(page.locator('.rf-anno')).toHaveCount(1);
    expect(covers(await pdfBoxes(page), await wordPoint(page, 'lamp'))).toBe(true);
  });

  test('an underline is a 2 px line under the words, and annotations off the shown pages are not drawn', async ({ page }) => {
    await openReader(page);
    await highlight(page, 'lamp', 'threw', 'Underline');
    await toolbar(page).getByRole('button', { name: 'Lilac underline' }).click();
    const lamp = await wordPoint(page, 'lamp');
    const [line] = await pdfBoxes(page);
    expect(line).toMatchObject({ style: 'underline', color: 'lilac' });
    expect(line.bottom - line.top).toBeCloseTo(2, 0);
    expect(line.top).toBeGreaterThanOrEqual(lamp.bottom - 2);
    await book(page).focus();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900);
    await expect(page.locator('.rf-anno')).toHaveCount(0);
  });
});

test.describe('pdf in lamplight', () => {
  test.use({ colorScheme: 'dark' });

  test('highlights lighten the recoloured page so the light text keeps its colour', async ({ page }) => {
    await openReader(page);
    await highlight(page, 'lamp', 'circle', 'Honey highlight');
    const anno = page.locator('.rf-anno').first();
    await expect(anno).toBeVisible();
    expect(await anno.evaluate((el) => getComputedStyle(el).mixBlendMode)).toBe('lighten');
    const fill = await anno.evaluate((el) => getComputedStyle(el).backgroundColor);
    const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hl-honey').trim());
    expect(fill).toBe(`rgb(${[1, 3, 5].map((i) => parseInt(token.slice(i, i + 2), 16)).join(', ')})`);
  });
});

/** In each EPUB section's document: our highlights' names, priorities and the text of their ranges. */
const sectionMarks = async (page) => {
  const out = [];
  for (const frame of page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())) {
    out.push(...await frame.evaluate(() => [...(window.CSS?.highlights?.entries() ?? [])].map(([name, h]) => ({
      name, priority: h.priority, texts: [...h].map((r) => r.toString()),
    }))).catch(() => []));
  }
  return out;
};

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('a highlight follows its words through a text-size change, a resize and a reload', async ({ page, api }) => {
    await openReader(page);
    await highlight(page, 'lamp', 'circle', 'Rose highlight');
    const mine = async () => (await sectionMarks(page)).filter((m) => m.name.startsWith('rf-highlight-'));
    await expect.poll(async () => (await mine()).map((m) => [m.name, m.texts])).toEqual([['rf-highlight-rose', ['lamp on the desk threw a small circle']]]);

    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.waitForTimeout(900);
    expect((await mine()).flatMap((m) => m.texts)).toEqual(['lamp on the desk threw a small circle']);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(900);
    expect((await mine()).flatMap((m) => m.texts)).toEqual(['lamp on the desk threw a small circle']);

    await expect.poll(() => api.annotations.length).toBe(1);
    await page.reload();
    await openReader(page);
    await expect.poll(async () => (await mine()).flatMap((m) => m.texts)).toEqual(['lamp on the desk threw a small circle']);
  });

  test('the word-lookup mark is painted over a highlight', async ({ page }) => {
    await openReader(page);
    await highlight(page, 'lamp', 'circle', 'Honey highlight');
    const lamp = await wordPoint(page, 'lamp');
    await page.mouse.move(lamp.x, lamp.y);
    await expect(page.locator('.rf-wordcard')).toBeVisible();
    const marks = await sectionMarks(page);
    const lookup = marks.find((m) => m.name === 'rf-lookup');
    const ours = marks.find((m) => m.name === 'rf-highlight-honey');
    expect(lookup && ours).toBeTruthy();
    expect(lookup.priority).toBeGreaterThan(ours.priority);
  });
});
