// C21.4: with word lookup off, hovering (or tapping, or A from the keyboard) a highlight shows a small chip at its
// end: Ask Steve (explain_highlight with the annotation's anchor; the consent notice first when needed), the five
// colours, Underline and Delete. With lookup on, hovering keeps the word card and shows no chip.
import { book, expect, openReader, test, wordPoint } from './fixtures';

const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });
const chip = (page) => page.getByRole('toolbar', { name: /^(Honey|Sage|Sky|Rose|Lilac) (highlight|underline):/ });
const lookupSwitch = (page) => page.getByRole('switch', { name: 'Look up words on hover' });

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

async function lookupOff(page) {
  await lookupSwitch(page).click();
  await expect(lookupSwitch(page)).toHaveAttribute('aria-checked', 'false');
}

async function hover(page, word) {
  const w = await wordPoint(page, word);
  await page.mouse.move(w.x - 20, w.y - 40);
  await page.mouse.move(w.x, w.y, { steps: 4 });
  return w;
}

for (const kind of ['pdf', 'epub']) {
  test.describe(kind, () => {
    test.use({ book: kind });

    test('lookup off: hovering a highlight shows the chip at its end, clear of the line; Ask Steve explains it', async ({ page, api }) => {
      api.steve.consented = true;
      await openReader(page);
      await highlight(page, 'lamp', 'circle', 'Sky highlight');
      await expect.poll(() => api.annotations.length).toBe(1);
      await lookupOff(page);
      const small = await hover(page, 'small');
      await expect(chip(page)).toBeVisible();
      await expect(page.locator('.rf-wordcard')).toHaveCount(0);
      const box = await chip(page).boundingBox();
      expect(box.y + box.height <= small.top || box.y >= small.bottom, 'not over the line').toBe(true);
      const circle = await wordPoint(page, 'circle');
      expect(Math.abs(box.x + box.width / 2 - circle.right)).toBeLessThan(box.width); // at the highlight's end

      await chip(page).getByRole('button', { name: 'Ask Steve' }).click();
      await expect.poll(() => api.steve.asks.length).toBe(1);
      const [asked] = api.steve.asks;
      expect(asked).toMatchObject({ mode: 'explain_highlight', anchor: api.annotations[0].anchors[0] });
      await expect(page.getByRole('complementary', { name: /Steve/ })).toBeVisible();
      await expect(chip(page)).toHaveCount(0);
    });

    test('lookup on: hovering a highlighted word opens the word card as before, and no chip', async ({ page }) => {
      await openReader(page);
      await highlight(page, 'lamp', 'circle', 'Honey highlight');
      await page.waitForTimeout(300);
      await hover(page, 'small');
      await expect(page.locator('.rf-wordcard')).toBeVisible();
      await page.waitForTimeout(400);
      await expect(chip(page)).toHaveCount(0);
    });
  });
}

test('without consent, Ask Steve shows the notice first and asks only once Steve is turned on', async ({ page, api }) => {
  await openReader(page);
  await highlight(page, 'lamp', 'circle', 'Honey highlight');
  await lookupOff(page);
  await hover(page, 'threw');
  await chip(page).getByRole('button', { name: 'Ask Steve' }).click();
  await expect(page.getByRole('heading', { name: 'Before Steve reads along' })).toBeVisible();
  await page.waitForTimeout(400);
  expect(api.steve.asks).toHaveLength(0); // nothing leaves for Steve before consent
  await page.getByRole('button', { name: 'Turn on Steve' }).click();
  await expect.poll(() => api.steve.asks.length).toBe(1);
  expect(api.steve.asks[0]).toMatchObject({ mode: 'explain_highlight', anchor: { kind: 'pdf' } });
});

test('with Steve switched off, the chip has no Ask Steve', async ({ page, api }) => {
  api.steve.consented = true;
  api.steve.enabled = false;
  await openReader(page);
  await page.getByRole('button', { name: 'Ask Steve' }).click(); // the reader toolbar's Steve: his settings load
  await expect(page.getByPlaceholder('Turn on Steve to ask')).toBeVisible();
  await page.keyboard.press('Escape');
  await highlight(page, 'lamp', 'circle', 'Honey highlight');
  await lookupOff(page);
  await hover(page, 'small');
  await expect(chip(page)).toBeVisible();
  await expect(chip(page).getByRole('button', { name: 'Ask Steve' })).toHaveCount(0);
  expect(api.steve.asks).toHaveLength(0);
});

