// C21 end to end: highlights in a PDF and an EPUB that survive a reload, a resize, zoom and a new text size; the
// Annotations tab in the contents drawer (reading order, colour, snippet, page, a colour filter, a jump to the
// passage); with word lookup off the chip's Ask Steve opens the panel (Steve mocked), with it on the word card;
// delete. Every call is mocked (fixtures.js).
import { book, expect, openReader, shown, test, wordPoint } from './fixtures';

const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });
const chip = (page) => page.getByRole('toolbar', { name: /^(Honey|Sage|Sky|Rose|Lilac) (highlight|underline):/ });
const lookupSwitch = (page) => page.getByRole('switch', { name: 'Look up words on hover' });
const drawer = (page) => page.getByRole('dialog', { name: 'Contents' });
const items = (page) => drawer(page).getByRole('tabpanel', { name: 'Annotations' }).getByRole('listitem');

async function highlight(page, from, to, button) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  await toolbar(page).getByRole('button', { name: button, exact: true }).click();
  await page.mouse.move(5, 5);
}

async function openList(page) {
  await page.getByRole('button', { name: 'Contents' }).click();
  await drawer(page).getByRole('tab', { name: /^Annotations/ }).click();
}

/** The drawn PDF boxes cover the word's centre. */
const pdfCovers = async (page, word) => {
  const { x, y } = await wordPoint(page, word);
  return page.locator('.rf-anno').evaluateAll((els, p) => els.some((el) => {
    const r = el.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  }), { x, y });
};

/** The texts of the EPUB highlights painted in the shown sections. */
const epubMarks = async (page) => {
  const out = [];
  for (const frame of page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())) {
    out.push(...await frame.evaluate(() => [...(window.CSS?.highlights?.entries() ?? [])]
      .filter(([name]) => name.startsWith('rf-highlight-') || name.startsWith('rf-underline-'))
      .flatMap(([, h]) => [...h].map((r) => r.toString()))).catch(() => []));
  }
  return out;
};

test.describe('pdf', () => {
  test('highlights survive zoom, a resize and a reload; the list orders, filters and jumps; the chip and delete work', async ({ page, api }) => {
    api.steve.consented = true;
    await openReader(page);
    await highlight(page, 'lamp', 'circle', 'Sky highlight');
    await book(page).focus();
    await page.keyboard.press('ArrowRight'); // pages 2-3
    await page.waitForTimeout(900);
    await highlight(page, 'threw', 'small', 'Honey highlight');
    await expect.poll(() => api.annotations.length).toBe(2);

    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    await zoomIn.click();
    await page.waitForTimeout(600);
    expect(await pdfCovers(page, 'small')).toBe(true);
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.waitForTimeout(600);
    expect(await pdfCovers(page, 'threw')).toBe(true);
    await page.reload();
    await openReader(page);
    await expect(page.locator('.rf-anno')).toHaveCount(1); // page 1's highlight, back from the server

    await openList(page);
    await expect(items(page)).toHaveCount(2);
    await expect(items(page).nth(0)).toContainText('lamp threw a small circle');
    await expect(items(page).nth(1)).toContainText('threw a small');
    await expect(items(page).nth(0)).toContainText(/p\. \S+/);
    await drawer(page).getByRole('radio', { name: 'Honey' }).click();
    await expect(items(page)).toHaveCount(1);
    await items(page).getByRole('button').click(); // jump to page 2
    await expect(drawer(page)).toHaveCount(0);
    await expect.poll(async () => (await shown(page)).start).toBe('2');
    await expect(page.locator('.rf-anno')).toHaveCount(1);

    await lookupSwitch(page).click(); // lookup off: the chip
    const small = await wordPoint(page, 'small');
    await page.mouse.move(small.x, small.y - 40);
    await page.mouse.move(small.x, small.y, { steps: 4 });
    await chip(page).getByRole('button', { name: 'Ask Steve' }).click();
    await expect(page.getByRole('complementary', { name: /Steve/ })).toBeVisible();
    await expect.poll(() => api.steve.asks.length).toBe(1);
    expect(api.steve.asks[0]).toMatchObject({ mode: 'explain_highlight', anchor: { kind: 'pdf', page: 2 } });
    await page.getByRole('button', { name: 'Close Steve' }).click();

    await page.mouse.move(5, 5);
    await page.mouse.move(small.x, small.y, { steps: 4 });
    await chip(page).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.rf-anno')).toHaveCount(0);
    await expect.poll(() => api.annotations.length).toBe(1);
    await openList(page);
    await expect(drawer(page).getByRole('tabpanel', { name: 'Annotations' })).toContainText('No honey highlights'); // the filter is kept
    await drawer(page).getByRole('radio', { name: 'All' }).click();
    await expect(items(page)).toHaveCount(1);
  });

  test('with lookup on, a highlighted word still opens the word card', async ({ page }) => {
    await openReader(page);
    await highlight(page, 'lamp', 'circle', 'Rose highlight');
    await page.waitForTimeout(300);
    const small = await wordPoint(page, 'small');
    await page.mouse.move(small.x, small.y - 40);
    await page.mouse.move(small.x, small.y, { steps: 4 });
    await expect(page.locator('.rf-wordcard')).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  });
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('a highlight survives a text-size change, a resize and a reload; the list jumps back to it; delete', async ({ page, api }) => {
    await openReader(page);
    await highlight(page, 'lamp', 'circle', 'Lilac highlight');
    await expect.poll(() => api.annotations.length).toBe(1);
    const text = 'lamp on the desk threw a small circle';
    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.waitForTimeout(900);
    expect(await epubMarks(page)).toEqual([text]);
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.waitForTimeout(900);
    expect(await epubMarks(page)).toEqual([text]);
    await page.reload();
    await openReader(page);
    await expect.poll(() => epubMarks(page)).toEqual([text]);

    await book(page).focus();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900);
    const away = await shown(page);
    await openList(page);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText(text);
    await items(page).getByRole('button').click();
    await expect.poll(async () => (await shown(page)).start).not.toBe(away.start);
    await expect.poll(() => epubMarks(page)).toEqual([text]);

    await lookupSwitch(page).click();
    const small = await wordPoint(page, 'small');
    await page.mouse.move(small.x, small.y - 40);
    await page.mouse.move(small.x, small.y, { steps: 4 });
    await chip(page).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => epubMarks(page)).toEqual([]);
    await expect.poll(() => api.annotationDeletes).toEqual(['ann-1']);
  });
});

test('the Annotations tab says when there are none, or none in a colour', async ({ page }) => {
  await openReader(page);
  await openList(page);
  await expect(drawer(page).getByRole('tabpanel', { name: 'Annotations' })).toContainText('No highlights yet');
  await page.keyboard.press('Escape');
  await highlight(page, 'lamp', 'circle', 'Sky highlight');
  await openList(page);
  await drawer(page).getByRole('radio', { name: 'Sage' }).click();
  await expect(drawer(page).getByRole('tabpanel', { name: 'Annotations' })).toContainText('No sage highlights');
  await drawer(page).getByRole('radio', { name: 'All' }).click();
  await expect(items(page)).toHaveCount(1);
});
