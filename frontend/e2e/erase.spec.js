// C39.5 (issue 23): Edge's eraser on a PDF page. A drag takes away whole strokes and highlights it passes over, at
// once; one toast says what it took and one Undo brings them all back; a pen's eraser end erases while Draw is on;
// Erase has no menu; an EPUB has no Erase (its highlights go from their chip). Every call is mocked (fixtures.js).
import { expect, openReader, test, wordPoint } from './fixtures';

const markup = (page) => page.getByRole('group', { name: 'Markup' });
const tool = (page, name) => markup(page).getByRole('button', { name, exact: true });
const pageBox = (page) => page.locator('.rf-pdf-page[data-page="1"]').boundingBox();
const strokes = (page) => page.locator('.rf-pdf-page[data-page="1"] .rf-ink path[data-id^="mark-"]');
const boxes = (page) => page.locator('.rf-pdf-page[data-page="1"] .rf-anno:not([data-id^="pending-"])');

/** A drag across page 1 between two points given as fractions of the page. */
async function drag(page, [x0, y0], [x1, y1]) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 16 });
  await page.mouse.up();
}

/** A stroke and a highlight on page 1, saved. */
async function markUp(page, api) {
  await tool(page, 'Draw').click();
  await drag(page, [0.2, 0.6], [0.6, 0.6]);
  await expect.poll(() => api.marks.length).toBe(1);
  await tool(page, 'Highlight').click();
  const a = await wordPoint(page, 'lamp');
  const b = await wordPoint(page, 'circle');
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => api.annotations.length).toBe(1);
  await expect(strokes(page)).toHaveCount(1);
  await expect(boxes(page)).not.toHaveCount(0);
}

test('each drag erases what it passes over at once and says so; Undo brings back what it took', async ({ page, api }) => {
  await openReader(page);
  await markUp(page, api);
  await tool(page, 'Erase').click();
  await expect(tool(page, 'Erase')).toHaveAttribute('aria-pressed', 'true');
  await expect(markup(page).getByRole('button', { name: /Erase options|Erase colour/ })).toHaveCount(0); // no menu
  await expect(page.locator('.rf-pdf-page[data-page="1"] .rf-ink')).toHaveAttribute('data-erasing', 'true');

  const lamp = await wordPoint(page, 'lamp');
  await drag(page, [0.4, 0.75], [0.4, 0.5]); // up across the stroke
  await expect(strokes(page)).toHaveCount(0);
  await expect(page.getByText('Erased a drawing.')).toBeVisible();
  await page.mouse.move(lamp.x, lamp.y + 30);
  await page.mouse.down();
  await page.mouse.move(lamp.x, lamp.y - 10, { steps: 6 }); // and across the highlight's first line
  await page.mouse.up();
  await expect(boxes(page)).toHaveCount(0);
  await expect.poll(() => api.markDeletes.length).toBe(1);
  await expect.poll(() => api.annotationDeletes.length).toBe(1);
  await expect(page.getByText('Erased a highlight.')).toBeVisible(); // each drag its own toast
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect.poll(() => api.annotations.length).toBe(1);
  await expect(boxes(page)).not.toHaveCount(0);
});

test('a single drag over both says so in one toast, and its Undo restores both', async ({ page, api }) => {
  await openReader(page);
  await markUp(page, api);
  await tool(page, 'Erase').click();
  const lamp = await wordPoint(page, 'lamp');
  const box = await pageBox(page);
  await page.mouse.move(lamp.x, lamp.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6, { steps: 30 }); // the highlight, then the stroke
  await page.mouse.up();
  await expect(page.getByText('Erased a drawing and a highlight.')).toBeVisible();
  expect(api.markDeletes).toHaveLength(1);
  expect(api.annotationDeletes).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(strokes(page)).toHaveCount(1);
  await expect.poll(() => [api.marks.length, api.annotations.length]).toEqual([1, 1]);
  expect(api.markPosts.at(-1)).toMatchObject({ kind: 'ink', page: 1, color: 'ink' });

  await page.keyboard.press('Escape'); // off: the words take the pointer again
  await expect(tool(page, 'Erase')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.rf-pdf-page[data-page="1"] .rf-ink')).not.toHaveAttribute('data-drawing', 'true');
});

test("a pen's eraser end erases while Draw is on, and draws nothing", async ({ page, api }) => {
  await openReader(page);
  await tool(page, 'Draw').click();
  await drag(page, [0.2, 0.6], [0.6, 0.6]);
  await expect(strokes(page)).toHaveCount(1);
  await page.locator('.rf-pdf-page[data-page="1"] .rf-ink').evaluate((svg) => {
    const r = svg.getBoundingClientRect();
    const at = (y, buttons) => ({ pointerId: 9, pointerType: 'pen', pressure: 0.5, isPrimary: true, bubbles: true, button: 5,
      buttons, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * y });
    svg.dispatchEvent(new PointerEvent('pointerdown', at(0.7, 32)));
    for (const y of [0.66, 0.62, 0.58, 0.54]) svg.dispatchEvent(new PointerEvent('pointermove', at(y, 32)));
    svg.dispatchEvent(new PointerEvent('pointerup', at(0.5, 0)));
  });
  await expect(strokes(page)).toHaveCount(0);
  await expect.poll(() => api.markDeletes.length).toBe(1);
  expect(api.markPosts).toHaveLength(1); // the eraser drew nothing
  await expect(tool(page, 'Draw')).toHaveAttribute('aria-pressed', 'true');
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('an EPUB has no Erase', async ({ page }) => {
    await openReader(page);
    await expect(tool(page, 'Highlight')).toBeVisible();
    await expect(tool(page, 'Erase')).toHaveCount(0);
  });
});
