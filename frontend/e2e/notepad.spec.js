// The notepad in the side panel (C22.2; since C37.3 the notebook's "All notes" opens it, as the toolbar's Notes opens
// the notebook): Notes and Steve share the panel as tabs beside the book (a sheet on a
// phone); notes are listed in book order under their passage's reference and drawn without loading an editor;
// changes left from an earlier visit (IndexedDB) are sent on load, a stale one shows the conflict and Keep mine
// resends it on the saved version. Every /notes call is mocked in fixtures.js.
import { test, expect, openNotepad, openReader, shown, settled } from './fixtures.js';

const shots = process.env.E2E_SHOTS;
const side = (page, name) => page.getByRole('complementary', { name });
const doc = (...blocks) => ({ type: 'doc', content: blocks });
const para = (...inline) => ({ type: 'paragraph', content: inline });
const text = (t, ...marks) => ({ type: 'text', text: t, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });

function note(id, page, y, content, created = '10') {
  return {
    id, kind: 'text', scope: 'selection', version: 1, orphaned: false, deleted_at: null, urls: {},
    anchors: [{ kind: 'pdf', page, quads: [[72, y, 300, y + 12]], text: 'the lamp' }],
    position_start: page * 1e6 + y * 100 + 23, position_end: page * 1e6 + (y + 12) * 100 + 99,
    content, created_at: `2026-11-14T10:${created}:00Z`,
  };
}

const seeded = () => [
  note('n-late', 2, 100, doc(para(text('On page two.')))),
  note('n-first', 1, 100, doc(
    para(text('The '), text('coefficients', 'bold'), text(' say how much: '), { type: 'inlineMath', attrs: { latex: 'a_n' } }),
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para(text('read 4.2'))] }] },
    { type: 'blockMath', attrs: { latex: '\\sum_{k=1}^{n} k' } },
  )),
];

async function openNotes(page) {
  await openReader(page);
  await openNotepad(page);
}

