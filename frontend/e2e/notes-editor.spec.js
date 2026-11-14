// Writing notes (C22.2b): "Text" adds a note at the selection or the pages shown and opens TipTap, loaded only
// then; bold, italic, lists, checklists, $…$ and $$…$$ math; autosave 800 ms after the last key; an offline save
// waits in IndexedDB and goes when the browser is back online. PDF and EPUB; keyboard; phone. Mocked API.
import { test, expect, openReader } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const panel = (page) => page.getByRole('complementary', { name: 'Notes' });
const editor = (page) => panel(page).getByRole('textbox', { name: /^Note at / });

async function addNote(page) {
  await page.getByRole('button', { name: /^Notes/ }).click();
  await panel(page).getByRole('button', { name: 'Text' }).click();
  await expect(editor(page)).toBeFocused();
}

/** Every node of a TipTap document, depth first. */
const nodes = (doc) => [doc, ...(doc.content ?? []).flatMap(nodes)];

test('Text adds a note at the pages shown and opens the editor, loaded only then', async ({ page, api }) => {
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  expect(scripts.some((u) => u.includes('TextEditor'))).toBe(false);
  await panel(page).getByRole('button', { name: 'Text' }).click();
  await expect(editor(page)).toBeFocused();
  expect(scripts.some((u) => u.includes('TextEditor'))).toBe(true);
  await expect.poll(() => api.notePosts.length).toBe(1);
  const [post] = api.notePosts;
  expect(post).toMatchObject({ kind: 'text', scope: 'view', content: { type: 'doc', content: [{ type: 'paragraph' }] } });
  expect(post.anchors.length).toBeGreaterThanOrEqual(1);
  for (const anchor of post.anchors) {
    expect(anchor).toMatchObject({ kind: 'pdf', text: '' });
    expect(anchor.quads[0].slice(0, 2)).toEqual([0, 0]);
  }
  expect(Math.floor(post.position_start / 1e6)).toBe(post.anchors[0].page);
  await expect(panel(page).locator('.rf-note[data-editing]')).toHaveCount(1);
});

test('rich text and math autosave 800 ms after the last key, then show as written', async ({ page, api }) => {
  await openReader(page);
  await addNote(page);
  await expect.poll(() => api.notes.length).toBe(1);
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
  await page.waitForTimeout(500);
  expect(api.notePatches).toHaveLength(0); // still typing: nothing sent yet
  await expect.poll(() => api.notePatches.length, { timeout: 3000 }).toBe(1);
  const saved = api.notePatches.at(-1);
  expect(saved.version).toBe(1);
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
  await page.getByRole('button', { name: 'Notes, 1' }).click();
  await expect(panel(page).locator('.rf-note-read strong')).toHaveText('coefficients');
});

test('an equation opens its LaTeX on click and keeps the change', async ({ page, api }) => {
  await openReader(page);
  await addNote(page);
  await expect.poll(() => api.notes.length).toBe(1);
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

test('a selection anchors the new note to the selected words', async ({ page, api }) => {
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  await page.locator('.textLayer span', { hasText: 'Line 3 of page 1' }).first().dblclick();
  await panel(page).getByRole('button', { name: 'Text' }).click();
  await expect.poll(() => api.notePosts.length).toBe(1);
  const [post] = api.notePosts;
  expect(post.scope).toBe('selection');
  expect(post.anchors[0].text.length).toBeGreaterThan(0);
  expect(post.anchors[0].quads[0][1]).toBeGreaterThan(0);
});

/** The notepad's IndexedDB queue. */
const queued = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('rf-notes', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('queue', { keyPath: 'id' });
  open.onsuccess = () => { const r = open.result.transaction('queue').objectStore('queue').getAll(); r.onsuccess = () => resolve(r.result); };
}));

test('offline: the edit waits in IndexedDB and is saved when the browser is back online', async ({ page, api }) => {
  await openReader(page);
  await addNote(page);
  await expect.poll(() => api.notes.length).toBe(1);
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

test('keyboard: Text, the format bar as one tab stop, Escape back to the note', async ({ page, api }) => {
  await openReader(page);
  await page.getByRole('button', { name: /^Notes/ }).click();
  await panel(page).getByRole('button', { name: 'Text' }).focus();
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await expect.poll(() => api.notes.length).toBe(1);
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
  test('a note at the EPUB page shown, written and saved', async ({ page, api }) => {
    await openReader(page);
    await addNote(page);
    await expect.poll(() => api.notePosts.length).toBe(1);
    const [post] = api.notePosts;
    expect(post).toMatchObject({ kind: 'text', scope: 'view' });
    expect(post.anchors[0]).toMatchObject({ kind: 'epub', text: '' });
    expect(post.anchors[0].cfi).toMatch(/^epubcfi\(.*,.*,.*\)$/);
    expect(Math.floor(post.position_start / 1e6)).toBe(Math.floor(post.position_end / 1e6));
    await page.keyboard.type('Thoreau, *on the lamp*.');
    await expect.poll(() => api.notePatches.length, { timeout: 3000 }).toBe(1);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
  test('the editor in the sheet: 44 px tools, nothing sideways', async ({ page, api }) => {
    await openReader(page);
    await addNote(page);
    await expect.poll(() => api.notes.length).toBe(1);
    await page.keyboard.type('Small screen, $e^{i\\pi}$ ');
    const tools = await panel(page).getByRole('toolbar', { name: 'Format' }).getByRole('button').all();
    const tops = new Set();
    for (const tool of tools) {
      const box = await tool.boundingBox();
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
      tops.add(Math.round(box.y));
    }
    expect(tops.size).toBe(1); // one row of tools
    expect(Math.round((await panel(page).getByRole('button', { name: 'Done' }).boundingBox()).height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/notes-editor-lamplight-375.png` }); }
  });
});
