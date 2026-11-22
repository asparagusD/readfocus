// Steve in Copilot's place (C40.6, issue 24): Explain and Summarize a selection from the selection toolbar and the
// right-click menu, and "Summarize this page" from Steve's panel, for a PDF and an EPUB. Every /steve call is mocked
// (fixtures.js): what was asked is read back from api.steve.asks.
import { test, expect, openReader, clickTool, wordPoint } from './fixtures.js';

const panel = (page) => page.getByRole('complementary', { name: 'Steve' });

async function select(page, from, to) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  return a;
}

test.describe('a PDF', () => {
  test.use({ book: 'pdf' });

  test('Summarize with Steve, from the selection toolbar and the right-click menu, asks for a summary of it', async ({ page, api }) => {
    api.steve.consented = true;
    await openReader(page);
    await select(page, 'lamp', 'circle');
    await page.getByRole('toolbar', { name: 'Highlight the selection' }).getByRole('button', { name: 'Summarize with Steve' }).click();
    await expect.poll(() => api.steve.asks.length).toBe(1);
    expect(api.steve.asks[0]).toMatchObject({ mode: 'summarize_selection', question: 'Summarize this passage.',
      anchor: { kind: 'pdf', page: 1, text: expect.stringMatching(/^lamp .*circle$/) } });
    expect(api.steve.asks[0].page_text).toBeUndefined();
    await expect(panel(page)).toBeVisible();

    const a = await select(page, 'lamp', 'circle');
    await page.mouse.click(a.x + 4, a.y, { button: 'right' });
    await page.getByRole('menu', { name: 'Selection' }).getByRole('menuitem', { name: 'Summarize with Steve' }).click();
    await expect.poll(() => api.steve.asks.length).toBe(2);
    expect(api.steve.asks[1]).toMatchObject({ mode: 'summarize_selection' });
  });

  test("Summarize this page sends the page's words and a whole-page place", async ({ page, api }) => {
    api.steve.consented = true;
    await openReader(page);
    await clickTool(page, page.getByRole('button', { name: 'Ask Steve' }));
    await panel(page).getByRole('button', { name: 'Summarize this page' }).click();
    await expect.poll(() => api.steve.asks.length).toBe(1);
    const asked = api.steve.asks[0];
    expect(asked).toMatchObject({ mode: 'summarize_page', question: 'Summarize this page.',
      anchor: { kind: 'pdf', page: 1, text: '' } });
    expect(asked.anchor.quads[0].slice(0, 2)).toEqual([0, 0]);
    expect(asked.page_text).toContain('Line 1 of page 1: the lamp threw a small circle of light.');
    expect(asked.page_text).not.toContain('page 2');
    expect(asked.page_text.length).toBeLessThanOrEqual(6000);
  });

  test('with Steve off, neither the toolbar nor the menu offers him', async ({ page, api }) => {
    api.steve.enabled = false;
    await openReader(page);
    await clickTool(page, page.getByRole('button', { name: 'Ask Steve' })); // his settings load: he is off
    await page.keyboard.press('Escape');
    const a = await select(page, 'lamp', 'circle');
    await expect(page.getByRole('toolbar', { name: 'Highlight the selection' }).getByRole('button', { name: /with Steve/ })).toHaveCount(0);
    await page.mouse.click(a.x + 4, a.y, { button: 'right' });
    await expect(page.getByRole('menu', { name: 'Selection' }).getByRole('menuitem', { name: /with Steve/ })).toHaveCount(0);
  });
});

test.describe('an EPUB', () => {
  test.use({ book: 'epub' });

  test('Summarize this page sends the words in view and the place as a section range', async ({ page, api }) => {
    api.steve.consented = true;
    await openReader(page);
    await clickTool(page, page.getByRole('button', { name: 'Ask Steve' }));
    await panel(page).getByRole('button', { name: 'Summarize this page' }).click();
    await expect.poll(() => api.steve.asks.length).toBe(1);
    const asked = api.steve.asks[0];
    expect(asked).toMatchObject({ mode: 'summarize_page', anchor: { kind: 'epub', text: '' } });
    expect(asked.anchor.cfi).toMatch(/^epubcfi\(\/6\/4!/); // chapter 1, where it opens
    expect(asked.page_text).toContain('The lamp on the desk threw a small circle of light');
  });
});
