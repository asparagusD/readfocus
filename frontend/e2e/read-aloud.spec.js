// Read aloud (C40.2, issue 24: Edge's Read aloud) on the sample PDF (e2e/fixtures/books/sample.pdf): six pages, a title
// and 14 lines each ("Line 3 of page 2: the lamp threw a small circle of light."). Headless Edge has no voices, so a
// fake speechSynthesis speaks: it keeps every utterance (window.__spoken) and sends a word boundary every
// window.__wordMs (120 ms unless a test changes it), then the utterance's end.
import { test, expect, openReader, clickTool, reveal } from './fixtures.js';

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

test.describe('an EPUB', () => {
  test.use({ book: 'epub' });
  test('has no Read aloud until it can be read (C40.3)', async ({ page }) => {
    await openReader(page);
    await page.getByRole('button', { name: 'More tools' }).click();
    await expect(readAloud(page)).toHaveCount(0);
  });
});
