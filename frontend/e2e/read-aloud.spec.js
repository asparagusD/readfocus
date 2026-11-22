// Read aloud (C40.2, issue 24: Edge's Read aloud) on the sample PDF (e2e/fixtures/books/sample.pdf): six pages, a title
// and 14 lines each ("Line 3 of page 2: the lamp threw a small circle of light."). Headless Edge has no voices, so a
// fake speechSynthesis speaks: it keeps every utterance (window.__spoken) and sends a word boundary every
// window.__wordMs (120 ms unless a test changes it), then the utterance's end. C40.2b: Voice options; C40.2c:
// Ctrl+Shift+U and Read aloud from here.
import { test, expect, openReader, clickTool, reveal, book, wordPoint } from './fixtures.js';

test.use({ book: 'pdf' });

async function fakeVoices(page) {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__wordMs = 120;
    const voices = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', voiceURI: 'david', default: true, localService: true },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', voiceURI: 'aria', default: false, localService: false },
    ];
    let current = null;
    let timer = null;
    const synth = new EventTarget();
    Object.assign(synth, {
      getVoices: () => voices,
      speak(u) {
        window.__spoken.push({ text: u.text, rate: u.rate, voice: u.voice?.voiceURI ?? null });
        current = u;
        const words = [...u.text.matchAll(/\S+/g)];
        let i = 0;
        const step = () => {
          if (current !== u) return;
          if (i < words.length) {
            const w = words[i];
            i += 1;
            u.onboundary?.({ name: 'word', charIndex: w.index, charLength: w[0].length });
            timer = setTimeout(step, window.__wordMs);
          } else {
            current = null;
            u.onend?.({});
          }
        };
        timer = setTimeout(step, 0);
      },
      cancel() {
        const u = current;
        current = null;
        clearTimeout(timer);
        u?.onerror?.({ error: 'interrupted' });
        u?.onend?.({});
      },
      pause() {},
      resume() {},
    });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.rate = 1; this.voice = null; this.lang = ''; } };
  });
}

const readAloud = (page) => page.getByRole('button', { name: 'Read aloud', exact: true });
const bar = (page) => page.getByRole('region', { name: 'Read aloud' });
const said = (page) => page.evaluate(() => window.__spoken);
const lastSaid = async (page) => (await said(page)).at(-1);
const word = (page) => page.evaluate(() => [...(CSS.highlights.get('rf-read-aloud') ?? [])].map((r) => r.toString()).join(''));

test.beforeEach(async ({ page }) => { await fakeVoices(page); });

test('Read aloud reads the page in view a sentence at a time and marks each word as it is spoken', async ({ page }) => {
  await openReader(page);
  await clickTool(page, readAloud(page));
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Pause' })).toBeFocused();
  await expect.poll(async () => (await lastSaid(page))?.text).toMatch(/page 1/);
  await expect.poll(() => word(page)).not.toBe('');
  await bar(page).getByRole('button', { name: 'Pause' }).click(); // the word stays still to be checked
  const marked = await word(page);
  expect((await said(page)).map((s) => s.text).join(' ')).toContain(marked); // the word marked is one spoken
  await expect(page.locator('.rf-ov')).toHaveAttribute('data-reading-aloud', 'true');
  await expect(await reveal(page, readAloud(page))).toHaveAttribute('aria-pressed', 'true');
});

test('pause, play, next and previous paragraph, and stop', async ({ page }) => {
  await openReader(page);
  await clickTool(page, readAloud(page));
  await expect.poll(async () => (await said(page)).length).toBeGreaterThan(0);

  await bar(page).getByRole('button', { name: 'Pause' }).click();
  const count = (await said(page)).length;
  const held = await word(page);
  await page.waitForTimeout(500);
  expect((await said(page)).length).toBe(count); // nothing more spoken while paused
  expect(await word(page)).toBe(held); // the word stays marked

  await bar(page).getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await lastSaid(page)).text.startsWith(held)).toBe(true); // again from the word it stopped on

  const before = (await lastSaid(page)).text;
  await bar(page).getByRole('button', { name: 'Next paragraph' }).click();
  await expect.poll(async () => (await lastSaid(page)).text).not.toBe(before);
  const next = (await lastSaid(page)).text;
  await bar(page).getByRole('button', { name: 'Previous paragraph' }).click();
  await expect.poll(async () => (await lastSaid(page)).text).not.toBe(next);

  await bar(page).getByRole('button', { name: 'Stop reading aloud' }).click();
  await expect(bar(page)).toBeHidden();
  await expect(page.locator('.rf-ov-stage')).toBeFocused();
  expect(await word(page)).toBe('');
  await expect(await reveal(page, readAloud(page))).toHaveAttribute('aria-pressed', 'false');
});

