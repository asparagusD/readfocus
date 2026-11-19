// Typed notes a reader already has (C22.2b; since C37.3 none are made, and C37.4 moves them into the notebook):
// one opens from the notepad's list in TipTap, loaded only then; bold, italic, lists, checklists, $…$ and $$…$$
// math; autosave 800 ms after the last key; an offline save waits in IndexedDB and goes when the browser is back
// online. PDF and EPUB; keyboard; phone. Mocked API.
import { test, expect, openReader, openNotepad } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const editor = (page) => panel(page).getByRole('textbox', { name: /^Note at / });
const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] };

/** A typed note from before C37.3 on page 1 (or an EPUB's second section), empty, at version 1. */
function typed(kind = 'pdf') {
  const anchors = kind === 'pdf' ? [{ kind: 'pdf', page: 1, quads: [[0, 0, 612, 792]], text: '' }]
    : [{ kind: 'epub', cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)', text: '' }];
  const start = 1e6; // p. 1, or the EPUB's spine item 1
  return { id: 'note-1', kind: 'text', scope: 'view', version: 1, orphaned: false, deleted_at: null, urls: {}, anchors,
    position_start: start, position_end: start + 79_299, content: EMPTY, created_at: '2026-11-14T10:00:00Z' };
}

async function openTyped(page, api, kind = 'pdf') {
  api.notes = [typed(kind)];
  await openReader(page);
  await openNotepad(page);
  await panel(page).getByRole('button', { name: /^Edit note at / }).click();
  await expect(editor(page)).toBeFocused();
}

/** Every node of a TipTap document, depth first. */
const nodes = (doc) => [doc, ...(doc.content ?? []).flatMap(nodes)];

test('a typed note opens in the editor from the list, loaded only then', async ({ page, api }) => {
  api.notes = [typed()];
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await openReader(page);
  await openNotepad(page);
  expect(scripts.some((u) => u.includes('TextEditor'))).toBe(false);
  await expect(panel(page).getByRole('button', { name: 'Text' })).toHaveCount(0); // C37.3: no new typed notes
  await panel(page).getByRole('button', { name: /^Edit note at / }).click();
  await expect(editor(page)).toBeFocused();
  expect(scripts.some((u) => u.includes('TextEditor'))).toBe(true);
  await expect(panel(page).locator('.rf-note[data-editing]')).toHaveCount(1);
  expect(api.notePosts).toEqual([]);
});

test('rich text and math autosave 800 ms after the last key, then show as written', async ({ page, api }) => {
  await openTyped(page, api);
  await page.keyboard.type('The ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('coefficients');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' say how much: $a_n$ ');
  await expect(editor(page).locator('.rf-math-node math')).toBeAttached();
  await page.keyboard.press('Enter');
  await panel(page).getByRole('button', { name: 'Checklist' }).click();
  await page.keyboard.type('work through eq. 4.4');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // out of the list
  await page.keyboard.type('$$\\sum_{k=1}^{n} k$$');
  await expect(editor(page).locator('.rf-math-node--display math')).toBeAttached();
  await expect(editor(page)).not.toContainText('$'); // the dollars became the equations
  const sent = api.notePatches.length; // a slow machine may pause long enough mid-typing for an earlier save
  await page.waitForTimeout(500);
  expect(api.notePatches).toHaveLength(sent); // within 800 ms of the last key: nothing more sent
  await expect.poll(() => api.notePatches.length, { timeout: 3000 }).toBe(sent + 1);
  const saved = api.notePatches.at(-1);
  expect(saved.version).toBe(sent + 1);
  const all = nodes(saved.content);
  expect(all.find((n) => n.type === 'text' && n.text === 'coefficients').marks).toEqual([{ type: 'bold' }]);
  expect(all.find((n) => n.type === 'inlineMath').attrs).toEqual({ latex: 'a_n' });
  expect(all.find((n) => n.type === 'taskItem')).toMatchObject({ attrs: { checked: false } });
  expect(all.find((n) => n.type === 'blockMath').attrs).toEqual({ latex: '\\sum_{k=1}^{n} k' });
  await expect(panel(page).getByRole('status').filter({ hasText: 'All notes saved' })).toBeAttached();
  if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/notes-editor-paper-1440.png` }); }
  await page.keyboard.press('Escape');
  const drawn = panel(page).locator('.rf-note-read');
  await expect(drawn).toBeFocused();
  await expect(drawn.locator('strong')).toHaveText('coefficients');
  await expect(drawn.locator('.rf-steve-math--display math')).toBeAttached();
  await expect(drawn.locator('.rf-note-task')).toHaveText('work through eq. 4.4');
  await page.reload();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor();
  await openNotepad(page);
  await expect(panel(page).locator('.rf-note-read strong')).toHaveText('coefficients');
});

test('an equation opens its LaTeX on click and keeps the change', async ({ page, api }) => {
  await openTyped(page, api);
  await page.keyboard.type('Area $x^2$ ');
  await editor(page).locator('.rf-math-node').click();
  const field = panel(page).getByRole('textbox', { name: 'Equation in LaTeX' });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('x^2');
  await field.fill('\\pi r^2');
  await page.keyboard.press('Enter');
  await expect.poll(() => nodes(api.notePatches.at(-1)?.content ?? {}).find((n) => n.type === 'inlineMath')?.attrs.latex, { timeout: 3000 }).toBe('\\pi r^2');
  await panel(page).getByRole('button', { name: 'Display math ($$…$$)' }).click();
  await expect(panel(page).getByRole('textbox', { name: 'Display equation in LaTeX' })).toBeFocused();
  await page.keyboard.press('Escape'); // empty and dropped: no stray equation
  await expect(editor(page).locator('.rf-math-node--display')).toHaveCount(0);
  await expect(editor(page)).toBeVisible(); // Escape in the field does not close the editor
});

/** The notepad's IndexedDB queue. */
const queued = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('rf-notes', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('queue', { keyPath: 'id' });
  open.onsuccess = () => { const r = open.result.transaction('queue').objectStore('queue').getAll(); r.onsuccess = () => resolve(r.result); };
}));

test('offline: the edit waits in IndexedDB and is saved when the browser is back online', async ({ page, api }) => {
  await openTyped(page, api);
  api.noteFail = 'abort';
  await page.keyboard.type('Written offline.');
  await expect(panel(page).getByRole('status').filter({ hasText: /^Offline/ })).toBeAttached({ timeout: 4000 });
  await expect(panel(page).locator('.rf-note').getByText('Waiting to save')).toBeVisible();
  await expect.poll(async () => (await queued(page)).map((e) => e.id)).toEqual(['note-1']);
  api.noteFail = null;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(panel(page).getByRole('status').filter({ hasText: 'All notes saved' })).toBeAttached();
  expect(nodes(api.notes[0].content).some((n) => n.text === 'Written offline.')).toBe(true);
  await expect.poll(() => queued(page)).toEqual([]);
});

test('keyboard: Enter opens the note, the format bar is one tab stop, Escape goes back to the note', async ({ page, api }) => {
  api.notes = [typed()];
  await openReader(page);
  await openNotepad(page);
  await panel(page).getByRole('button', { name: /^Edit note at / }).focus();
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Keys only.');
  await page.keyboard.press('Shift+Tab'); // back to the format bar's one stop
  await expect(panel(page).getByRole('button', { name: 'Bold (Ctrl+B)' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(panel(page).getByRole('button', { name: 'Italic (Ctrl+I)' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(panel(page).getByRole('button', { name: 'Display math ($$…$$)' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel(page).locator('.rf-note-read')).toBeFocused();
  await expect(panel(page)).toBeVisible(); // Escape closed the editor, not the panel
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
});

test.describe('epub', () => {
  test.use({ book: 'epub' });
  test('a note at an EPUB page, written and saved', async ({ page, api }) => {
    await openTyped(page, api, 'epub');
    await page.keyboard.type('Thoreau, *on the lamp*.');
    await expect.poll(() => api.notePatches.length, { timeout: 3000 }).toBe(1);
    expect(api.notePatches[0].id).toBe('note-1');
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
  test('the editor in the sheet: 44 px tools, nothing sideways', async ({ page, api }) => {
    await openTyped(page, api);
    await page.keyboard.type('Small screen, $e^{i\\pi}$ ');
    // C35.8 (DEBUG_LOG 2026-11-19): all the tools in one frame, so a sheet still sliding up moves them alike.
    const boxes = await panel(page).getByRole('toolbar', { name: 'Format' }).evaluate((bar) =>
      [...bar.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { top: r.top, height: r.height }; }));
    expect(boxes.length).toBe(7);
    for (const box of boxes) expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(1); // one row of tools
    expect(Math.round((await panel(page).getByRole('button', { name: 'Done' }).boundingBox()).height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/notes-editor-lamplight-375.png` }); }
  });
});
