// C39.4 (issue 23): Edge's Draw on a PDF page. The stroke is drawn as the pointer moves, saved on the lift in PDF
// points (kind ink, its page, colour and width), and drawn again from the server after a reload and at another zoom;
// Draw's menu picks an ink colour and a thickness; a pen's pressure is kept, a finger draws; an EPUB has no Draw (D2);
// a stroke the server refuses is taken back. Every call is mocked (fixtures.js).
import { expect, openReader, test } from './fixtures';

const markup = (page) => page.getByRole('group', { name: 'Markup' });
const drawTool = (page) => markup(page).getByRole('button', { name: 'Draw', exact: true });
const ink = (page, n = 1) => page.locator(`.rf-pdf-page[data-page="${n}"] .rf-ink`);
const saved = (page, n = 1) => ink(page, n).locator('path[data-id^="mark-"]');

/** A drag across page 1 from (x0, y0) to (x1, y1), in fractions of the page, by mouse. */
async function scribble(page, [x0, y0, x1, y1] = [0.2, 0.3, 0.6, 0.35]) {
  const box = await page.locator('.rf-pdf-page[data-page="1"]').boundingBox();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 12 });
  await page.mouse.up();
}

test('a stroke is drawn, saved in page points, and back after a reload and a zoom', async ({ page, api }) => {
  await openReader(page);
  await drawTool(page).click();
  await expect(drawTool(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(markup(page).getByRole('status')).toHaveText(/^Drawing on, Ink, 2 points\./);
  await scribble(page);
  await expect.poll(() => api.markPosts.length).toBe(1);
  const [body] = api.markPosts;
  expect(body).toMatchObject({ kind: 'ink', page: 1, color: 'ink', data: { width: 2 } });
  expect(body.data.points.length).toBeGreaterThan(4);
  const scale = Number(await page.locator('.rf-pdf-page[data-page="1"]').getAttribute('data-scale'));
  const box = await page.locator('.rf-pdf-page[data-page="1"]').boundingBox();
  const [x, y, pressure] = body.data.points[0];
  expect(Math.abs(x - (box.width * 0.2) / scale)).toBeLessThan(1.5); // points, not pixels
  expect(Math.abs(y - (box.height * 0.3) / scale)).toBeLessThan(1.5);
  expect(pressure).toBe(0.5); // a mouse
  await expect(saved(page)).toHaveCount(1);
  await expect(page.getByRole('toolbar', { name: 'Highlight the selection' })).toHaveCount(0); // no text selected

  await page.reload();
  await openReader(page);
  await expect(saved(page)).toHaveCount(1);
  expect(api.markLoads[0]).toBe('1-20');
  const before = await saved(page).boundingBox();
  const level = page.getByRole('textbox', { name: /^Zoom, / }); // C41.1: Zoom in is one of Edge's small steps now
  await level.fill('200');
  await level.press('Enter');
  await expect.poll(async () => (await saved(page).boundingBox()).width).toBeGreaterThan(before.width * 1.1);
  const after = Number(await page.locator('.rf-pdf-page[data-page="1"]').getAttribute('data-scale'));
  const width = (await saved(page).boundingBox()).width;
  expect(Math.abs(width / before.width - after / scale)).toBeLessThan(0.05); // the same stroke, rescaled
});

test("Draw's menu picks an ink colour and a thickness and keeps open; Escape stops drawing", async ({ page, api }) => {
  await openReader(page);
  await markup(page).getByRole('button', { name: 'Draw options' }).click();
  const colours = page.getByRole('radiogroup', { name: 'Draw colour' });
  await expect(colours.getByRole('radio')).toHaveCount(7);
  await expect(colours.getByRole('radio', { name: 'Ink' })).toBeFocused();
  await colours.getByRole('radio', { name: 'Ocean' }).click();
  await expect(drawTool(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(colours).toBeVisible(); // Draw's menu stays open for the thickness
  const thickness = page.getByRole('slider', { name: 'Thickness' });
  await thickness.focus();
  await page.keyboard.press('ArrowRight');
  await expect(thickness).toHaveAttribute('aria-valuetext', '3 points');
  await page.keyboard.press('Escape'); // the menu closes; Draw stays on
  await expect(colours).toHaveCount(0);
  await expect(drawTool(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(markup(page).locator('.rf-markup-swatch[data-mark-colour="ocean"]')).toHaveCount(1);
  await scribble(page);
  await expect.poll(() => api.markPosts.map((m) => [m.color, m.data.width])).toEqual([['ocean', 3]]);

  await page.keyboard.press('Escape');
  await expect(drawTool(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await ink(page).getAttribute('data-drawing')).toBeNull(); // the words take the pointer again
  await page.reload();
  await openReader(page);
  await markup(page).getByRole('button', { name: 'Draw options' }).click(); // kept on this device
  await expect(page.getByRole('radio', { name: 'Ocean' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Thickness' })).toHaveAttribute('aria-valuetext', '3 points');
});

test("a pen's pressure is kept; a finger draws; a refused stroke is taken back", async ({ page, api }) => {
  await openReader(page);
  await drawTool(page).click();
  await expect(ink(page)).toHaveAttribute('data-drawing', 'true');
  const stroke = (pointerType, pressure) => ink(page).evaluate((svg, [type, p]) => {
    const r = svg.getBoundingClientRect();
    const at = (f) => ({ pointerId: 7, pointerType: type, pressure: p, isPrimary: true, bubbles: true, button: 0, buttons: 1,
      clientX: r.left + r.width * f, clientY: r.top + r.height * 0.5 });
    svg.dispatchEvent(new PointerEvent('pointerdown', at(0.2)));
    for (const f of [0.25, 0.3, 0.35, 0.4]) svg.dispatchEvent(new PointerEvent('pointermove', at(f)));
    svg.dispatchEvent(new PointerEvent('pointerup', { ...at(0.4), buttons: 0, pressure: 0 }));
  }, [pointerType, pressure]);
  await stroke('pen', 0.9);
  await expect.poll(() => api.markPosts.length).toBe(1);
  expect(api.markPosts[0].data.points.every(([, , p]) => p === 0.9)).toBe(true);
  await stroke('touch', 1);
  await expect.poll(() => api.markPosts.length).toBe(2);
  expect(api.markPosts[1].data.points[0][2]).toBe(0.5); // a finger draws an even line

  api.markFail = 500;
  await stroke('mouse', 0.5);
  await expect(page.getByText("That drawing wasn't saved. Try again.")).toBeVisible();
  await expect(saved(page)).toHaveCount(2);
  await expect(ink(page).locator('path[data-id^="pending-"]')).toHaveCount(0);
});

test('by touch two fingers scroll the book and draw nothing', async ({ page, api }) => {
  await openReader(page);
  await drawTool(page).click();
  const before = await page.locator('.rf-pdf-book').evaluate((el) => el.scrollTop);
  await ink(page).evaluate((svg) => {
    const r = svg.getBoundingClientRect();
    const at = (id, x, y) => ({ pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, button: 0, buttons: 1,
      pressure: 1, clientX: r.left + x, clientY: r.top + y });
    svg.dispatchEvent(new PointerEvent('pointerdown', at(1, 100, 300)));
    svg.dispatchEvent(new PointerEvent('pointermove', at(1, 100, 290)));
    svg.dispatchEvent(new PointerEvent('pointerdown', at(2, 200, 300))); // the second finger: a scroll, not a stroke
    for (let dy = 20; dy <= 100; dy += 20) {
      svg.dispatchEvent(new PointerEvent('pointermove', at(1, 100, 290 - dy)));
      svg.dispatchEvent(new PointerEvent('pointermove', at(2, 200, 300 - dy)));
    }
    svg.dispatchEvent(new PointerEvent('pointerup', { ...at(1, 100, 190), buttons: 0 }));
    svg.dispatchEvent(new PointerEvent('pointerup', { ...at(2, 200, 200), buttons: 0 }));
  });
  await expect.poll(() => page.locator('.rf-pdf-book').evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 80);
  await page.waitForTimeout(300);
  expect(api.markPosts).toEqual([]);
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('an EPUB has no Draw (D2): the highlighter alone', async ({ page, api }) => {
    await openReader(page);
    await expect(markup(page).getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
    await expect(drawTool(page)).toHaveCount(0);
    expect(api.markLoads).toEqual([]); // and nothing asked of the server
  });
});