test('Voice options: a voice and a speed are used at once and kept for next time', async ({ page }) => {
  await openReader(page);
  await clickTool(page, readAloud(page));
  await expect.poll(async () => (await said(page)).length).toBeGreaterThan(0);
  expect((await said(page))[0].voice).toBe('aria'); // the natural English voice first

  await bar(page).getByRole('button', { name: 'Voice options' }).click();
  await bar(page).getByRole('combobox', { name: 'Voice' }).selectOption('david');
  await expect.poll(async () => (await lastSaid(page)).voice).toBe('david');
  const speed = bar(page).getByRole('slider', { name: /Speed/ });
  await speed.focus();
  await page.keyboard.press('ArrowRight'); // 1x to 1.25x
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await lastSaid(page)).rate).toBe(1.5);
  await expect(bar(page).locator('.rf-read-aloud-rate')).toHaveText('1.5×');
  await page.keyboard.press('Escape'); // closes Voice options, focus back on its button
  await expect(bar(page).getByRole('button', { name: 'Voice options' })).toBeFocused();
  await expect(bar(page).getByRole('combobox', { name: 'Voice' })).toBeHidden();

  await page.reload();
  await openReader(page);
  await clickTool(page, readAloud(page));
  await expect.poll(async () => (await said(page)).at(0)).toMatchObject({ voice: 'david', rate: 1.5 });
});