test('Notes opens beside the book with its notes in book order, drawn without an editor', async ({ page, api }) => {
  api.notes = seeded();
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await openReader(page);
  await expect(page.getByRole('button', { name: 'Notes, 2' })).toBeVisible();
  await openNotepad(page);
  const panel = side(page, 'Notes');
  await expect(panel.getByRole('tab', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('tab', { name: /Notes/ })).toBeFocused();
  await expect(panel.getByText('2 notes')).toBeVisible();
  const items = panel.locator('.rf-note');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('data-id', 'n-first');
  await expect(items.nth(0).locator('.rf-note-ref')).toHaveText(/^p\. \S+/);
  await expect(items.nth(0).locator('strong')).toHaveText('coefficients');
  await expect(items.nth(0).locator('math').first()).toBeAttached(); // KaTeX MathML, inline and display
  await expect(items.nth(0).locator('.rf-steve-math--display math')).toBeAttached();
  await expect(items.nth(0).locator('.rf-note-task[data-checked="true"]')).toHaveText('read 4.2');
  await expect(panel.getByRole('status').filter({ hasText: 'All notes saved' })).toBeAttached();
  expect(scripts.some((u) => /tiptap|prosemirror/i.test(u))).toBe(false);
  // the book stays usable beside the panel
  const stage = await page.locator('.rf-ov-stage').boundingBox();
  const box = await panel.boundingBox();
  expect(stage.x + stage.width).toBeLessThanOrEqual(box.x + 1);
  if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/notes-paper-1440.png` }); }
});

test('a reference goes to its passage', async ({ page, api }) => {
  api.notes = seeded();
  await openNotes(page);
  const before = await shown(page);
  await side(page, 'Notes').locator('.rf-note[data-id="n-late"] .rf-note-ref').click();
  await settled(page, before);
  const place = await shown(page);
  expect([place.start, place.end].join(' ')).toMatch(/\bii?\b|2/);
  await expect(side(page, 'Notes')).toBeVisible();
});

test('tabs: arrows move between Notes and Steve, Esc closes and focus returns to Notes', async ({ page, api }) => {
  api.steve.consented = true;
  await openReader(page);
  const notes = page.getByRole('button', { name: 'Notes' });
  await openNotepad(page);
  await expect(side(page, 'Notes').getByRole('tab', { name: 'Notes' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(side(page, 'Steve').getByRole('tab', { name: 'Steve' })).toBeFocused();
  await expect(side(page, 'Steve').getByText('Ask Steve about these pages')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask Steve' })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Home');
  await expect(side(page, 'Notes').getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect(side(page, 'Notes').getByRole('button', { name: 'Close notes' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#rf-side-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask Steve' })).toBeFocused(); // the button that opened the panel
  await expect(notes).toBeVisible();
});

test('empty, failed load and Try again', async ({ page, api }) => {
  await openNotes(page);
  await expect(side(page, 'Notes').getByText('No notes in this book yet')).toBeVisible();
  await page.getByRole('button', { name: 'Close notes' }).click();
  await page.route('**/books/*/notes', (route) => (route.request().method() === 'GET' && api.noteLists < 2
    ? (api.noteLists += 1, route.fulfill({ status: 500, body: '{"detail":"down"}', headers: { 'Access-Control-Allow-Origin': '*' } }))
    : route.fallback()));
  await page.reload();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor();
  await page.getByRole('button', { name: /^Notes/ }).click(); // C37.3: the notebook says it, and tries again
  const notebook = page.getByRole('dialog', { name: 'Notebook' });
  await expect(notebook.getByText('Your notebook could not be opened.')).toBeVisible();
  api.notes = seeded();
  await notebook.getByRole('button', { name: 'Try again' }).click();
  await expect(notebook.getByText('No pages yet')).toBeVisible(); // two typed notes, no pages
  await notebook.getByRole('button', { name: /^All notes/ }).click();
  await expect(side(page, 'Notes').locator('.rf-note')).toHaveCount(2);
});

test('delete, then Undo adds it back', async ({ page, api }) => {
  api.notes = seeded();
  await openNotes(page);
  const panel = side(page, 'Notes');
  await panel.getByRole('button', { name: /^Delete note at / }).first().click();
  await expect(panel.locator('.rf-note')).toHaveCount(1);
  await expect.poll(() => api.noteDeletes).toEqual(['n-first']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(panel.locator('.rf-note')).toHaveCount(2);
  await expect.poll(() => api.notePosts.length).toBe(1);
  expect(api.notePosts[0]).toMatchObject({ kind: 'text', anchors: seeded()[1].anchors, content: seeded()[1].content });
});

/** Puts a change in the notepad's IndexedDB queue, as an earlier visit that lost its connection would have. */
const queueChange = (page, entry) => page.evaluate((e) => new Promise((resolve, reject) => {
  const open = indexedDB.open('rf-notes', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('queue', { keyPath: 'id' });
  open.onsuccess = () => {
    const tx = open.result.transaction('queue', 'readwrite');
    tx.objectStore('queue').put(e);
    tx.oncomplete = () => { open.result.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
  open.onerror = () => reject(open.error);
}), entry);

const queued = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('rf-notes', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('queue', { keyPath: 'id' });
  open.onsuccess = () => { const r = open.result.transaction('queue').objectStore('queue').getAll(); r.onsuccess = () => resolve(r.result); };
}));

test('a change left offline on an earlier visit is sent on load and leaves the queue', async ({ page, api }) => {
  api.notes = seeded();
  await openReader(page);
  const content = doc(para(text('Written on the train.')));
  await queueChange(page, { id: 'n-late', change: { content }, version: 1 });
  await page.reload();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor();
  await expect.poll(() => api.notePatches.length).toBe(1);
  expect(api.notePatches[0]).toEqual({ id: 'n-late', version: 1, content });
  await expect.poll(() => queued(page)).toEqual([]);
  await openNotepad(page);
  await expect(side(page, 'Notes').locator('.rf-note[data-id="n-late"]')).toContainText('On page two.'); // the list as loaded
  await expect(side(page, 'Notes').getByRole('status').filter({ hasText: 'All notes saved' })).toBeAttached();
});

test('a stale change is a conflict on its note; Keep mine sends it on the saved version', async ({ page, api }) => {
  api.notes = seeded();
  api.notes[0].version = 3; // another tab saved twice since
  await openReader(page);
  const content = doc(para(text('Mine.')));
  await queueChange(page, { id: 'n-late', change: { content }, version: 1 });
  await page.reload();
  await page.locator('.rf-ov[data-loading="false"][data-start]').waitFor();
  await openNotepad(page);
  const card = side(page, 'Notes').locator('.rf-note[data-id="n-late"]');
  await expect(card.getByRole('alert')).toContainText('This note changed in another tab.');
  await expect(side(page, 'Notes').getByRole('status').filter({ hasText: 'Some notes are not saved' })).toBeAttached();
  await card.getByRole('button', { name: 'Keep mine' }).click();
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => api.notePatches.map((p) => p.version)).toEqual([1, 3]);
  await expect.poll(() => api.notes[0].version).toBe(4);
  expect(api.notes[0].content).toEqual(content);
  await expect(side(page, 'Notes').getByRole('status').filter({ hasText: 'All notes saved' })).toBeAttached();
});

test.describe('epub', () => {
  test.use({ book: 'epub' });
  test('an EPUB note is listed under its page and section, and its reference goes there', async ({ page, api }) => {
    api.notes = [{
      ...note('n-epub', 1, 0, doc(para(text('In chapter two.')))),
      anchors: [{ kind: 'epub', cfi: 'epubcfi(/6/6!/4/6,/1:0,/1:20)', text: 'The lamp on the desk' }],
      position_start: 2_000_000, position_end: 2_000_020,
    }];
    await openNotes(page);
    const ref = side(page, 'Notes').locator('.rf-note-ref');
    await expect(ref).toHaveText(/Chapter 2/);
    const before = await shown(page);
    await ref.click();
    await settled(page, before);
    await expect(page.locator('.rf-ov-head-entry')).toContainText('Chapter 2');
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
  test('a pull-up sheet in Lamplight, nothing sideways, 44 px targets', async ({ page, api }) => {
    api.notes = seeded();
    await openReader(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('lamplight');
    await openNotepad(page);
    const panel = side(page, 'Notes');
    const box = await panel.boundingBox();
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(375);
    expect(box.y).toBeGreaterThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    for (const button of await panel.getByRole('button').all()) {
      const b = await button.boundingBox();
      if (b) expect(Math.round(b.height)).toBeGreaterThanOrEqual(44);
    }
    if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/notes-lamplight-375.png` }); }
  });
});
