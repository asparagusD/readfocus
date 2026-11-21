// C39.2 (issue 23, D3): Edge's colours. The selection toolbar shows the handoff's five and More colours, which
// opens Edge's red and the deeper five under them; a deeper colour saves and is painted on a PDF (in Paper's
// colours, as the page is published) and in an EPUB's section; H then uses it, so More colours opens by itself; the
// highlight's chip shows it pressed; the Annotations tab filters by the colours in use only. Every call is mocked.
import { clickTool, contentsPane, expect, openReader, test, wordPoint } from './fixtures';

const toolbar = (page) => page.getByRole('toolbar', { name: 'Highlight the selection' });

async function select(page, from, to) {
  const a = await wordPoint(page, from);
  const b = await wordPoint(page, to);
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(toolbar(page)).toBeVisible();
}

const colourNames = (scope) => scope.locator('.rf-seltool-dot').evaluateAll((els) => els.map((el) => el.dataset.colour));

test.describe('pdf', () => {
  test('More colours opens the deeper five; one saves, is drawn in its colour, and H uses it next', async ({ page, api }) => {
    await openReader(page);
    await select(page, 'lamp', 'circle');
    const more = toolbar(page).getByRole('button', { name: 'More colours' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(await colourNames(toolbar(page))).toEqual(['honey', 'sage', 'sky', 'rose', 'lilac']);
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(await colourNames(toolbar(page))).toEqual(['honey', 'sage', 'sky', 'rose', 'lilac', 'poppy', 'amber', 'fern',
      'ocean', 'berry']);
    // The deeper five line up under the first five.
    const lefts = await toolbar(page).locator('.rf-seltool-dot').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
    expect(lefts.slice(5)).toEqual(lefts.slice(0, 5));
    await toolbar(page).getByRole('button', { name: 'Ocean highlight' }).click();
    await expect.poll(() => api.annotations.map((a) => a.color)).toEqual(['ocean']);

    const box = page.locator('.rf-pdf-page[data-page="1"] .rf-anno:not([data-id^="pending-"])').first();
    await expect(box).toHaveAttribute('data-colour', 'ocean');
    expect(await box.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(184, 209, 232)'); // Paper's --hl-ocean

    await page.mouse.move(5, 5);
    await select(page, 'threw', 'small'); // the last colour is a deeper one: More colours is open, Ocean outlined
    await expect(toolbar(page).getByRole('button', { name: 'More colours' })).toHaveAttribute('aria-expanded', 'true');
    await expect(toolbar(page).getByRole('button', { name: 'Ocean highlight' })).toHaveAttribute('data-last', 'true');
    await page.keyboard.press('h');
    await expect.poll(() => api.annotations.map((a) => a.color)).toEqual(['ocean', 'ocean']);
  });

  test('the chip shows a deeper colour pressed; the Annotations tab filters by the colours in use', async ({ page, api }) => {
    await openReader(page);
    await select(page, 'lamp', 'circle');
    await toolbar(page).getByRole('button', { name: 'More colours' }).click();
    await toolbar(page).getByRole('button', { name: 'Berry highlight' }).click();
    await expect.poll(() => api.annotations.length).toBe(1);
    await page.mouse.move(5, 5);
    await select(page, 'threw', 'small');
    await toolbar(page).getByRole('button', { name: 'Sky highlight' }).click();
    await expect.poll(() => api.annotations.length).toBe(2);

    await page.mouse.move(5, 5);
    await clickTool(page, page.getByRole('switch', { name: 'Look up words on hover' })); // lookup off: the chip
    const lamp = await wordPoint(page, 'lamp');
    await page.mouse.move(lamp.x, lamp.y - 40);
    await page.mouse.move(lamp.x, lamp.y, { steps: 4 });
    const chip = page.getByRole('toolbar', { name: /^Berry highlight:/ });
    await expect(chip).toBeVisible();
    await expect(chip.getByRole('button', { name: 'More colours' })).toHaveAttribute('aria-expanded', 'true');
    await expect(chip.getByRole('button', { name: 'Berry' })).toHaveAttribute('aria-pressed', 'true');
    await chip.getByRole('button', { name: 'Fern' }).click();
    await expect.poll(() => api.annotationPatches.at(-1)).toEqual({ id: 'ann-1', color: 'fern' });
    await page.mouse.move(5, 5);

    const contents = page.getByRole('button', { name: 'Contents', exact: true });
    if ((await contents.getAttribute('aria-expanded')) !== 'true') await contents.click();
    await contentsPane(page).getByRole('tab', { name: /^Annotations/ }).click();
    const filter = contentsPane(page).getByRole('radiogroup', { name: 'Colour' });
    await expect(filter.getByRole('radio')).toHaveText(['All', '', '']);
    expect(await filter.getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))))
      .toEqual(['All', 'Sky', 'Fern']);
    await filter.getByRole('radio', { name: 'Fern' }).click();
    await expect(contentsPane(page).getByRole('tabpanel', { name: 'Annotations' }).getByRole('listitem')).toHaveCount(1);
  });
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test("a deeper colour is painted in the section's own highlights", async ({ page, api }) => {
    await openReader(page);
    await select(page, 'lamp', 'circle');
    await toolbar(page).getByRole('button', { name: 'More colours' }).click();
    await toolbar(page).getByRole('button', { name: 'Poppy highlight' }).click();
    await expect.poll(() => api.annotations.map((a) => a.color)).toEqual(['poppy']);
    const painted = async () => {
      for (const frame of page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())) {
        const found = await frame.evaluate(() => {
          const h = window.CSS?.highlights?.get('rf-highlight-poppy');
          const css = [...document.querySelectorAll('style[data-rf-annotations]')].map((s) => s.textContent).join('');
          return h ? { texts: [...h].map((r) => r.toString()), css: /::highlight\(rf-highlight-poppy\) \{ background-color: #f6b6a9/.test(css) } : null;
        }).catch(() => null);
        if (found) return found;
      }
      return null;
    };
    await expect.poll(painted).toEqual({ texts: ['lamp on the desk threw a small circle'], css: true });
  });
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 812 }, book: 'epub' });

  test('the bar with More colours open wraps inside the screen; every button is a 44 px target', async ({ page }) => {
    await openReader(page);
    await select(page, 'lamp', 'circle');
    await toolbar(page).getByRole('button', { name: 'More colours' }).click();
    await expect(toolbar(page).getByRole('button', { name: 'Berry highlight' })).toBeVisible();
    const bar = await toolbar(page).boundingBox();
    expect(bar.x).toBeGreaterThanOrEqual(16);
    expect(bar.x + bar.width).toBeLessThanOrEqual(375 - 16);
    for (const button of await toolbar(page).getByRole('button').all()) {
      const b = await button.boundingBox();
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
  });
});
