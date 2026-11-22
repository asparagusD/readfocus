// C38.6a (issue 22): the contents as Edge's left pane: from 1024 px beside the pages (which narrow to make room),
// open while the reader picks and reads, Escape closing it only from inside it; below 1024 px the drawer it was.
import { test, expect, book, contentsPane, openReader, shown } from './fixtures.js';

test.use({ book: 'pdf' });

const contentsButton = (page) => page.getByRole('button', { name: 'Contents', exact: true });

test('from 1024 px the pane sits beside the pages and stays open through a pick', async ({ page }) => {
  await openReader(page);
  const before = await page.locator('.rf-pdf-book').boundingBox();
  await contentsButton(page).click();
  const pane = page.getByRole('complementary', { name: 'Contents' });
  await expect(pane).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Contents' })).toHaveCount(0);
  await expect(contentsButton(page)).not.toHaveAttribute('aria-haspopup');
  const [box, pages] = [await pane.boundingBox(), await page.locator('.rf-pdf-book').boundingBox()];
  expect(pages.x).toBeGreaterThanOrEqual(box.x + box.width); // beside, not over
  expect(pages.width).toBeLessThan(before.width);

  await pane.locator('.rf-contents-item').nth(1).click(); // Chapter 2 Noise
  await expect.poll(() => shown(page)).toEqual({ start: '5', end: '5' });
  await expect(pane).toBeVisible();
  await book(page).focus();
  await page.keyboard.press('Escape'); // in the book: the pane stays
  await expect(pane).toBeVisible();
  await pane.locator('.rf-contents-item').first().focus();
  await page.keyboard.press('Escape'); // in the pane: it closes, focus back on Contents
  await expect(pane).toHaveCount(0);
  await expect(contentsButton(page)).toBeFocused();
});

test('below 1024 px it is the drawer over the book, closed by a pick', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openReader(page);
  await contentsButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Contents' });
  await expect(drawer).toBeVisible();
  await drawer.locator('.rf-contents-item').nth(1).click();
  await expect(contentsPane(page)).toHaveCount(0);
  await expect.poll(() => shown(page)).toEqual({ start: '5', end: '5' });
});
