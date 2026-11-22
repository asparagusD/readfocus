// C38.6b (issue 22): the contents pane's Pages tab, as Edge's thumbnails: every page of a PDF with its printed label,
// the page in view marked; a pick goes to the page; over a 300-page book (bigPdf.js, served like Storage) only the
// thumbnails near the list's view are drawn, and those scrolled away are freed.
import { test, expect, contentsPane, openReader, shown } from './fixtures.js';
import { bigPdf } from './bigPdf.js';

test.use({ book: 'pdf' });

const STORE = 'http://localhost:8000/e2e-storage/pages.pdf';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const openPages = async (page) => {
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await contentsPane(page).getByRole('tab', { name: 'Pages' }).click();
  return contentsPane(page).getByRole('tabpanel', { name: 'Pages' });
};
const drawn = (panel) => panel.locator('.rf-thumb[data-drawn]');

test('the Pages tab shows each page, marks the one in view, and a pick goes there', async ({ page }) => {
  await openReader(page);
  const panel = await openPages(page);
  await expect(panel.getByRole('button', { name: /^Page / })).toHaveCount(6);
  await expect(panel.getByRole('button', { name: 'Page i', exact: true })).toHaveAttribute('aria-current', 'true'); // printed label
  await expect(drawn(panel)).toHaveCount(6);
  await expect(drawn(panel).first().locator('canvas')).toHaveCount(1);
  const fourth = panel.locator('.rf-thumb[data-page="4"]');
  await fourth.click();
  await expect.poll(() => shown(page)).toEqual({ start: '4', end: '4' });
  await expect(fourth).toHaveAttribute('aria-current', 'true');
  await expect(panel).toBeVisible(); // docked at 1440: the pane stays
});

test('over 300 pages only the thumbnails near the list\'s view are drawn', async ({ page, api }) => {
  test.setTimeout(60_000);
  const file = bigPdf({ pages: 300, padBytes: 0 });
  api.fileUrl = `${STORE}?token=t`;
  await page.route(`${STORE}**`, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const headers = { ...CORS, 'Content-Type': 'application/pdf' };
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'Content-Length': String(file.length) } });
    const match = /bytes=(\d+)-(\d+)/.exec(request.headers().range ?? '');
    if (!match) return route.fulfill({ status: 200, headers, body: file });
    const [begin, last] = [Number(match[1]), Math.min(Number(match[2]), file.length - 1)];
    return route.fulfill({ status: 206, headers: { ...headers, 'Content-Range': `bytes ${begin}-${last}/${file.length}` },
      body: file.subarray(begin, last + 1) });
  });
  await openReader(page);
  const panel = await openPages(page);
  await expect(panel.getByRole('button', { name: /^Page / })).toHaveCount(300);
  await expect(panel.locator('.rf-thumb[data-page="1"][data-drawn]')).toHaveCount(1);
  const near = await drawn(panel).count();
  expect(near).toBeGreaterThan(0);
  expect(near).toBeLessThan(20);
  await panel.locator('.rf-pages-list').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(panel.locator('.rf-thumb[data-page="300"][data-drawn]')).toHaveCount(1);
  await expect(panel.locator('.rf-thumb[data-page="1"][data-drawn]')).toHaveCount(0); // freed
  expect(await drawn(panel).count()).toBeLessThan(20);
  await panel.locator('.rf-thumb[data-page="299"]').click();
  await expect.poll(async () => (await shown(page)).start).toBe('299');
});
