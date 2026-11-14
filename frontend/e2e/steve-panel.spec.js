// Steve's panel in the reader (C20.7b, handoff screens 13-17): consent, suggestions, a streamed answer with
// math, code and citation chips that move the book, resting, errors, settings, the sheet on a phone, keyboard
// and reduced motion. Every /steve call is mocked in fixtures.js.
import { test, expect, openReader, settled, shown, steveStream, STEVE_NOTICE } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const panel = (page) => page.getByRole('complementary', { name: 'Steve' });

async function openSteve(page) {
  await openReader(page);
  await page.getByRole('button', { name: 'Ask Steve' }).click();
  await expect(panel(page)).toBeVisible();
}

test('first use: the notice, then Turn on Steve stores consent to that version', async ({ page, api }) => {
  await openSteve(page);
  await expect(panel(page).getByText('Before Steve reads along')).toBeVisible();
  await expect(panel(page).getByText("Steve is a study assistant built on Google's Gemini.")).toBeVisible();
  await expect(panel(page).getByRole('link', { name: /Google's terms for the free tier/ })).toHaveAttribute('href', STEVE_NOTICE.terms_url);
  await expect(page.getByLabel('Your question for Steve')).toBeDisabled();
  if (shots) await page.screenshot({ path: `${shots}/steve-consent-1440.png` });
  await panel(page).getByRole('button', { name: 'Turn on Steve' }).click();
  await expect(panel(page).getByText('Ask Steve about these pages')).toBeVisible();
  expect(api.steve.puts).toEqual([{ consent: true, consent_version: STEVE_NOTICE.version }]);
  await expect(panel(page).locator('.rf-steve-sg')).toHaveCount(3);
  expect(api.steve.asks).toEqual([]); // nothing was sent to Steve
});

test('Not now closes the panel and nothing is sent', async ({ page, api }) => {
  await openSteve(page);
  await panel(page).getByRole('button', { name: 'Not now' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask Steve' })).toBeFocused();
  expect(api.steve.puts).toEqual([]);
});

test('a streamed answer with math, code and a citation chip that moves the book, panel open', async ({ page, api }) => {
  api.steve.consented = true;
  const text = 'He counts twice [p. 2], as $n^2$ shows:\n\n$$\\sum_{k=1}^{n} k$$\n\n```python\ndef toll(n):  # twice\n    return 2 * n\n```';
  api.steve.replies.push(steveStream(text, [{ label: 'p. 2', anchor: { kind: 'pdf', page: 2 } }]));
  await openSteve(page);
  const before = await shown(page);
  await panel(page).locator('.rf-steve-sg').first().click();
  await expect(panel(page).locator('.rf-steve-q')).toContainText('What is the main idea');
  await expect(panel(page).locator('.rf-steve-answer')).toContainText('He counts twice');
  await expect(panel(page).locator('.rf-steve-answer math').first()).toBeAttached(); // KaTeX MathML, loaded on demand
  await expect(panel(page).locator('.rf-steve-math--display math')).toBeAttached();
  await expect(panel(page).locator('.rf-tok-k', { hasText: 'def' })).toBeVisible();
  await expect(panel(page).locator('.rf-tok-c')).toHaveText('# twice');
  expect(api.steve.asks[0]).toMatchObject({ book_id: 'e2e-book', mode: 'ask' });
  expect(typeof api.steve.asks[0].utc_offset_minutes).toBe('number');
  if (shots) await page.screenshot({ path: `${shots}/steve-answer-1440.png` });
  const chip = panel(page).getByRole('button', { name: 'Go to page 2' });
  await chip.click();
  await settled(page, before);
  const place = await shown(page);
  expect([place.start, place.end]).toContain('2');
  await expect(panel(page)).toBeVisible();
});

test('only citations the server kept become chips', async ({ page, api }) => {
  api.steve.consented = true;
  api.steve.replies.push(steveStream('Coins [p. 99] and tides [p. 2].', [{ label: 'p. 2', anchor: { kind: 'pdf', page: 2 } }],
    { finalText: 'Coins and tides [p. 2].' }));
  await openSteve(page);
  await page.getByLabel('Your question for Steve').fill('Why?');
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('.rf-steve-answer')).toHaveText('Coins and tides p. 2.');
  await expect(panel(page).locator('.rf-steve-cite')).toHaveCount(1);
});

test('resting: the quota state offers the reader their own key or more reading', async ({ page, api }) => {
  api.steve.consented = true;
  api.steve.replies.push({ status: 429, detail: { code: 'daily_limit', message: 'Used up.', until: '2099-01-01T00:00:00Z' } });
  await openSteve(page);
  await panel(page).locator('.rf-steve-sg').first().click();
  await expect(panel(page).getByRole('heading', { name: 'Steve is resting until tomorrow' })).toBeVisible();
  await expect(page.getByLabel('Your question for Steve')).toHaveAttribute('placeholder', 'Steve is back tomorrow');
  if (shots) await page.screenshot({ path: `${shots}/steve-paused-1440.png` });
  await panel(page).getByRole('button', { name: 'Use your own key' }).click();
  await expect(panel(page).getByRole('heading', { name: 'Steve’s settings' })).toBeVisible();
  await expect(panel(page).getByLabel('Gemini API key')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Steve', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: /Steve is resting/ })).toBeVisible();
});

test('an error keeps the question and offers Try again', async ({ page, api }) => {
  api.steve.consented = true;
  api.steve.replies.push({ status: 503, detail: { code: 'timeout', message: 'Steve took too long to answer. Try again.' } });
  await openSteve(page);
  await page.getByLabel('Your question for Steve').fill('Why twice?');
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('alert')).toContainText('Steve took too long to answer.');
  await panel(page).getByRole('button', { name: 'Try again' }).click();
  await expect(panel(page).locator('.rf-steve-answer').last()).toContainText('He counts twice');
  expect(api.steve.asks.map((a) => a.question)).toEqual(['Why twice?', 'Why twice?']);
});

test('settings: switching Steve off stops asking until he is turned on', async ({ page, api }) => {
  api.steve.consented = true;
  await openSteve(page);
  await panel(page).getByRole('button', { name: 'Settings' }).click();
  const send = panel(page).getByRole('switch', { name: 'Send book text to Gemini' });
  await expect(send).toHaveAttribute('aria-checked', 'true');
  await send.click();
  await expect(panel(page).getByText('Steve is switched off')).toBeVisible();
  await expect(page.getByLabel('Your question for Steve')).toBeDisabled();
  expect(api.steve.puts).toEqual([{ enabled: false }]);
  await panel(page).getByRole('button', { name: 'Turn on Steve' }).click();
  await expect(panel(page).getByText('Ask Steve about these pages')).toBeVisible();
});

test('keyboard: the panel takes focus, Esc closes it and focus returns to the toolbar', async ({ page, api }) => {
  api.steve.consented = true;
  await openReader(page);
  const button = page.getByRole('button', { name: 'Ask Steve' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page).getByRole('heading', { name: 'Steve', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'Close Steve' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('the book stays usable beside the panel', async ({ page, api }) => {
  api.steve.consented = true;
  await openSteve(page);
  const stage = await page.locator('.rf-ov-stage').boundingBox();
  const side = await panel(page).boundingBox();
  expect(stage.x + stage.width).toBeLessThanOrEqual(side.x + 1); // side by side, not covered
  expect(side.width).toBe(380);
});

test.describe('on a phone (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('a pull-up sheet over the lower book, no sideways scroll, 44 px targets', async ({ page, api }) => {
    api.steve.consented = true;
    await openSteve(page);
    const side = await panel(page).boundingBox();
    expect(side.width).toBe(375);
    expect(side.y).toBeGreaterThan(200); // the top of the page stays visible
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    for (const name of ['Close Steve', 'Send']) {
      const box = await panel(page).getByRole('button', { name }).boundingBox();
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    // Nothing of the reader's (the day's note, Previous / Next) is drawn over the sheet.
    const input = page.getByLabel('Your question for Steve');
    await page.waitForTimeout(700); // after the sheet's rise
    const top = await input.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
    });
    expect(top).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}/steve-empty-375.png` });
  });
});

test.describe('in Lamplight with reduced motion', () => {
  test.use({ colorScheme: 'dark', reducedMotion: 'reduce' });

  test('the panel only fades in and the caret does not blink', async ({ page, api }) => {
    api.steve.consented = true;
    await page.addInitScript(() => localStorage.setItem('rf-theme', JSON.stringify('lamplight')));
    await openSteve(page);
    const animation = await panel(page).evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe('rf-steve-fade');
    await panel(page).locator('.rf-steve-sg').first().click();
    await expect(panel(page).locator('.rf-steve-answer')).toContainText('He counts twice');
    if (shots) await page.screenshot({ path: `${shots}/steve-answer-lamplight-1440.png` });
  });
});
