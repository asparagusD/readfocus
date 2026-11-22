// C21.3: highlights and underlines drawn in the original view. PDF: boxes from the anchor's quads over the page,
// between the canvas and the text layer, blended so ink keeps its colour, scaled with zoom. EPUB: the CSS Custom
// Highlight API inside each section's document (no DOM changed), so a new text size or window re-lays the words
// and the highlight with them; the word-lookup mark is painted over it.
import { book, expect, openReader, test, wordPoint } from './fixtures';

const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });
// A new PDF annotation is drawn at once as `pending-N` and drawn again under its saved id when the save returns
// (useAnnotations); a box read in between can be the detached pending one (all zeros). Measure the saved one.
const saved = (page) => page.locator('.rf-pdf-page[data-page="1"] .rf-anno:not([data-id^="pending-"])');

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
    await expect(saved(page)).toHaveCount(1);
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
    await expect(saved(page)).toHaveCount(1);
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

/** "#aabbcc" as getComputedStyle writes it. */
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test.describe('pdf in lamplight', () => {
  test.use({ colorScheme: 'dark' });

  // C38.3 (issue 22, D2): a book is never recoloured: a white page on the dark desk, as Edge's dark mode shows it.
  test('the page is drawn as published and highlights darken it in Paper\'s colours; no Original colours switch', async ({ page }) => {
    await openReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'lamplight');
    await expect(page.getByRole('switch', { name: /original colours/i })).toHaveCount(0);
    const corner = await page.locator('.rf-pdf-page[data-page="1"] canvas').evaluate((c) => [...c.getContext('2d').getImageData(4, 4, 1, 1).data]);
    expect(corner).toEqual([255, 255, 255, 255]); // the publisher's white page
    const desk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper-2').trim());
    expect(await page.locator('.rf-ov-book').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(desk));
    await highlight(page, 'lamp', 'circle', 'Honey highlight');
    const anno = saved(page);
    await expect(anno).toHaveCount(1);
    await expect(anno).toBeVisible();
    expect(await anno.evaluate((el) => getComputedStyle(el).mixBlendMode)).toBe('darken');
    const fill = await anno.evaluate((el) => getComputedStyle(el).backgroundColor);
    const paper = await anno.evaluate((el) => getComputedStyle(el.parentElement).getPropertyValue('--hl-honey').trim());
    const lamp = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hl-honey').trim());
    expect(fill).toBe(rgb(paper));
    expect(paper).not.toBe(lamp); // Paper's honey, not Lamplight's
  });
});

test.describe('epub in lamplight', () => {
  test.use({ book: 'epub', colorScheme: 'dark' });

  test('the page is the publisher\'s white and its text keeps the publisher\'s colours', async ({ page }) => {
    await openReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'lamplight');
    expect(await page.locator('.rf-epub').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)'); // C38.7a: the column
    const frame = page.frames().find((f) => f !== page.mainFrame() && !f.isDetached());
    const ink = await frame.evaluate(() => getComputedStyle(document.querySelector('p')).color);
    const [r, g, b] = ink.match(/\d+/g).map(Number);
    expect(r + g + b).toBeLessThan(200); // dark text, as published, not Lamplight's light ink
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
