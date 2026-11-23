// The reader end to end (C12.10; on the original view since C17.5), on the real /read page with the
// API mocked, once on a PDF (e2e/fixtures/books/sample.pdf) and once on an illustrated EPUB (reflow.epub).
import { book, clickTool, contentsPane, expect, openReader, settled, shown, spoken, test, timeToCard, wake, wordPoint } from './fixtures.js';

/** "5" -> 5; "2:340" -> [2, 340]. */
const at = (spot) => (spot.includes(':') ? spot.split(':').map(Number) : Number(spot));
const before = (a, b) => (Array.isArray(a) ? a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) : a < b);
/** True when the place `spot` lies between the shown start and end. */
const holds = ({ start, end }, spot) => !before(at(spot), at(start)) && !before(at(end), at(spot));
/**
 * C38.7a: the same place in view: `spot` shown, or (a scrolled EPUB re-anchored to the line at its top, which a
 * fraction of a pixel can push out of view) a start in the same section at most two lines (160 characters) on.
 */
const keeps = (place, spot) => holds(place, spot) || (Array.isArray(at(spot)) && at(place.start)[0] === at(spot)[0]
  && at(place.start)[1] >= at(spot)[1] && at(place.start)[1] - at(spot)[1] <= 160);

for (const kind of ['pdf', 'epub']) {
  test.describe(`${kind}: pages and turns`, () => {
    test.use({ book: kind });

    // C38.2: a PDF scrolls; C38.7a: an EPUB too (a screen at a time by key, the next section past a section's end).
    test('arrow keys, Page Down and the wheel move through the book', async ({ page, api }) => {
      await openReader(page);
      const first = await settled(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      const second = await settled(page, first); // each place read once its turn has landed (DEBUG_LOG C17.6)
      expect(before(at(first.start), at(second.start))).toBe(true);
      await page.keyboard.press('PageDown'); // C38.4c, C38.7a: no Next button
      const third = await settled(page, second);
      await page.keyboard.press('ArrowLeft');
      const back = await settled(page, third);
      if (kind === 'pdf') expect(back).toEqual(second);
      else expect(keeps(back, second.start) || holds(back, second.end)).toBe(true); // the first section's end again
      const area = await page.locator(kind === 'pdf' ? '.rf-pdf-book' : '.rf-epub').boundingBox();
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
      await page.mouse.wheel(0, 900); // an EPUB at its first section's end: on into the next
      expect(before(at(second.start), at((await settled(page, second)).start))).toBe(true);
      expect(api.opens).toBe(1); // C26.5: GET /books/{id}/open, no session
      expect(api.starts).toBe(0);
      expect(api.fileLoads).toBe(1);
    });

    test('the place is saved as an anchor in the file and restored after a reload', async ({ page, api }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700); // the leaf lands
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
      const place = await shown(page);
      await expect.poll(() => api.saves, { timeout: 4000 }).toBeGreaterThan(0); // debounced 1 s
      await page.waitForTimeout(1200); // the last turn's save too
      expect(api.position?.anchor?.kind).toBe(kind);
      expect(api.position).toMatchObject(kind === 'pdf'
        ? { anchor: { kind: 'pdf', page: Number(place.start), quads: [[0, 0, 0, 0]], text: '' } }
        : { anchor: { kind: 'epub', cfi: expect.stringMatching(/^epubcfi\(.+\)$/), text: '' } });
      await page.reload();
      await openReader(page);
      expect(api.opens).toBe(2);
      const back = await shown(page);
      expect(keeps(back, place.start), `${place.start} in ${JSON.stringify(back)}`).toBe(true);
    });

    test('a resize keeps the same place in view', async ({ page }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(800); // the leaf lands
      const { start } = await shown(page);
      for (const size of [{ width: 1100, height: 760 }, { width: 800, height: 1000 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(700);
        expect(keeps(await shown(page), start), `${start} in view at ${size.width}x${size.height}`).toBe(true);
      }
    });

    test('the ribbon and B save the place at once, with a toast naming the page', async ({ page, api }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      const place = await settled(page);
      await expect.poll(() => api.saves, { timeout: 4000 }).toBeGreaterThan(0); // the turn's own debounced save
      await page.waitForTimeout(1200); // and nothing else pending
      const before = api.saves;
      await expect(page.locator('.rf-ov-mark')).toHaveCount(0); // C38.8b: no mark before a place is saved
      await page.getByRole('button', { name: 'Save my place' }).click(); // C38.8b: in the toolbar
      await expect(page.getByText(/^Place saved at p+\. /)).toBeVisible();
      const mark = await page.locator('.rf-ov-mark').boundingBox(); // a small ribbon beside the place, on the desk
      const paper = await page.locator(kind === 'pdf' ? '.rf-pdf-page[data-scale]' : '.rf-epub').first().boundingBox();
      expect(mark.x >= paper.x + paper.width || mark.x + mark.width <= paper.x, 'beside the paper').toBe(true);
      await expect.poll(() => api.saves, { timeout: 900 }).toBeGreaterThan(before); // no 1 s debounce for the ribbon
      expect(api.position.anchor.kind).toBe(kind);
      const saved = api.saves;
      await book(page).focus();
      await page.keyboard.press('b');
      await expect.poll(() => api.saves, { timeout: 900 }).toBeGreaterThan(saved);
      expect(await shown(page)).toEqual(place); // saving does not move the book
    });

    test('reduced motion turns the page with no animated leaf', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openReader(page);
      const first = await shown(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => shown(page)).not.toEqual(first);
      const during = await page.evaluate(() => ({
        leaf: document.querySelectorAll('.rf-ov-leaf').length,
        animations: document.getAnimations().filter((a) => a.playState === 'running').length,
      }));
      expect(during.leaf).toBe(0);
      if (kind === 'epub') expect(during.animations).toBe(0); // C38.2: a PDF has no leaf to animate at all
    });

    test("the book's end shows its closing words, and Home goes back to the start", async ({ page }) => {
      await openReader(page);
      await book(page).focus();
      // C38.2: a PDF's closing words sit below its last page; C38.7a: an EPUB's are a card once its end is scrolled to.
      await page.keyboard.press('End');
      for (let i = 0; i < 8 && kind === 'epub' && !(await page.locator('.rf-ov[data-ending]').count()); i += 1) {
        await page.keyboard.press('PageDown'); // End opens the last section; Page Down reads to its foot
        await page.waitForTimeout(400);
      }
      await expect(page.locator(kind === 'pdf' ? '.rf-pdf-end .rf-end' : '.rf-epub-end .rf-end')).toBeInViewport();
      await expect(spoken(page)).toHaveText('End of the book');
      await expect(page.locator('.rf-ov-foot')).toHaveCount(0); // C38.4c, C38.7a: no footer
      await page.keyboard.press('Home');
      await expect(spoken(page)).toHaveText(kind === 'pdf' ? /^p\. i of 6/ : /^p\. 1 /);
      if (kind === 'pdf') expect(await shown(page)).toEqual({ start: '1', end: '1' }); // its end strip stays below the last page
      else await expect(page.locator('.rf-end')).toHaveCount(0);
    });

    test('a known word shows its card within 600 ms once cached, beside the word, and Esc closes it', async ({ page, api }) => {
      await openReader(page);
      const lamp = await wordPoint(page, 'lamp');
      expect(lamp).not.toBeNull();
      await page.mouse.move(5, 5);
      await page.mouse.move(lamp.x, lamp.y);
      const card = page.locator('.rf-wordcard[data-kind="definition"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText('A device for giving light.');
      const box = await card.boundingBox();
      expect(box.y >= lamp.bottom || box.y + box.height <= lamp.top, 'the card leaves the line uncovered').toBe(true);
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
      // Again: the answer is in the client's cache, so only the hover intent stands between.
      await page.mouse.move(5, 5);
      await page.waitForTimeout(300);
      const elapsed = await timeToCard(page, lamp);
      expect(elapsed).toBeLessThan(600);
      await expect(card).toBeVisible();
      expect(api.lookups.filter((l) => l.term === 'lamp')).toHaveLength(1);
      // Moving off the word closes a hover card, inside an EPUB section's iframe as well: here, into the gutter.
      const middle = await page.locator('.rf-ov-book').boundingBox();
      await page.mouse.move(middle.x + middle.width / 2, lamp.y, { steps: 4 });
      await expect(card).toHaveCount(0);
    });

    test('two to five selected words are looked up as a phrase', async ({ page, api }) => {
      await openReader(page);
      const lamp = await wordPoint(page, 'lamp');
      const threw = await wordPoint(page, 'threw');
      await page.mouse.move(lamp.left + 1, lamp.y);
      await page.mouse.down();
      await page.mouse.move(threw.right - 1, threw.y, { steps: 8 });
      await page.mouse.up();
      await expect(page.locator('.rf-wordcard')).toBeVisible();
      await expect.poll(() => api.lookups.map((l) => l.term)).toContainEqual(expect.stringMatching(/^lamp.*threw$/));
    });

    test.describe('on a phone', () => {
      test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

      test('a long-press opens the compact sheet below or above the word, with no page turn', async ({ page }) => {
        await openReader(page);
        const lamp = await wordPoint(page, 'lamp');
        const cdp = await page.context().newCDPSession(page);
        const touch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: lamp.x, y: lamp.y }] });
        const before = await shown(page);
        await touch('touchStart');
        await page.waitForTimeout(600);
        await touch('touchEnd');
        const sheet = page.locator('.rf-wordcard[data-compact]');
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('Tap outside to close');
        const box = await sheet.boundingBox();
        expect(box.y >= lamp.bottom || box.y + box.height <= lamp.top, 'the sheet leaves the word uncovered').toBe(true);
        expect(await shown(page)).toEqual(before); // no page turn
      });
    });
  });
}