test('the chip recolours, switches to an underline and deletes, with Undo', async ({ page, api }) => {
  await openReader(page);
  await highlight(page, 'lamp', 'circle', 'Honey highlight');
  await expect.poll(() => api.annotations.length).toBe(1);
  await lookupOff(page);
  await hover(page, 'small');
  const bar = chip(page);
  await expect(bar.getByRole('button', { name: 'Honey', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'Rose', exact: true }).click();
  await expect(page.locator('.rf-anno').first()).toHaveAttribute('data-colour', 'rose');
  await expect.poll(() => api.annotationPatches).toEqual([{ id: 'ann-1', color: 'rose' }]);
  await bar.getByRole('button', { name: 'Underline', exact: true }).click();
  await expect(page.locator('.rf-anno').first()).toHaveAttribute('data-style', 'underline');
  await expect.poll(() => api.annotationPatches.at(-1)).toEqual({ id: 'ann-1', style: 'underline' });

  await chip(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.rf-anno')).toHaveCount(0);
  await expect.poll(() => api.annotationDeletes).toEqual(['ann-1']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.rf-anno')).toHaveCount(1);
  await expect.poll(() => api.annotationPosts.length).toBe(2);
  expect(api.annotationPosts[1]).toMatchObject({ style: 'underline', color: 'rose' });
});

test('a change the server refuses is put back, with a toast', async ({ page, api }) => {
  await openReader(page);
  await highlight(page, 'lamp', 'circle', 'Sage highlight');
  await expect.poll(() => api.annotations.length).toBe(1);
  api.annotationFail = 500;
  await lookupOff(page);
  await hover(page, 'small');
  await chip(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText("That highlight wasn't deleted. Try again.")).toBeVisible();
  await expect(page.locator('.rf-anno')).toHaveCount(1);
});

test.describe('keyboard and reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('A goes to the highlights on the page, the chip is a toolbar, Escape returns to the book', async ({ page, api }) => {
    api.steve.consented = true;
    await openReader(page);
    await highlight(page, 'lamp', 'threw', 'Honey highlight');
    await highlight(page, 'circle', 'light', 'Sky highlight');
    await expect.poll(() => api.annotations.length).toBe(2);
    await lookupOff(page);
    await book(page).focus();
    await page.keyboard.press('a');
    await expect(chip(page)).toHaveAccessibleName(/^Honey highlight: lamp threw/);
    await expect(chip(page).getByRole('button', { name: 'Ask Steve' })).toBeFocused();
    expect(await chip(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('rf-seltool-fade');
    await page.keyboard.press('ArrowRight');
    await expect(chip(page).getByRole('button', { name: 'Honey', exact: true })).toBeFocused();
    await page.keyboard.press('a');
    await expect(chip(page)).toHaveAccessibleName(/^Sky highlight: circle of light/);
    await page.keyboard.press('Escape');
    await expect(chip(page)).toHaveCount(0);
    await expect(book(page)).toBeFocused();
    await page.keyboard.press('a');
    await page.keyboard.press('Enter'); // Ask Steve
    await expect.poll(() => api.steve.asks.length).toBe(1);
  });
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, book: 'epub', viewport: { width: 768, height: 1024 } });

  test('a tap on a highlight shows the chip with lookup off', async ({ page, api }) => {
    await openReader(page);
    await highlight(page, 'lamp', 'circle', 'Lilac highlight');
    await expect.poll(() => api.annotations.length).toBe(1);
    await lookupOff(page);
    const small = await wordPoint(page, 'small');
    await page.touchscreen.tap(small.x, small.y);
    await expect(chip(page)).toBeVisible();
    for (const button of await chip(page).getByRole('button').all()) {
      const b = await button.boundingBox();
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(36);
    }
  });
});