test('it reads on into the next page, and the view follows the words', async ({ page }) => {
  await openReader(page);
  await page.evaluate(() => { window.__wordMs = 15; });
  await clickTool(page, readAloud(page));
  await expect.poll(async () => (await said(page)).some((s) => /page 2/.test(s.text)), { timeout: 20_000 }).toBe(true);
  // the page box follows the pages being read (it names the page most in view)
  await expect.poll(async () => Number(await page.getByRole('textbox', { name: /^Page number/ }).inputValue()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
});

test('Ctrl+Shift+U starts reading and stops it, as in Edge', async ({ page }) => {
  await openReader(page);
  await book(page).focus();
  await page.keyboard.press('Control+Shift+U');
  await expect(bar(page)).toBeVisible();
  await expect.poll(async () => (await lastSaid(page))?.text).toMatch(/page 1|Preface/);
  await expect(await reveal(page, readAloud(page))).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+U');
  await page.keyboard.press('Control+Shift+U');
  await expect(bar(page)).toBeHidden();
  expect(await word(page)).toBe('');
});

test("Read aloud from here, on the selection's menu, starts at its first word", async ({ page }) => {
  await openReader(page);
  const a = await wordPoint(page, 'threw');
  const b = await wordPoint(page, 'circle');
  await page.mouse.move(a.left + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, b.y, { steps: 8 });
  await page.mouse.up();
  await page.mouse.click(a.x + 4, a.y, { button: 'right' });
  const item = page.getByRole('menu', { name: 'Selection' }).getByRole('menuitem', { name: /Read aloud from here/ });
  await item.click();
  await expect(page.getByRole('menu', { name: 'Selection' })).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect.poll(async () => (await said(page))[0]?.text).toBe('threw a small circle of light.');
  expect(await page.evaluate(() => document.getSelection().isCollapsed)).toBe(true); // the selection gives way
});

// C40.3: an EPUB (e2e/fixtures/books/reflow.epub: a cover, then chapters 1-3 of "The lamp on the desk threw a small
// circle of light, ..."), opened at chapter 1. Each section is a document of its own, with its own highlights.
test.describe('an EPUB', () => {
  test.use({ book: 'epub' });
  /** The word marked in a section's own registry. */
  const sectionWord = async (page) => (await Promise.all(page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())
    .map((f) => f.evaluate(() => [...(CSS.highlights.get('rf-read-aloud') ?? [])].map((r) => r.toString()).join('')).catch(() => ''))))
    .join('');

  test('reads the section in view and marks each word in it; Ctrl+Shift+U stops it', async ({ page }) => {
    await openReader(page);
    await clickTool(page, readAloud(page));
    await expect(bar(page)).toBeVisible();
    await expect.poll(async () => (await said(page))[0]?.text).toBe('Chapter 1');
    await expect.poll(() => sectionWord(page)).not.toBe('');
    await bar(page).getByRole('button', { name: 'Pause' }).click();
    expect('The lamp on the desk threw a small circle of light, and inside Chapter').toContain(await sectionWord(page));
    await page.keyboard.press('Control+Shift+U');
    await expect(bar(page)).toBeHidden();
    await expect.poll(() => sectionWord(page)).toBe('');
  });

  test('it reads on into the next section', async ({ page }) => {
    await openReader(page);
    await page.evaluate(() => { window.__wordMs = 1; });
    await clickTool(page, readAloud(page));
    await expect.poll(async () => (await said(page)).map((s) => s.text), { timeout: 30_000 }).toContain('Chapter 2');
    await expect.poll(() => sectionWord(page), { timeout: 10_000 }).not.toBe('');
  });

  test("Read aloud from here, on a section's selection, starts at its first word", async ({ page }) => {
    await openReader(page);
    const a = await wordPoint(page, 'threw');
    const b = await wordPoint(page, 'circle');
    await page.mouse.move(a.left + 1, a.y);
    await page.mouse.down();
    await page.mouse.move(b.right - 1, b.y, { steps: 8 });
    await page.mouse.up();
    await page.mouse.click(a.x + 4, a.y, { button: 'right' });
    await page.getByRole('menu', { name: 'Selection' }).getByRole('menuitem', { name: /Read aloud from here/ }).click();
    await expect.poll(async () => (await said(page))[0]?.text).toMatch(/^threw a small circle of light/);
  });
});

// C40.3b (FOCUS_RULES F6, rules version 2026-11-22): listening counts as reading. The page's clock is Playwright's, so
// the fake voice speaks a word a minute and goes on through ten quiet minutes.
test.describe('in focus mode', () => {
  test('no idle prompt while it speaks, heartbeats carry input; the prompt ten quiet minutes after it pauses', async ({ page, api }) => {
    await page.clock.install();
    api.bodyStart = { source: 'outline', body_start: { kind: 'pdf', page: 1, title: 'Chapter 1',
      anchor: { kind: 'pdf', page: 1, quads: [[0, 0, 0, 0]], text: '' } } };
    await openReader(page);
    await clickTool(page, page.getByRole('switch', { name: 'Focus mode' }));
    const focusBar = page.getByRole('region', { name: 'Focus mode' });
    await focusBar.getByRole('button', { name: 'Start' }).click();
    await page.evaluate(() => { window.__wordMs = 60_000; });
    const button = focusBar.getByRole('button', { name: 'Read aloud' });
    await button.click();
    await expect(bar(page)).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const prompt = page.getByRole('group', { name: 'Still with the book?' });

    await page.clock.runFor(10 * 60_000 + 6_000);
    await expect(prompt).toHaveCount(0);
    expect(api.focus.events.map((e) => e.kind)).not.toContain('idle_prompt');
    const beats = api.focus.events.filter((e) => e.kind === 'heartbeat');
    expect(beats.length).toBeGreaterThan(10);
    expect(beats.slice(-5).every((e) => e.had_input)).toBe(true); // the quiet minutes were listening

    await bar(page).getByRole('button', { name: 'Pause' }).click();
    await page.clock.runFor(10 * 60_000 + 6_000);
    await expect(prompt).toBeVisible();
  });
});