test.describe('the toolbar at 375', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // C13.9: the tools on one row (handoff 375 frame); C23.7: no session row under them any more.
  test('the tools fit inside the screen, with no session clock row', async ({ page }) => {
    await openReader(page);
    const toolbar = page.getByRole('toolbar', { name: 'Reading controls' });
    await expect(toolbar.getByRole('button', { name: 'Back to the library' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Session' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  });
});

// C13.9: one h1 that names the book, hidden from sight (the book's own headings are the publisher's).
test('the reading page has one h1 naming the book', async ({ page }) => {
  await openReader(page);
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText('Walden');
  expect(await h1.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
});

test('the contents list the PDF outline, and an entry opens its page', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Contents' }).click();
  const items = contentsPane(page).locator('.rf-contents-item');
  await expect(items).toHaveText(['Chapter 1 Signals', 'Chapter 2 Noise']); // C26.5: no "today" any more
  await items.nth(1).click();
  await expect.poll(() => shown(page)).toEqual({ start: '5', end: '5' }); // C38.2: page 5 at the top of the view
});

// C38.4a (issue 22): Edge's page box: the page in view, and a typed page number goes there.
test('the page box shows the page in view, goes to a typed page, and puts back one the book does not have', async ({ page }) => {
  await openReader(page);
  await wake(page);
  const box = page.getByRole('textbox', { name: /^Page number/ });
  await expect(box).toHaveValue('1');
  await expect(page.getByRole('toolbar', { name: 'Reading controls' })).toContainText('of 6');
  await book(page).focus();
  await page.keyboard.press('PageDown');
  await expect(box).toHaveValue('2');
  await box.fill('4');
  await box.press('Enter');
  await expect.poll(async () => (await shown(page)).start).toBe('4');
  await expect(box).toHaveValue('4');
  await box.fill('99');
  await box.press('Enter');
  await expect(box).toHaveValue('4'); // not a page of this book: the page shown comes back
  expect((await shown(page)).start).toBe('4');
  await box.fill('2');
  await box.press('Escape');
  await expect(box).toHaveValue('4');
});

// C38.4a: Edge's Page view: one page, two side by side, or two with the cover alone; kept on this device.
test('Page view lays two pages side by side, or the cover alone first, and is kept after a reload', async ({ page }) => {
  await openReader(page);
  await wake(page);
  const view = page.getByRole('combobox', { name: 'Page view' });
  await expect(view).toHaveValue('one');
  await view.selectOption('two');
  await expect.poll(() => shown(page)).toEqual({ start: '1', end: '2' });
  const [a, b] = await Promise.all([1, 2].map((n) => page.locator(`.rf-pdf-page[data-page="${n}"]`).boundingBox()));
  expect(b.x).toBeGreaterThan(a.x + a.width); // side by side
  expect(Math.abs(b.y - a.y)).toBeLessThan(2);
  await book(page).focus();
  await page.keyboard.press('PageDown'); // a row at a time
  await expect.poll(() => shown(page)).toEqual({ start: '3', end: '4' });
  await view.selectOption('cover');
  await expect.poll(() => shown(page)).toEqual({ start: '2', end: '3' }); // the words in view are kept: page 3's row
  await book(page).focus();
  await page.keyboard.press('Home');
  await expect.poll(() => shown(page)).toEqual({ start: '1', end: '1' }); // the cover alone
  await page.reload();
  await openReader(page);
  await expect(page.getByRole('combobox', { name: 'Page view' })).toHaveValue('cover');
});

// C38.4b (issue 22): Edge's toolbar: pinned by default, unpinned it fades while reading; full screen; More tools.
const more = (page) => page.getByRole('button', { name: 'More tools' });
const bar = (page) => page.locator('.rf-toolbar');

test('the toolbar stays pinned; unpinned it fades while reading and comes back on a move, and the choice is kept', async ({ page }) => {
  await openReader(page);
  await page.waitForTimeout(3000); // past the 2.6 s a reader's stillness takes
  await expect(bar(page)).toHaveAttribute('data-visible', 'true');
  await more(page).click();
  const pin = page.getByRole('button', { name: 'Keep the toolbar shown' });
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(more(page)).toBeFocused();
  await book(page).focus(); // reading: focus leaves the bar
  await page.mouse.move(700, 500);
  await expect(bar(page)).toHaveAttribute('data-visible', 'false', { timeout: 6000 });
  await page.mouse.move(720, 520, { steps: 3 });
  await expect(bar(page)).toHaveAttribute('data-visible', 'true');
  await page.reload();
  await openReader(page);
  await more(page).click();
  await expect(page.getByRole('button', { name: 'Keep the toolbar shown' })).toHaveAttribute('aria-pressed', 'false');
});

test('Full screen fills the screen with the reading page and leaves it again', async ({ page }) => {
  await openReader(page);
  await more(page).click();
  const full = page.getByRole('button', { name: 'Full screen' });
  await full.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(full).toHaveAttribute('aria-pressed', 'true'); // the panel stays open
  await full.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test.describe('the toolbar at 1024', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('Look up, Steve, Focus and Quiz me move into More tools; Escape and a press outside close it', async ({ page }) => {
    await openReader(page);
    await expect(bar(page).getByRole('switch', { name: 'Focus mode' })).toBeHidden();
    expect(await bar(page).evaluate((el) => el.offsetHeight)).toBeLessThan(70); // one row
    await more(page).click();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
    for (const tool of [page.getByRole('switch', { name: 'Look up words on hover' }), page.getByRole('button', { name: 'Ask Steve' }),
      page.getByRole('switch', { name: 'Focus mode' }), page.getByRole('button', { name: 'Quiz me' })]) await expect(tool).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(more(page)).toBeFocused();
    await more(page).click();
    await page.mouse.click(600, 500); // the book
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
  });
});

test('a proper noun shows a Wikipedia summary with a link', async ({ page, api }) => {
  await openReader(page);
  await book(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // C38.2: page 3 at the top, "Chapter 1 Signals"
  await page.waitForTimeout(800);
  const signals = await wordPoint(page, 'Signals');
  await page.mouse.move(5, 5);
  await page.mouse.move(signals.x, signals.y);
  const card = page.locator('.rf-wordcard[data-kind="summary"]');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading')).toHaveText('Signal');
  const link = card.getByRole('link', { name: /Wikipedia/ });
  await expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Signal');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(api.lookups).toContainEqual({ term: 'Signals', proper: true });
});

test("words inside a PDF page's math, code or figure boxes are not looked up (C18.6d)", async ({ page, api }) => {
  // Every page's whole area is a math box: no word on it may be looked up.
  api.regions = Array.from({ length: 20 }, (_, i) => ({ page: i + 1, kind: 'math', bbox: [0, 0, 2000, 2000] }));
  await openReader(page);
  await expect.poll(() => api.regionAsks).toBeGreaterThan(0);
  const lamp = await wordPoint(page, 'lamp');
  expect(lamp).not.toBeNull();
  await page.mouse.move(5, 5);
  await page.mouse.move(lamp.x, lamp.y);
  await page.waitForTimeout(900);
  await expect(page.locator('.rf-wordcard')).toHaveCount(0);
  expect(api.lookups).toEqual([]);
});

test.describe('epub', () => {
  test.use({ book: 'epub' });

  test('words in a figure are not looked up; the text around it is', async ({ page, api }) => {
    await openReader(page);
    const plate = await wordPoint(page, 'plate'); // only in the figure's caption
    expect(plate).not.toBeNull();
    await page.mouse.move(5, 5);
    await page.mouse.move(plate.x, plate.y);
    await page.waitForTimeout(900);
    await expect(page.locator('.rf-wordcard')).toHaveCount(0);
    expect(api.lookups).toEqual([]);
  });
});

test('with hover lookup off, hovering shows nothing, and Enter on a selected word still opens its card', async ({ page }) => {
  await openReader(page);
  await clickTool(page, page.getByRole('switch', { name: 'Look up words on hover' }));
  await expect(page.getByRole('switch', { name: 'Look up words on hover', includeHidden: true })).toHaveAttribute('aria-checked', 'false');
  const lamp = await wordPoint(page, 'lamp');
  await page.mouse.move(5, 5);
  await page.mouse.move(lamp.x, lamp.y);
  await page.waitForTimeout(900);
  await expect(page.locator('.rf-wordcard')).toHaveCount(0);
  await page.mouse.dblclick(lamp.x, lamp.y);
  await book(page).focus();
  await page.keyboard.press('Enter');
  const card = page.locator('.rf-wordcard[data-kind="definition"]');
  await expect(card).toBeVisible();
  await expect(card).toBeFocused();
});

// C17.6: anchors survive re-layout. An EPUB CFI is structural, so a larger text size and a reload come
// back to the same place; a PDF anchor is in points, so zooming changes nothing that is saved.
test.describe('anchors across re-layout', () => {
  test.describe('epub', () => {
    test.use({ book: 'epub' });

    test('after a text-size change the saved anchor reopens the same place', async ({ page, api }) => {
      await openReader(page);
      await book(page).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(800);
      const { start } = await shown(page);
      await page.getByRole('button', { name: 'Larger text' }).click();
      await page.getByRole('button', { name: 'Larger text' }).click();
      await page.waitForTimeout(800);
      expect(keeps(await shown(page), start), 'the same place after the new size').toBe(true);
      await expect.poll(() => api.saves, { timeout: 4000 }).toBeGreaterThan(0);
      const cfi = api.position.anchor.cfi;
      await page.reload();
      await openReader(page);
      expect(keeps(await shown(page), start), 'the same place after a reload at the new size').toBe(true);
      expect(api.position.anchor.cfi).toBe(cfi);
    });
  });

  test('zooming a PDF to 200% and back keeps the page and the saved anchor', async ({ page, api }) => {
    await openReader(page);
    await book(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    const place = await shown(page);
    await expect.poll(() => api.position?.anchor?.page, { timeout: 4000 }).toBe(Number(place.start));
    const level = page.getByRole('textbox', { name: /^Zoom, / }); // C41.1: Edge's zoom box, typed over
    await level.fill('200');
    await level.press('Enter');
    await expect(level).toHaveValue('200%');
    await page.waitForTimeout(500);
    expect(await shown(page)).toEqual(place);
    await page.getByRole('button', { name: 'Fit to page' }).click(); // back to a fit
    await page.waitForTimeout(500);
    expect(await shown(page)).toEqual(place);
    expect(api.position.anchor).toEqual({ kind: 'pdf', page: Number(place.start), quads: [[0, 0, 0, 0]], text: '' });
  });

  test("C41.1 (issue 28): the zoom box takes a percentage, kept to 25-500 %, and puts the zoom back otherwise", async ({ page }) => {
    await openReader(page);
    const level = page.getByRole('textbox', { name: /^Zoom, / });
    await expect(level).toHaveValue(/^\d+%$/); // the fitted page in percent
    const fitted = await level.inputValue();
    await level.fill('abc');
    await level.press('Enter');
    await expect(level).toHaveValue(fitted); // not a number: nothing changes
    await level.fill('900');
    await level.press('Enter');
    await expect(level).toHaveValue('500%');
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    const canvas = page.locator('.rf-pdf-page[data-page="1"] canvas').first();
    await expect.poll(() => canvas.evaluate((c) => c.width * c.height)).toBeGreaterThan(0); // drawn at 500 %,
    expect(await canvas.evaluate((c) => c.width * c.height)).toBeLessThanOrEqual(2 ** 24); // in at most 2^24 pixels
    await level.fill('42');
    await level.press('Escape');
    await expect(level).toHaveValue('500%'); // Escape puts it back
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(level).toHaveValue('400%');
  });
});

// DEBUG_LOG 2026-11-15 C23.6b: leaving the reader threw "n?.destroy is not a function" (PDF.js 6 documents
// have no destroy of their own) and the error boundary replaced the next page.
test('leaving a PDF for the library shows the library, with no page error', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await openReader(page);
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(500);
  expect(errors.filter((e) => /destroy|failed to render/.test(e))).toEqual([]);
  await expect(page.getByText('A page failed to render')).toHaveCount(0);
});

// C38.7b (issue 22): an EPUB's page box: its counted pages ("of ~5": reflow.epub's 6,085 characters at 1,500 a page),
// the page most in view, a typed page goes to its start; one the book does not have puts the page back.
test.describe('epub page box', () => {
  test.use({ book: 'epub' });

  test('shows the counted page in view and goes to a typed one', async ({ page }) => {
    await openReader(page);
    const box = page.getByRole('textbox', { name: 'Page number, of about 5' });
    await expect(box).toHaveValue('1');
    await expect(page.getByRole('toolbar', { name: 'Reading controls' })).toContainText('of ~5');
    await box.fill('3');
    await box.press('Enter');
    await expect.poll(async () => (await shown(page)).start.split(':')[0]).toBe('2'); // chapter 2 holds page 3's start
    await expect(box).toHaveValue('3');
    await box.fill('99');
    await box.press('Enter');
    await expect(box).toHaveValue('3');
  });
});

// C38.7b: the toolbar stays one row on a wide screen: Look up, Steve, Focus and Quiz me go into More tools when they
// do not fit (at 1280 they wrapped the bar; with an EPUB's text controls and page box, at 1440 too), and nothing moves
// once the book is open.
for (const kind of ['pdf', 'epub']) {
  test.describe(`${kind} toolbar on one row`, () => {
    test.use({ book: kind });
    test('at 1280 and 1440 the bar is one row, the tools that do not fit in More tools', async ({ page }) => {
      for (const width of [1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await openReader(page);
        const bar = page.getByRole('toolbar', { name: 'Reading controls' });
        await expect.poll(async () => (await bar.boundingBox()).height, `${kind} at ${width}`).toBeLessThan(70);
        const lookUp = page.getByRole('switch', { name: 'Look up words on hover' });
        if (!(await lookUp.isVisible())) await expect(page.getByRole('button', { name: 'More tools' })).toBeVisible();
        await page.waitForTimeout(600);
        expect((await bar.boundingBox()).height, `${kind} at ${width}, settled`).toBeLessThan(70);
      }
    });
  });
}
